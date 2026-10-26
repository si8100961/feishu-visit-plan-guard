export const MINUTES = Object.freeze(['00', '15', '30', '45']);
export const HOURS = Object.freeze(Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')));

// Retain existing off-quarter-hour times; never round them on open/save.
export class TimeSelection {
  constructor(time = '') { this.set(time); }
  set(time) {
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('日期或时间不正确。');
    [this.hour, this.minute] = time ? time.split(':') : ['', ''];
    this.original = time;
  }
  get legacy() { return !!this.minute && !MINUTES.includes(this.minute); }
  get value() {
    if (!this.hour && !this.minute) return '';
    if (!HOURS.includes(this.hour) || !this.minute) throw new Error('请选择完整的小时和分钟。');
    const value = `${this.hour}:${this.minute}`;
    if (!MINUTES.includes(this.minute) && value !== this.original) throw new Error('分钟请选择 00、15、30 或 45。');
    return value;
  }
  chooseHour(hour) {
    if (!HOURS.includes(hour)) throw new Error('日期或时间不正确。');
    if (hour !== this.hour && this.legacy) this.minute = '00';
    this.hour = hour;
    if (!this.minute) this.minute = '00';
  }
  chooseMinute(minute) {
    if (!MINUTES.includes(minute)) throw new Error('分钟请选择 00、15、30 或 45。');
    this.minute = minute;
  }
  changePeriod(period) {
    if (this.hour && ((Number(this.hour) < 12) !== (period === 'am'))) this.set(period === 'am' ? '09:00' : '14:00');
  }
  clear() { this.set(''); }
}

export function createTimePicker(root, period) {
  const hour = root.querySelector('#visit-hour'), minute = root.querySelector('#visit-minute');
  const clear = root.querySelector('#clear-time'), hint = root.querySelector('#legacy-time-hint');
  const state = new TimeSelection();
  const option = value => { const node = document.createElement('option'); node.value = value; node.textContent = value; return node; };
  hour.append(...HOURS.map(option)); minute.append(...MINUTES.map(option));
  const render = () => {
    minute.querySelector('[data-legacy]')?.remove();
    if (state.legacy) {
      const legacy = option(state.minute); legacy.hidden = true; legacy.disabled = true; legacy.dataset.legacy = 'true';
      minute.append(legacy);
    }
    hour.value = state.hour; minute.value = state.minute; hint.hidden = !state.legacy;
  };
  const changed = () => {
    render();
    if (state.hour) period.value = Number(state.hour) < 12 ? 'am' : 'pm';
    root.dispatchEvent(new Event('input', { bubbles: true }));
  };
  hour.addEventListener('change', () => { state.chooseHour(hour.value); changed(); });
  minute.addEventListener('change', () => { state.chooseMinute(minute.value); changed(); });
  clear.addEventListener('click', () => { state.clear(); changed(); hour.focus(); });
  period.addEventListener('change', () => { state.changePeriod(period.value); render(); });
  return {
    set(time) { state.set(time); render(); },
    get value() { return state.value; },
    required(value) { hour.required = value; minute.required = value; clear.hidden = value; }
  };
}
