import './style.css';
import {bitable,FieldType,PermissionEntity,OperationType,DashboardState} from '@lark-base-open/js-sdk';
import {PlanGuard} from './guard.mjs';
import {plainText,planSchedule,dateKey,timeKey,validateVisit,contactLabel,matchesContact} from './domain.mjs';
import {createTimePicker} from './time-picker.mjs';
const $=id=>document.getElementById(id),el=(tag,txt)=>{const e=document.createElement(tag);e.textContent=txt;return e;};
const guard=new PlanGuard({bitable,FieldType,PermissionEntity,OperationType,DashboardState});
const clock=createTimePicker($('time-picker'),$('period'));
let data,snapshot,selected=new Set(),busy=false,pending=null,uncertain=false;
function notice(s){$('notice').textContent=s;}
function error(s){$('error').textContent=s;$('error').hidden=!s;}
function locked(b){busy=b;for(const e of document.querySelectorAll('button,input,select'))e.disabled=b; if(!b&&uncertain){$('save').disabled=true;$('delete').disabled=true;$('confirm').disabled=true;}}
const label=p=>[planSchedule(p)?.date,planSchedule(p)?.label,p.customerIds.map(id=>{const c=data.contacts.find(c=>c.id===id);return c?contactLabel(c):'不可见客户';}).join(' / '),p.temporaryContact].filter(Boolean).join(' · ');
function renderPeople(){
 $('chosen').replaceChildren();for(const id of selected){const c=data.contacts.find(c=>c.id===id),b=el('button',`${c?contactLabel(c):'不可见客户'} ×`);b.type='button';b.onclick=()=>{selected.delete(id);renderPeople();};$('chosen').append(b);}
 $('matches').replaceChildren();const matches=data.contacts.filter(c=>matchesContact(c,$('search').value));for(const c of matches.slice(0,40)){const l=el('label',''),check=document.createElement('input');check.type='checkbox';check.checked=selected.has(c.id);check.onchange=()=>{check.checked?selected.add(c.id):selected.delete(c.id);renderPeople();};l.append(check,el('span',contactLabel(c)));$('matches').append(l);}if(matches.length>40)$('matches').append(el('p','输入关键词缩小范围。'));
}
async function refresh(){
 if(busy)return;locked(true);try{data=await guard.load();$('plan').replaceChildren(el('option','请选择'));$('plan').firstChild.value='';for(const p of data.plans){const o=el('option',label(p));o.value=p.id;$('plan').append(o);}notice('已连接。请按客户和日期选择计划，再点「查看计划」。');}catch(e){notice(e.message);}finally{locked(false);}
}
async function open(id){
 if(!id||busy)return;locked(true);try{snapshot=await guard.inspect(id);const p=guard.repo.parsePlan(snapshot.plan),s=planSchedule(p);$('identity').textContent=label(p);$('status').textContent=snapshot.needsConfirmation?'已有拜访内容／关联业务，删改将先确认。':snapshot.visit?'空白待填写记录，删改将自动联动。':'尚无对应拜访记录。';$('content').textContent=snapshot.visit?plainText(snapshot.visit.fields[guard.v.content]):'';$('visit-date').value=s?.date||'';$('period').value=s?.period||'am';clock.set(Number.isFinite(p.timestamp)?timeKey(p.timestamp):'');selected=new Set(p.customerIds);$('search').value='';renderPeople();$('editor').hidden=false;$('review').hidden=true;pending=null;uncertain=false;error('');notice('请核对客户和日期后操作。');}catch(e){notice(e.message);$('editor').hidden=true;}finally{locked(false);}
}
function choice(value,title,checked=false){const l=el('label',''),i=document.createElement('input');i.type='radio';i.name='scope';i.value=value;i.checked=checked;l.append(i,el('span',title));$('options').append(l);return l;}
function check(id,title,checked=true){const l=el('label',''),i=document.createElement('input');i.type='checkbox';i.id=id;i.checked=checked;l.append(i,el('span',title));$('options').append(l);}
function review(kind,input,s){
 pending={kind,input,s};$('editor').hidden=true;$('review').hidden=false;$('review-title').textContent=kind==='delete'?'已有记录，确认删除范围':'已有记录，确认修改范围';$('review-text').textContent=label(guard.repo.parsePlan(s.plan));$('options').replaceChildren();$('review-error').textContent='';
 if(kind==='delete'){
  choice('plan','仅删除计划，保留拜访记录',true);
  if(s.visit&&!s.dependencies.length){choice('both','同时删除计划和这条拜访记录');check('ack-delete','我确认这条拜访记录也不再需要',false);}
  if(s.dependencies.length)$('options').append(el('p','存在待办或采购等关联业务，为避免断开历史，只提供保留拜访记录的选项。'));
 }else{
  choice('plan','只修改计划，已有拜访记录不变',true);
  if(s.visit){choice('sync','同时同步以下信息（不覆盖沟通内容）');check('sync-date','日期');check('sync-customer','客户、联系人、部门');}
 }
 if(s.planDrafts.length)$('options').append(el('p',`计划中还有已填写的：${s.planDrafts.join('、')}。请确认已保存所需资料。`));
 $('confirm').textContent=kind==='delete'?'确认删除':'确认修改';$('back').focus();
}
async function run(kind,input,s,scope){
 locked(true);try{
  const result=kind==='delete'?await guard.remove(s,scope):await guard.modify(s,input,scope,{date:$('sync-date')?.checked??true,customer:$('sync-customer')?.checked??true});
  $('editor').hidden=true;$('review').hidden=true;pending=null;snapshot=null;notice(result.message);locked(false);await refresh();notice(result.message);
 }catch(e){uncertain=!!e.uncertain;const target=$('review').hidden?$('error'):$('review-error');target.textContent=e.message;target.hidden=false;}finally{locked(false);}
}
$('form').onsubmit=async e=>{
 e.preventDefault();if(busy||uncertain||!snapshot)return;error('');let input;
 try{const p=guard.repo.parsePlan(snapshot.plan),t=clock.value;input=validateVisit({date:$('visit-date').value,time:t,period:$('period').value,timePending:!t,customerIds:[...selected],temporaryContact:p.temporaryContact},data.contacts);if(Number.isFinite(p.timestamp)&&dateKey(p.timestamp)===$('visit-date').value&&timeKey(p.timestamp)===t)input.timestamp=p.timestamp;locked(true);const s=await guard.current(snapshot);locked(false);if(s.needsConfirmation)review('modify',input,s);else await run('modify',input,s,'auto');}catch(e){error(e.message);locked(false);}
};
$('delete').onclick=async()=>{if(busy||uncertain||!snapshot)return;locked(true);try{const s=await guard.current(snapshot);locked(false);if(s.needsConfirmation)review('delete',null,s);else await run('delete',null,s,'auto');}catch(e){error(e.message);locked(false);}};
$('confirm').onclick=async()=>{if(!pending||busy||uncertain)return;const scope=document.querySelector('input[name=scope]:checked')?.value;if(scope==='both'&&!$('ack-delete')?.checked){$('review-error').textContent='请勾选确认这条拜访记录也不再需要。';return;}if(scope==='sync'&&!$('sync-date').checked&&!$('sync-customer').checked){$('review-error').textContent='请选择同步项目，或选择只修改计划。';return;}await run(pending.kind,pending.input,pending.s,scope);};
$('back').onclick=()=>{if(busy)return;$('review').hidden=true;$('editor').hidden=false;pending=null;};
$('search').oninput=renderPeople;$('open').onclick=()=>open($('plan').value);
$('refresh').onclick=async()=>{if(busy)return;uncertain=false;pending=null;$('review').hidden=true;$('editor').hidden=true;await refresh();};
async function start(){try{data=await guard.connect();$('picker').hidden=false;await refresh();const s=await bitable.base.getSelection();if(s.tableId===guard.repo.planTableId&&s.recordId){$('plan').value=s.recordId;await open(s.recordId);}bitable.base.onSelectionChange(e=>{if(!busy&&!snapshot&&e.data.tableId===guard.repo.planTableId&&e.data.recordId)open(e.data.recordId);});}catch(e){notice(`尚不能操作：${e.message}`);}}
if(window.parent===window)notice('请在飞书的「计划操作」入口打开；独立网页不能读取或修改业务数据。');else start();
