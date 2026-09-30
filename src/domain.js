export const OFFICE_TIME_ZONE = 'Asia/Shanghai';
export const DAY_START = 8 * 60;
export const DAY_END = 17 * 60;
export const LUNCH_START = 12 * 60;
export const LUNCH_END = 13 * 60;
export const SLOT_MINUTES = 30;

function partsInZone(instant, timeZone = OFFICE_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(formatter.formatToParts(instant)
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

export function officeDateKey(instant = new Date(), timeZone = OFFICE_TIME_ZONE) {
  const p = partsInZone(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function officeTime(instant = new Date(), timeZone = OFFICE_TIME_ZONE) {
  const p = partsInZone(instant, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function parseTime(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return NaN;
  const [hour, minute] = value.split(':').map(Number);
  return hour < 24 && minute < 60 ? hour * 60 + minute : NaN;
}

export function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekStart(dateKey) {
  const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  if (Number.isNaN(weekday)) throw new RangeError('Invalid date');
  return shiftDateKey(dateKey, -((weekday + 6) % 7));
}

// Convert an office wall time to UTC without relying on the viewer's computer timezone.
export function toOfficeISO(dateKey, time, timeZone = OFFICE_TIME_ZONE) {
  const minutes = parseTime(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isFinite(minutes)) {
    throw new RangeError('Invalid office date or time');
  }
  const target = Date.parse(`${dateKey}T${time}:00.000Z`);
  if (Number.isNaN(target) || new Date(target).toISOString().slice(0, 10) !== dateKey) {
    throw new RangeError('Invalid office date or time');
  }
  let utc = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const p = partsInZone(new Date(utc), timeZone);
    const localAsUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const correction = target - localAsUTC;
    if (correction === 0) break;
    utc += correction;
  }
  const result = new Date(utc);
  if (officeDateKey(result, timeZone) !== dateKey || officeTime(result, timeZone) !== time) {
    throw new RangeError('Office wall time does not exist');
  }
  return result.toISOString();
}

function error(code, message, conflict) {
  return { ok: false, code, message, ...(conflict ? { conflict } : {}) };
}

export function validateDraft(draft, options = {}) {
  const { now = new Date(), bookings = [], excludeId, allowPast = false, timeZone = OFFICE_TIME_ZONE } = options;
  const title = String(draft?.title ?? '').trim();
  const booker = String(draft?.booker ?? '').trim();
  if (!title || !booker) return error('REQUIRED', '请填写会议名称和预订人。');
  if (title.length > 120 || booker.length > 80 || String(draft.remark ?? '').length > 500) {
    return error('VALIDATION', '填写的内容过长。');
  }
  if (typeof draft.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
    return error('DATE', '请选择有效日期。');
  }
  const start = parseTime(draft.startTime);
  const end = parseTime(draft.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return error('TIME', '请选择有效时间。');
  if (end <= start) return error('ORDER', '结束时间必须晚于开始时间。');
  if (start < DAY_START || end > DAY_END) return error('HOURS', '可预约时间为 08:00–17:00。');
  if (start % SLOT_MINUTES || end % SLOT_MINUTES) return error('SLOT', '请使用半小时档位。');
  if (start < LUNCH_END && end > LUNCH_START) return error('LUNCH', '12:00–13:00 为午休时间。');
  let starts_at;
  let ends_at;
  try {
    starts_at = toOfficeISO(draft.date, draft.startTime, timeZone);
    ends_at = toOfficeISO(draft.date, draft.endTime, timeZone);
  } catch {
    return error('DATE', '请选择有效日期。');
  }
  if (!allowPast && Date.parse(starts_at) < new Date(now).getTime()) {
    return error('PAST', '不能预订已经开始的时段。');
  }
  const conflict = bookings.find((booking) =>
    booking.status !== 'cancelled' && booking.id !== excludeId &&
    Date.parse(starts_at) < Date.parse(booking.ends_at) &&
    Date.parse(ends_at) > Date.parse(booking.starts_at));
  if (conflict) return error('CONFLICT', '所选时间与已有会议重叠。', conflict);
  return { ok: true, starts_at, ends_at };
}

export function availabilityForDate(bookings, dateKey, timeZone = OFFICE_TIME_ZONE) {
  return Array.from({ length: (DAY_END - DAY_START) / SLOT_MINUTES }, (_, index) => {
    const startMinute = DAY_START + index * SLOT_MINUTES;
    const start = minutesToTime(startMinute);
    const end = minutesToTime(startMinute + SLOT_MINUTES);
    const startsAt = Date.parse(toOfficeISO(dateKey, start, timeZone));
    const endsAt = Date.parse(toOfficeISO(dateKey, end, timeZone));
    const booking = bookings.find((item) => item.status !== 'cancelled' &&
      startsAt < Date.parse(item.ends_at) && endsAt > Date.parse(item.starts_at));
    const status = startMinute >= LUNCH_START && startMinute < LUNCH_END
      ? 'lunch' : booking ? 'booked' : 'available';
    return { start, end, status, booking: status === 'booked' ? booking : null };
  });
}

export function statusAt(bookings, instant = new Date()) {
  const timestamp = new Date(instant).getTime();
  const upcoming = bookings
    .filter((booking) => booking.status !== 'cancelled' && Date.parse(booking.ends_at) > timestamp)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const current = upcoming.find((booking) => Date.parse(booking.starts_at) <= timestamp) ?? null;
  const next = upcoming.find((booking) => Date.parse(booking.starts_at) > timestamp) ?? null;
  return { current, next };
}
