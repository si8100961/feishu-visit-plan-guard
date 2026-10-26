// Only table/field identifiers are persisted in the Feishu component configuration.
// No CRM identifiers, names of people, credentials or data snapshots in the bundle.
export const CONFIG_VERSION = 4;
export const FIELD_KEYS = ['dateField', 'linkField', 'nameField', 'branchField', 'departmentField', 'testField'];
export const OPTIONAL_CONTACT_KEYS = ['organizationField', 'level1Field', 'associationField', 'displayField'];

export function savedSource(config) {
  const value = config?.customConfig;
  if (!value || Object.keys(value).length === 0) return null;
  if (value.calendar !== 'half-day' || ![1, 2, 3, CONFIG_VERSION].includes(value.version)) {
    throw new Error('组件配置版本不兼容，已停止读写；请重新配置此组件。');
  }
  let source = value.version === 1 ? value : value.source;
  if (value.version === CONFIG_VERSION && (!source || typeof source.planTableId !== 'string')) throw new Error('组件数据源配置不完整，已停止读写。');
  if ([3, CONFIG_VERSION].includes(value.version)) {
    // Feishu remaps identifiers in dataConditions when copying a Base.
    // Never fall back to the original Base identifiers after a copy.
    const [plan] = config.dataConditions || [];
    if (plan?.groups?.length !== 2 || !plan.tableId || plan.groups.some(g=>!g.fieldId)) throw new Error('数据源映射不完整，已停止读写。');
    const remapped = !value.source || plan.tableId !== value.source.planTableId;
    source = { ...(remapped ? { copied: true, contactFieldNames: value.source?.contactFieldNames } : value.source),
      planTableId: plan.tableId, dateField: plan.groups[0].fieldId, linkField: plan.groups[1].fieldId };
    if (source.copied) return source;
  }
  const keys = ['planTableId', 'contactTableId', ...(value.version === 1 ? [] : FIELD_KEYS)];
  if (!source || keys.some(key => typeof source[key] !== 'string' || !source[key].trim()) || source.planTableId === source.contactTableId) {
    throw new Error('组件数据源配置不完整，已停止读写。');
  }
  return { ...source };
}

export function dashboardConfig(source) {
  const groups = keys => keys.map(key => ({ fieldId: source[key] }));
  // Current Feishu host persists one condition only. Track the plan fields here;
  // resolve the contact table through its remapped link, never through another Base.
  const config = { dataConditions: [
    { tableId: source.planTableId, groups: groups(['dateField', 'linkField']), series: 'COUNTA' }
  ], customConfig: { version: CONFIG_VERSION, calendar: 'half-day', source: {
    planTableId:source.planTableId,contactTableId:source.contactTableId,
    ...Object.fromEntries(FIELD_KEYS.map(key=>[key,source[key]])),
    ...Object.fromEntries(OPTIONAL_CONTACT_KEYS.filter(key=>typeof source[key]==='string'&&source[key].trim()).map(key=>[key,source[key]])),
    ...(source.keywordField ? {keywordField:source.keywordField}:{}),
    ...(source.extraFields ? { extraFields: Object.fromEntries(['pendingDateField','pendingPeriodField','temporaryContactField'].filter(key=>typeof source.extraFields[key]==='string').map(key=>[key,source.extraFields[key]])) } : {}),
    ...(source.contactFieldNames ? {contactFieldNames:Object.fromEntries([...FIELD_KEYS.slice(2),...OPTIONAL_CONTACT_KEYS].filter(key=>typeof source.contactFieldNames[key]==='string').map(key=>[key,source.contactFieldNames[key]]))}:{})
  } } };
  savedSource(config);
  return config;
}

export function oneNamed(items, name) {
  const matches = items.filter(item => item.name === name);
  if (matches.length !== 1) throw new Error(`无法唯一确定「${name}」，已停止读写；不会自动创建表或字段。`);
  return matches[0];
}
