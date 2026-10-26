// All calendar dates are Shanghai business dates, independent of the viewer's OS timezone.
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function dateKey(timestamp) { return dateFormatter.format(new Date(timestamp)); }
export function timeKey(timestamp) { return timeFormatter.format(new Date(timestamp)); }
export function halfDay(timestamp) { return Number(timeKey(timestamp).slice(0, 2)) < 12 ? 'am' : 'pm'; }
export function timestampOf(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('请填写完整的拜访日期和时间。');
  const value = Date.parse(`${date}T${time}:00+08:00`);
  if (!Number.isFinite(value) || dateKey(value) !== date || timeKey(value) !== time) throw new Error('日期或时间不正确。');
  return value;
}
export function shiftDate(date, days) {
  const value = timestampOf(date, '12:00') + days * 86400000;
  return dateKey(value);
}
export function weekDates(date) {
  const weekday = new Date(timestampOf(date, '12:00')).getUTCDay();
  const monday = shiftDate(date, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shiftDate(monday, i));
}
export function plainText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(plainText).join('');
  if (typeof value.text === 'string') return value.text;
  if (value.value !== undefined) return plainText(value.value);
  return '';
}
export function linkedIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return [...new Set(value.flatMap(linkedIds))];
  return Array.isArray(value.recordIds) ? value.recordIds : Array.isArray(value.record_ids) ? value.record_ids : [];
}
export function normalizeSearch(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/综合管理/g, '综管').replace(/个人金融/g, '个金')
    .replace(/科技支行|支行|分行/g, '').replace(/[\s·、\-_|]/g, '');
}
export function contactHierarchy(contact) {
  return [contact.organization, contact.level1, contact.level2 ?? contact.branch, contact.department]
    .map(value => plainText(value).trim()).filter(Boolean).join(' · ');
}
export function fullContactLabel(contact) {
  return [contactHierarchy(contact), plainText(contact.name).trim()].filter(Boolean).join(' · ');
}
export function contactDisplayHierarchy(contact) {
  return plainText(contact.shortHierarchy).trim() || contactHierarchy(contact);
}
export function contactLabel(contact) {
  if (!plainText(contact.shortHierarchy).trim()) return fullContactLabel(contact);
  return [contactDisplayHierarchy(contact), plainText(contact.name).trim()].filter(Boolean).join('·');
}
export function matchesContact(contact, query) {
  const tokens = query.trim().split(/\s+/).filter(Boolean).map(normalizeSearch);
  const suffix = `${contact.department || ''}${contact.name || ''}${contact.keywords || ''}`;
  // Parenthetical branch notes should not break a combined branch + department query.
  // Keep the full form searchable too. Search never assigns a contact automatically.
  const levels = [contact.organization, contact.level1, contact.level2 ?? contact.branch].filter(Boolean);
  const variants = [...levels, levels.join(''), contactDisplayHierarchy(contact), ''].flatMap(level => [level, String(level).replace(/[（(][^）)]*[）)]/g, '')])
    .map(level => normalizeSearch(level + suffix));
  // Search explicit organizational levels and department/name, without guessing identities.
  return tokens.every(token => variants.some(haystack => haystack.includes(token)));
}
export function validateVisit(input, contacts) {
  if (!['am', 'pm'].includes(input.period)) throw new Error('请选择上午或下午。');
  // A half-day-only appointment has no exact timestamp. Midnight is used only
  // to validate/store a separate date-only field, never as its meeting time.
  const timestamp = input.timePending ? null : timestampOf(input.date, input.time);
  if (input.timePending) timestampOf(input.date, '00:00');
  else if (halfDay(timestamp) !== input.period) throw new Error('具体时间与上午/下午不一致，请重新选择。');
  const ids = [...new Set(input.customerIds || [])];
  const temporaryContact = String(input.temporaryContact || '').trim();
  if (!ids.length && !temporaryContact) throw new Error('请选择约见客户。');
  if (temporaryContact.length > 200) throw new Error('原有约见对象文字过长，请在源表核对。');
  if (ids.some(id => !contacts.some(c => c.id === id))) throw new Error('部分客户已不在可选范围，请刷新客户资料后重新选择。');
  return { timestamp, customerIds: ids,
    ...(input.timePending ? { pendingDate: input.date, pendingPeriod: input.period } : {}),
    ...(temporaryContact ? { temporaryContact } : {}) };
}
export function planSchedule(plan) {
  if (Number.isFinite(plan.timestamp)) return { date: dateKey(plan.timestamp), period: halfDay(plan.timestamp), label: timeKey(plan.timestamp), sort: plan.timestamp };
  if (!plan.pendingDate || !['am', 'pm'].includes(plan.pendingPeriod)) return null;
  try {
    const day = timestampOf(plan.pendingDate, '00:00');
    return { date: plan.pendingDate, period: plan.pendingPeriod, label: plan.pendingPeriod === 'am' ? '上午' : '下午', sort: day + (plan.pendingPeriod === 'am' ? 12 : 24) * 3600000 };
  } catch { return null; }
}
export function sameVisit(a, b) {
  return (a.timestamp ?? null) === (b.timestamp ?? null)
    && ['pendingDate', 'pendingPeriod', 'temporaryContact'].every(key => (a[key] || '') === (b[key] || ''))
    && [...a.customerIds].sort().join('|') === [...b.customerIds].sort().join('|');
}
