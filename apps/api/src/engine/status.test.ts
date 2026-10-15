import { describe, expect, it } from 'vitest';
import { computeDay, type DayInput } from './status';

const TZ = 'Asia/Kolkata';
// 2026-10-14 is a Wednesday; 2026-10-17 is a Saturday.
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

const base = (over: Partial<DayInput> = {}): DayInput => ({
  date: '2026-10-14',
  tz: TZ,
  now: at('2026-10-15', '12:00'),
  shift: { startTime: '09:30', endTime: '18:30', graceMinutes: 15, earlyOutGraceMinutes: 0 },
  policy: { fullDayMinutes: 480, halfDayMinutes: 270, absentBelowMinutes: 120, weeklyOffs: [6, 7], missedPunchCloseHours: 4 },
  clockIn: null,
  clockOut: null,
  existingFlags: [],
  reviewStatus: 'NONE',
  statusOverride: null,
  approvedRequest: null,
  ...over,
});

describe('computeDay', () => {
  it('marks a full on-time day as Present', () => {
    const r = computeDay(base({ clockIn: at('2026-10-14', '09:35'), clockOut: at('2026-10-14', '18:40') }));
    expect(r.status).toBe('P');
    expect(r.workMinutes).toBe(545);
    expect(r.flags).not.toContain('LATE');
  });

  it('respects the grace period and marks Late after it', () => {
    expect(computeDay(base({ clockIn: at('2026-10-14', '09:45'), clockOut: at('2026-10-14', '18:45') })).status).toBe('P');
    const late = computeDay(base({ clockIn: at('2026-10-14', '09:46'), clockOut: at('2026-10-14', '18:45') }));
    expect(late.status).toBe('L');
    expect(late.lateMinutes).toBe(16);
    expect(late.flags).toContain('LATE');
  });

  it('applies half-day and absent thresholds', () => {
    expect(computeDay(base({ clockIn: at('2026-10-14', '09:30'), clockOut: at('2026-10-14', '13:00') })).status).toBe('HD');
    expect(computeDay(base({ clockIn: at('2026-10-14', '09:30'), clockOut: at('2026-10-14', '10:30') })).status).toBe('A');
  });

  it('flags early-out and short hours', () => {
    const r = computeDay(base({ clockIn: at('2026-10-14', '09:30'), clockOut: at('2026-10-14', '17:00') }));
    expect(r.status).toBe('EO');
    expect(r.flags).toEqual(expect.arrayContaining(['EARLY_OUT', 'SHORT_HOURS']));
  });

  it('marks Absent only once the day has closed', () => {
    expect(computeDay(base({ now: at('2026-10-14', '20:00') })).status).toBeNull();
    expect(computeDay(base({ now: at('2026-10-14', '22:31') })).status).toBe('A');
  });

  it('marks weekly offs and work on weekly offs', () => {
    expect(computeDay(base({ date: '2026-10-17', now: at('2026-10-19', '09:00') })).status).toBe('WO');
    const worked = computeDay(
      base({ date: '2026-10-17', now: at('2026-10-19', '09:00'), clockIn: at('2026-10-17', '10:00'), clockOut: at('2026-10-17', '18:00') }),
    );
    expect(worked.flags).toContain('WORKED_ON_WEEKLY_OFF');
  });

  it('marks a missing clock-out as Missed Punch after the close window', () => {
    const open = base({ clockIn: at('2026-10-14', '09:30') });
    expect(computeDay({ ...open, now: at('2026-10-14', '15:00') }).status).toBe('P');
    const mp = computeDay({ ...open, now: at('2026-10-14', '23:00') });
    expect(mp.status).toBe('MP');
    expect(mp.flags).toContain('MISSED_PUNCH');
  });

  it('uses approved WFH / On-duty requests', () => {
    expect(computeDay(base({ approvedRequest: 'WFH' })).status).toBe('WFH');
    expect(computeDay(base({ approvedRequest: 'ON_DUTY' })).status).toBe('OD');
    expect(
      computeDay(base({ approvedRequest: 'WFH', clockIn: at('2026-10-14', '09:30'), clockOut: at('2026-10-14', '18:30') })).status,
    ).toBe('WFH');
  });

  it('shows Flagged while under review, Absent if rejected, and honours HR overrides', () => {
    const day = { clockIn: at('2026-10-14', '09:30'), clockOut: at('2026-10-14', '18:30') };
    expect(computeDay(base({ ...day, reviewStatus: 'PENDING' })).status).toBe('FL');
    expect(computeDay(base({ ...day, reviewStatus: 'APPROVED' })).status).toBe('P');
    expect(computeDay(base({ ...day, reviewStatus: 'REJECTED' })).status).toBe('A');
    expect(computeDay(base({ ...day, reviewStatus: 'PENDING', statusOverride: 'OD' })).status).toBe('OD');
  });

  it('keeps location flags but recomputes computed flags', () => {
    const r = computeDay(
      base({ clockIn: at('2026-10-14', '09:30'), clockOut: at('2026-10-14', '18:30'), existingFlags: ['OUTSIDE_GEOFENCE_IN', 'LATE'] }),
    );
    expect(r.flags).toContain('OUTSIDE_GEOFENCE_IN');
    expect(r.flags).not.toContain('LATE');
  });

  it('handles overnight shifts', () => {
    const night = { startTime: '22:00', endTime: '06:00', graceMinutes: 10, earlyOutGraceMinutes: 0 };
    const r = computeDay(base({ shift: night, clockIn: at('2026-10-14', '22:05'), clockOut: at('2026-10-15', '06:05'), now: at('2026-10-15', '12:00') }));
    expect(r.status).toBe('P');
    expect(r.workMinutes).toBe(480);
  });

  it('works without a shift (no late / early checks)', () => {
    const r = computeDay(base({ shift: null, clockIn: at('2026-10-14', '11:00'), clockOut: at('2026-10-14', '19:30') }));
    expect(r.status).toBe('P');
    expect(r.lateMinutes).toBe(0);
  });
});
