import { DateTime } from 'luxon';

/** Calendar date string (YYYY-MM-DD) → Date at UTC midnight, as stored in `@db.Date` columns. */
export const dateKeyToDb = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

/** `@db.Date` value → YYYY-MM-DD. */
export const dbDateToKey = (d: Date) => d.toISOString().slice(0, 10);

/** Today's calendar date in a timezone. */
export const todayIn = (tz: string, now: Date = new Date()) =>
  DateTime.fromJSDate(now).setZone(tz).toISODate()!;

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export const weekdayOf = (dateKey: string) => DateTime.fromISO(dateKey, { zone: 'utc' }).weekday;

/** Combine a calendar date + HH:mm in a timezone into an absolute instant. */
export function atLocalTime(dateKey: string, hhmm: string, tz: string, addDays = 0) {
  const [h, m] = hhmm.split(':').map(Number);
  return DateTime.fromISO(dateKey, { zone: tz })
    .plus({ days: addDays })
    .set({ hour: h, minute: m, second: 0, millisecond: 0 })
    .toJSDate();
}

/** HH:mm of an instant in a timezone. */
export const localTimeOf = (d: Date, tz: string) => DateTime.fromJSDate(d).setZone(tz).toFormat('HH:mm');

export const minutesOfDay = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** Every calendar date from `from` to `to` inclusive. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(from, { zone: 'utc' });
  const end = DateTime.fromISO(to, { zone: 'utc' });
  while (d <= end) {
    out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}

export const addDays = (dateKey: string, days: number) =>
  DateTime.fromISO(dateKey, { zone: 'utc' }).plus({ days }).toISODate()!;

export const diffDays = (from: string, to: string) =>
  Math.round(DateTime.fromISO(to, { zone: 'utc' }).diff(DateTime.fromISO(from, { zone: 'utc' }), 'days').days);

export function monthRange(month: string) {
  const start = DateTime.fromISO(`${month}-01`, { zone: 'utc' });
  return { from: start.toISODate()!, to: start.endOf('month').toISODate()! };
}

export const isValidTimezone = (tz: string) => DateTime.local().setZone(tz).isValid;
