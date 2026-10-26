import {VisitRepository,readAll} from './repository.mjs';
import {plainText,linkedIds,sameVisit,planSchedule,timestampOf} from './domain.mjs';

const linkTypes=[18,21], readonlyTypes=[19,20,1001,1002,1003,1004,1005,3001];
const text=s=>[{type:'text',text:s}];
export function hasValue(value){
 if(value==null||value===false||value==='')return false;
 if(Array.isArray(value))return value.some(hasValue);
 if(typeof value==='object'&&typeof value.text==='string')return !!value.text.trim();
 if(typeof value==='object')return Object.values(value).some(hasValue);
 return typeof value==='string'?!!value.trim():true;
}
export function fingerprint(value){
 const sort=x=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;
 return JSON.stringify(sort(value));
}
function named(fields,name,types){const found=fields.filter(f=>f.name===name);if(found.length!==1||types&&!types.includes(found[0].type))throw Error(`字段「${name}」缺失或类型不符，已停止操作。`);return found[0];}
function mutable(row,fields,exclude=[]){return Object.fromEntries(fields.filter(f=>!readonlyTypes.includes(f.type)&&!exclude.includes(f.id)).map(f=>[f.id,row.fields[f.id]??null]));}
function fail(message,partial=false){const e=Error(message);e.uncertain=partial;throw e;}

