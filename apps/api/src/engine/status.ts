import { ATTENDANCE_FLAGS, type AttendanceFlag, type AttendanceStatus } from '@app/shared';
import { DateTime } from 'luxon';
import { atLocalTime, minutesOfDay, weekdayOf } from '../lib/time';

export interface ShiftRule {
  name?: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  earlyOutGraceMinutes: number;
}

export interface PolicyRule {
  fullDayMinutes: number;
  halfDayMinutes: number;
  absentBelowMinutes: number;
  weeklyOffs: number[];
  missedPunchCloseHours: number;
}

export type ReviewState = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface DayInput {
  date: string;
  tz: string;
  now: Date;
  shift: ShiftRule | null;
  policy: PolicyRule;
  clockIn: Date | null;
  clockOut: Date | null;
  /** Flags already on the record (location / network flags are kept; computed flags are recalculated). */
  existingFlags: string[];
  reviewStatus: ReviewState;
  statusOverride: AttendanceStatus | null;
  approvedRequest: 'WFH' | 'ON_DUTY' | null;
  onLeave?: boolean;
  isHoliday?: boolean;
}

export interface DayResult {
  /** null = the day is still in progress and nothing can be concluded yet */
  status: AttendanceStatus | null;
  flags: AttendanceFlag[];
  workMinutes: number | null;
  lateMinutes: number;
  /** true once the day can no longer change on its own (past shift end + close window) */
  dayClosed: boolean;
}

const COMPUTED_FLAGS = new Set<string>([
  ATTENDANCE_FLAGS.LATE,
  ATTENDANCE_FLAGS.EARLY_OUT,
  ATTENDANCE_FLAGS.SHORT_HOURS,
  ATTENDANCE_FLAGS.MISSED_PUNCH,
  ATTENDANCE_FLAGS.WORKED_ON_WEEKLY_OFF,
]);

export function shiftWindow(date: string, shift: ShiftRule, tz: string) {
  const overnight = minutesOfDay(shift.endTime) <= minutesOfDay(shift.startTime);
  return {
    start: atLocalTime(date, shift.startTime, tz),
    end: atLocalTime(date, shift.endTime, tz, overnight ? 1 : 0),
  };
}

/** The moment after which a day is considered over (used for absent / missed-punch marking). */
export function dayCloseTime(date: string, shift: ShiftRule | null, policy: PolicyRule, tz: string): Date {
  const end = shift
    ? shiftWindow(date, shift, tz).end
    : DateTime.fromISO(date, { zone: tz }).endOf('day').toJSDate();
  return new Date(end.getTime() + policy.missedPunchCloseHours * 3_600_000);
}

const minutesBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 60_000);

/**
 * Computes the attendance status for one employee-day. Pure and deterministic:
 * the same inputs always give the same result, so the day can be safely recomputed
 * whenever a request is approved, HR overrides, or a job runs again.
 */
export function computeDay(input: DayInput): DayResult {
  const { date, tz, shift, policy, clockIn, clockOut } = input;
  const flags = new Set<AttendanceFlag>(
    input.existingFlags.filter((f) => !COMPUTED_FLAGS.has(f)) as AttendanceFlag[],
  );
  const isWeeklyOff = policy.weeklyOffs.includes(weekdayOf(date));
  const dayClosed = input.now.getTime() >= dayCloseTime(date, shift, policy, tz).getTime();
  const window = shift ? shiftWindow(date, shift, tz) : null;

  let lateMinutes = 0;
  let isLate = false;
  if (clockIn && window && shift) {
    const after = minutesBetween(window.start, clockIn);
    if (after > shift.graceMinutes) {
      isLate = true;
      lateMinutes = after;
      flags.add(ATTENDANCE_FLAGS.LATE);
    }
  }

  const workMinutes = clockIn && clockOut ? Math.max(0, minutesBetween(clockIn, clockOut)) : null;
  let status: AttendanceStatus | null;

  if (!clockIn) {
    if (input.onLeave) status = 'LV';
    else if (input.isHoliday) status = 'H';
    else if (input.approvedRequest === 'ON_DUTY') status = 'OD';
    else if (input.approvedRequest === 'WFH') status = 'WFH';
    else if (isWeeklyOff) status = 'WO';
    else status = dayClosed ? 'A' : null;
  } else {
    if (isWeeklyOff || input.isHoliday) flags.add(ATTENDANCE_FLAGS.WORKED_ON_WEEKLY_OFF);
    if (!clockOut) {
      if (dayClosed) {
        status = 'MP';
        flags.add(ATTENDANCE_FLAGS.MISSED_PUNCH);
      } else if (input.approvedRequest === 'ON_DUTY') status = 'OD';
      else if (input.approvedRequest === 'WFH') status = 'WFH';
      else status = isLate ? 'L' : 'P';
    } else {
      const wm = workMinutes ?? 0;
      const isEarlyOut =
        !!window && !!shift && clockOut.getTime() < window.end.getTime() - shift.earlyOutGraceMinutes * 60_000;
      if (isEarlyOut) flags.add(ATTENDANCE_FLAGS.EARLY_OUT);
      if (wm >= policy.halfDayMinutes && wm < policy.fullDayMinutes) flags.add(ATTENDANCE_FLAGS.SHORT_HOURS);

      if (wm < policy.absentBelowMinutes) status = 'A';
      else if (wm < policy.halfDayMinutes) status = 'HD';
      else if (input.approvedRequest === 'ON_DUTY') status = 'OD';
      else if (input.approvedRequest === 'WFH') status = 'WFH';
      else if (isLate) status = 'L';
      else if (isEarlyOut) status = 'EO';
      else status = 'P';
    }
  }

  if (input.statusOverride) {
    status = input.statusOverride;
  } else if (input.reviewStatus === 'PENDING' && clockIn) {
    status = 'FL';
  } else if (input.reviewStatus === 'REJECTED' && clockIn) {
    status = 'A';
  }

  return { status, flags: [...flags], workMinutes, lateMinutes, dayClosed };
}