// All writes are initiated by the explicit, reviewed panel action. Never a background listener.
export class PlanGuard {
 constructor(sdk){
  this.sdk=sdk;
  const dashboard={state:sdk.DashboardState.Create};
  this.repo=new VisitRepository({...sdk,bitable:{...sdk.bitable,dashboard}});
 }
 async connect(){
  this.ready=false;
  this.data=await this.repo.connect();
  this.pf=await this.repo.plan.getFieldMetaList();
  // A copied/frozen Base without the deliberately installed entry stays read-only.
  named(this.pf,'计划操作地址（系统）',[20]);
  this.plink=named(this.pf,'已存拜访记录',linkTypes);
  this.visitId=this.plink.property.tableId;
  this.visit=await this.sdk.bitable.base.getTableById(this.visitId);
  this.vf=await this.visit.getFieldMetaList();
  this.v={};
  for(const [key,name,types] of [['key','计划定位键（系统）',[1]],['source','来源拜访计划',linkTypes],['content','沟通内容',[1]],['raw','原表资料',[1]],['date','沟通日期',[5]],['people','联系人',linkTypes],['org','客户',linkTypes],['names','约见客户',[1]],['branch','客户名称（拜访时）',[1]],['dept','部门（拜访时）',[1]],['origin','来源键',[1]],['test','测试记录',[7]]])this.v[key]=named(this.vf,name,types).id;
  if(this.vf.find(f=>f.id===this.v.source).property.tableId!==this.repo.planTableId||this.vf.find(f=>f.id===this.v.people).property.tableId!==this.repo.contactTableId)throw Error('拜访来源/联系人表不匹配。');
  this.cf=await this.repo.contact.getFieldMetaList();
  this.assoc=named(this.cf,'关联客户',linkTypes).id;
  if(this.vf.find(f=>f.id===this.v.org).property.tableId!==this.cf.find(f=>f.id===this.assoc).property.tableId)throw Error('客户机构关联表不匹配。');
  this.refs=[];
  const metas=await this.sdk.bitable.base.getTableMetaList();
  // Structural reverse links in contacts/institution index are not business dependants.
  const structural=new Set([this.repo.planTableId,this.visitId,this.repo.contactTableId,this.cf.find(f=>f.id===this.assoc).property.tableId]);
  for(let i=0;i<metas.length;i+=6){await Promise.all(metas.slice(i,i+6).filter(t=>!structural.has(t.id)).map(async meta=>{
   const table=await this.sdk.bitable.base.getTableById(meta.id),fields=await table.getFieldMetaList();
   const relevant=fields.filter(f=>linkTypes.includes(f.type)&&[this.repo.planTableId,this.visitId].includes(f.property?.tableId));
   const keys=fields.filter(f=>f.type===1&&/来源|定位键/.test(f.name));
   if(relevant.length||keys.length)this.refs.push({id:meta.id,name:meta.name,table,fields:relevant,keys});
  }));}
  this.ready=true;return this.data;
 }
 async load(){this.data=await this.repo.load();return this.data;}
 async permission(tableId,id,type){return this.sdk.bitable.base.getPermission({entity:this.sdk.PermissionEntity.Record,type,param:{tableId,recordId:id}});}
 async inspect(id){
  if(!this.ready)throw Error('尚未通过安全检查。');
  const plans=await readAll(this.repo.plan),plan=plans.find(r=>r.recordId===id);
  if(!plan)throw Error('计划已删除或当前账号不可见。');
  const ids=linkedIds(plan.fields[this.plink.id]),key=`plan:${id}`,rows=await readAll(this.visit);
  const candidates=rows.filter(r=>ids.includes(r.recordId)||linkedIds(r.fields[this.v.source]).includes(id)||plainText(r.fields[this.v.key])===key);
  if(ids.some(vid=>!rows.some(r=>r.recordId===vid)))throw Error('关联拜访不可见或尚未同步，请稍后刷新，未执行删改。');
  if(candidates.length>1||ids.length>1)throw Error('同一计划存在多条拜访关联，请先核对，未猜选记录。');
  const visit=candidates[0]||null;
  if(visit){
   const sources=linkedIds(visit.fields[this.v.source]),vkey=plainText(visit.fields[this.v.key]);
   if(sources.some(s=>s!==id)||(vkey&&vkey!==key))throw Error('拜访记录属于另一条计划，停止操作。');
   if(plans.some(p=>p.recordId!==id&&linkedIds(p.fields[this.plink.id]).includes(visit.recordId)))throw Error('拜访被其他计划共用，停止联动操作。');
  }
  const dependencies=[];
  for(const ref of this.refs){for(const r of await readAll(ref.table)){
   const mentions=(value,target)=>target&&new RegExp(`(^|[^A-Za-z0-9])${target}($|[^A-Za-z0-9])`).test(plainText(value));
   if(ref.fields.some(f=>linkedIds(r.fields[f.id]).includes(f.property.tableId===this.visitId?visit?.recordId:id))||ref.keys.some(f=>mentions(r.fields[f.id],id)||mentions(r.fields[f.id],visit?.recordId)))dependencies.push({table:ref.name,id:r.recordId});
  }}
  for(const f of this.pf.filter(f=>linkTypes.includes(f.type)&&f.id!==this.plink.id&&f.property.tableId!==this.repo.contactTableId))for(const target of linkedIds(plan.fields[f.id]))dependencies.push({table:f.name,id:target});
  if(visit)for(const f of this.vf.filter(f=>linkTypes.includes(f.type)&&![this.v.source,this.v.people,this.v.org].includes(f.id)))for(const target of linkedIds(visit.fields[f.id]))dependencies.push({table:f.name,id:target});
  const structural=new Set(['key','source','date','people','org','names','branch','dept','origin','test'].map(k=>this.v[k]));
  const details=visit?this.vf.filter(f=>!readonlyTypes.includes(f.type)&&!structural.has(f.id)&&hasValue(visit.fields[f.id])).map(f=>f.name):[];
  const planDrafts=['沟通重点','完整原始资料','下一步动作','执行要求'].filter(name=>{const f=this.pf.find(f=>f.name===name);return f&&hasValue(plan.fields[f.id]);});
  const autoDraft=!!visit&&plainText(visit.fields[this.v.key])===key&&linkedIds(visit.fields[this.v.source]).length===1;
  const protectedVisit=!!visit&&(details.length>0||!autoDraft||dependencies.length>0);
  const snapshot={id,plan,visit,dependencies,details,planDrafts,protectedVisit,needsConfirmation:protectedVisit||planDrafts.length>0||dependencies.length>0};
  snapshot.signature=this.signature(snapshot);return snapshot;
 }
 signature(s){return fingerprint({plan:mutable(s.plan,this.pf),visit:s.visit?{id:s.visit.recordId,fields:mutable(s.visit,this.vf)}:null,dependencies:s.dependencies});}
 async current(s){const now=await this.inspect(s.id);if(now.signature!==s.signature)throw Error('计划、拜访或关联业务已变化，请重新查看并确认。');return now;}
 async syncCells(input,selection){
  const cells={};
  if(selection.date)cells[this.v.date]=Number.isFinite(input.timestamp)?input.timestamp:timestampOf(input.pendingDate,'00:00');
  if(selection.customer){
   const rows=await readAll(this.repo.contact),people=input.customerIds.map(id=>rows.find(r=>r.recordId===id));
   if(!people.length||people.some(p=>!p||!linkedIds(p.fields[this.assoc]).length))throw Error('客户档案或机构归属不完整，未同步客户信息。');
   const values=field=>[...new Set(people.map(p=>plainText(p.fields[field]).trim()).filter(Boolean))];
   const s=this.repo.source,branch=values(s.branchField),level1=values(s.level1Field);
   cells[this.v.people]={recordIds:input.customerIds};
   cells[this.v.org]={recordIds:[...new Set(people.flatMap(p=>linkedIds(p.fields[this.assoc])))]};
   cells[this.v.names]=text(values(s.nameField).join('、'));
   cells[this.v.branch]=text((branch.length?branch:level1.length?level1:values(s.organizationField)).join('、'));
   cells[this.v.dept]=text(values(s.departmentField).join('、'));
  }
  return cells;
 }
 async modify(snapshot,input,choice='auto',selection={date:true,customer:true}){
  let s=await this.current(snapshot);
  if(s.needsConfirmation&&!['plan','sync'].includes(choice))throw Error('已有拜访内容或关联业务，请先确认修改范围。');
  if(!['auto','plan','sync'].includes(choice))throw Error('无效修改范围。');
  if(sameVisit(input,this.repo.parsePlan(s.plan)))throw Error('计划信息没有变化，未执行修改。');
  const sync=!!s.visit&&choice!=='plan';
  const cells=sync?await this.syncCells(input,s.protectedVisit?selection:{date:true,customer:true}):{};
  if(sync&&!await this.permission(this.visitId,s.visit.recordId,this.sdk.OperationType.Editable))throw Error('没有修改对应拜访记录的权限，计划未改动。');
  s=await this.current(s);
  const saved=await this.repo.save(input,this.repo.parsePlan(s.plan));
  if(!sync)return {saved,message:'计划已修改；已有拜访记录保持不变。'};
  try{
   const row=await this.visit.getRecordById(s.visit.recordId,true);
   if(fingerprint(mutable(row,this.vf))!==fingerprint(mutable(s.visit,this.vf)))fail('计划已修改，但拜访记录刚被修改，未覆盖；请刷新核对。',true);
   if(Object.keys(cells).length){
    if(!await this.visit.setRecord(s.visit.recordId,{fields:cells}))throw Error('拜访更新未确认');
    const after=await this.visit.getRecordById(s.visit.recordId,true);
    for(const [id,value] of Object.entries(cells))if(!this.sameCell(id,value,after.fields[id]))throw Error('拜访回读不符');
    for(const [id,value] of Object.entries(mutable(s.visit,this.vf)))if(!(id in cells)&&!this.sameCell(id,value,after.fields[id]))throw Error('其他拜访字段发生变化');
   }
   return {saved,message:'计划与所选拜访信息已同步，沟通内容保持不变。'};
  }catch(error){if(error.uncertain)throw error;fail('计划已修改，拜访同步结果尚未核实；请刷新核对，不要重复提交。',true);}
 }
 sameCell(id,a,b){const f=this.vf.find(f=>f.id===id);if(linkTypes.includes(f?.type))return [...linkedIds(a)].sort().join('|')===[...linkedIds(b)].sort().join('|');if(f?.type===1)return plainText(a)===plainText(b);return fingerprint(a??null)===fingerprint(b??null);}
 async remove(snapshot,choice='auto'){
  const s=await this.current(snapshot);
  if(s.needsConfirmation&&!['plan','both'].includes(choice))throw Error('已有拜访内容或关联业务，请先确认删除范围。');
  if(!['auto','plan','both'].includes(choice))throw Error('无效删除范围。');
  const removeVisit=!!s.visit&&choice!=='plan';
  if(removeVisit&&s.dependencies.length)throw Error('仍有关联待办或采购等业务，只能删除计划并保留拜访记录。');
  if(!await this.permission(this.repo.planTableId,s.id,this.sdk.OperationType.Deletable))throw Error('没有删除此计划的权限。');
  if(removeVisit&&!await this.permission(this.visitId,s.visit.recordId,this.sdk.OperationType.Deletable))throw Error('没有删除对应拜访记录的权限，计划未删除。');
  await this.current(s);
  let planDeleted=false;
  try{
   if(!await this.repo.plan.deleteRecord(s.id))throw Error('计划删除未确认');
   if((await readAll(this.repo.plan)).some(r=>r.recordId===s.id))throw Error('计划仍存在');
   planDeleted=true;
   if(removeVisit){
    const rows=await readAll(this.visit),row=rows.find(r=>r.recordId===s.visit.recordId);
    // Feishu clears the source link when a plan is deleted. Ignore only that one field.
    if(row){
     if(fingerprint(mutable(row,this.vf,[this.v.source]))!==fingerprint(mutable(s.visit,this.vf,[this.v.source])))throw Error('拜访记录发生并发变化，保留记录');
     if(!await this.visit.deleteRecord(row.recordId))throw Error('拜访删除未确认');
     if((await readAll(this.visit)).some(r=>r.recordId===row.recordId))throw Error('拜访仍存在');
    }
   }
   return {message:removeVisit?'计划和对应拜访记录已删除。':s.visit?'计划已删除，拜访记录已保留。':'计划已删除。'};
  }catch{fail(planDeleted?'计划已删除；拜访记录的清理尚未确认，请刷新核对，未继续重试。':'删除结果尚未核实，请刷新核对，不要重复提交。',true);}
 }
}
