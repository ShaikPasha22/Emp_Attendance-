import {
  ATTENDANCE_FLAGS,
  attendanceRestrictionsPatchSchema,
  type AttendanceFlag,
  type AttendanceRestrictions,
  type AttendanceRestrictionsPatch,
  type GeoPoint,
} from '@app/shared';
import { ipMatches } from '../lib/ip';
import { minutesOfDay } from '../lib/time';
import { distanceMeters } from './geo';

export function readPatch(raw: unknown): AttendanceRestrictionsPatch {
  const parsed = attendanceRestrictionsPatchSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

/**
 * Effective restrictions: company default ← matching restriction policies (least → most specific)
 * ← individual employee override. Nested objects (clock-in window, device binding) replace whole.
 */
export function mergeRestrictions(
  base: AttendanceRestrictions,
  patches: (AttendanceRestrictionsPatch | null | undefined)[],
): AttendanceRestrictions {
  let result = { ...base };
  for (const patch of patches) {
    if (!patch) continue;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    result = { ...result, ...clean };
  }
  return result;
}

export interface OfficeInfo {
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  allowedIps: string[];
}

export interface PunchCheckInput {
  kind: 'IN' | 'OUT';
  restrictions: AttendanceRestrictions;
  office: OfficeInfo | null;
  point: GeoPoint | undefined;
  ip: string;
  deviceId: string | undefined;
  registeredDevices: string[];
  approvedRemote: boolean;
  /** Current local time as HH:mm in the employee's timezone */
  localTime: string;
  /** false when re-clocking in after a clock-out the same day (the clock-in window then does not apply) */
  firstPunchOfDay?: boolean;
  /** The employee's previous punch with a location, used for spoofing heuristics */
  previousPunch?: { latitude: number; longitude: number; at: Date } | null;
  now?: Date;
}

/** GPS readings older than this are rejected (a cached/old position proves nothing about "now"). */
export const MAX_LOCATION_AGE_MS = 2 * 60_000;
/** Faster than any realistic commute between two punches — likely a faked location. */
const MAX_PLAUSIBLE_SPEED_KMH = 250;

/**
 * Heuristics for unreliable or faked locations. Browsers cannot detect mock-location apps, so we
 * look for tell-tale signs instead and send the punch to HR review (never block on a heuristic).
 */
export function locationLooksSuspicious(point: GeoPoint, previous: PunchCheckInput['previousPunch'], now: Date): boolean {
  // Real GPS always reports some uncertainty; exactly 0 is typical of emulators / spoofing tools.
  if (point.accuracy < 1) return true;
  if (!previous) return false;
  const hours = (now.getTime() - previous.at.getTime()) / 3_600_000;
  const km = distanceMeters(point.latitude, point.longitude, previous.latitude, previous.longitude) / 1000;
  // Impossible travel since the last punch.
  if (hours > 0 && km > 2 && km / hours > MAX_PLAUSIBLE_SPEED_KMH) return true;
  // Bit-for-bit identical coordinates hours apart: real readings always jitter slightly.
  const same = point.latitude.toFixed(7) === previous.latitude.toFixed(7) && point.longitude.toFixed(7) === previous.longitude.toFixed(7);
  return same && hours > 0.5;
}

export interface PunchCheckResult {
  blocked: { code: string; message: string } | null;
  flags: AttendanceFlag[];
  warnings: string[];
  distanceMeters: number | null;
  registerDevice: boolean;
}

/** Pure evaluation of every HR-configured restriction for a clock-in / clock-out attempt. */
export function evaluatePunch(input: PunchCheckInput): PunchCheckResult {
  const { kind, restrictions: r, office, point } = input;
  const flags: AttendanceFlag[] = [];
  const warnings: string[] = [];
  let distance: number | null = null;
  const block = (code: string, message: string): PunchCheckResult => ({
    blocked: { code, message },
    flags,
    warnings,
    distanceMeters: distance,
    registerDevice: false,
  });

  // 1. Location capture
  if (r.geoCapture && !point) {
    return block('LOCATION_REQUIRED', 'Location is required. Please allow location access and try again.');
  }
  if (point && r.geoCapture && point.ageMs !== undefined && point.ageMs > MAX_LOCATION_AGE_MS) {
    return block('LOCATION_STALE', 'Your location reading is out of date. Please try again so we can get a fresh position.');
  }
  if (point && r.geoCapture && r.geofenceMode !== 'OFF' && point.accuracy > r.maxAccuracyMeters) {
    return block(
      'LOCATION_IMPRECISE',
      `Your location is not precise enough (±${Math.round(point.accuracy)} m). Move near a window or open area and try again.`,
    );
  }

  // 2. Clock-in time window
  if (kind === 'IN' && input.firstPunchOfDay !== false && r.clockInWindow.enabled) {
    const now = minutesOfDay(input.localTime);
    const start = minutesOfDay(r.clockInWindow.start);
    const end = minutesOfDay(r.clockInWindow.end);
    const inside = start <= end ? now >= start && now <= end : now >= start || now <= end;
    if (!inside) {
      return block(
        'OUTSIDE_CLOCK_IN_WINDOW',
        `Clock-in is allowed only between ${r.clockInWindow.start} and ${r.clockInWindow.end}.`,
      );
    }
  }

  const remoteOk = input.approvedRemote && r.remoteClockInOnApprovedRequests;
  if (remoteOk) flags.push(ATTENDANCE_FLAGS.REMOTE_APPROVED);

  // 3. Spoofing heuristics (flag for review, never block)
  if (point && r.geoCapture && locationLooksSuspicious(point, input.previousPunch, input.now ?? new Date())) {
    flags.push(ATTENDANCE_FLAGS.SUSPICIOUS_LOCATION);
    warnings.push('We could not fully verify your location. HR will review this entry.');
  }

  // 4. Geo-fence
  if (point && office && office.latitude !== null && office.longitude !== null) {
    distance = Math.round(distanceMeters(point.latitude, point.longitude, office.latitude, office.longitude));
    if (r.geofenceMode !== 'OFF' && !remoteOk && distance > office.radiusMeters) {
      if (r.geofenceMode === 'BLOCK') {
        return block(
          'OUTSIDE_GEOFENCE',
          `You are about ${formatDistance(distance)} from ${office.name}. Clocking ${kind === 'IN' ? 'in' : 'out'} is only allowed within ${office.radiusMeters} m of the office.`,
        );
      }
      flags.push(kind === 'IN' ? ATTENDANCE_FLAGS.OUTSIDE_GEOFENCE_IN : ATTENDANCE_FLAGS.OUTSIDE_GEOFENCE_OUT);
      warnings.push(`You are outside the ${office.name} area (${formatDistance(distance)} away). HR will review this entry.`);
    }
  }

  // 5. Office network (IP / Wi-Fi)
  if (r.ipRestrictionMode !== 'OFF' && !remoteOk && office && office.allowedIps.length > 0) {
    if (!ipMatches(input.ip, office.allowedIps)) {
      if (r.ipRestrictionMode === 'BLOCK') {
        return block('OUTSIDE_OFFICE_NETWORK', 'Please connect to the office Wi-Fi/network to clock in or out.');
      }
      flags.push(kind === 'IN' ? ATTENDANCE_FLAGS.OUTSIDE_NETWORK_IN : ATTENDANCE_FLAGS.OUTSIDE_NETWORK_OUT);
      warnings.push('You are not on the office network. HR will review this entry.');
    }
  }

  // 6. Device binding
  let registerDevice = false;
  if (r.deviceBinding.enabled) {
    if (!input.deviceId) return block('DEVICE_REQUIRED', 'This device could not be identified. Please reload the app.');
    if (!input.registeredDevices.includes(input.deviceId)) {
      if (input.registeredDevices.length >= r.deviceBinding.maxDevices) {
        return block(
          'DEVICE_NOT_REGISTERED',
          'This device is not registered for your account. Use your registered device or ask HR to reset it.',
        );
      }
      registerDevice = true;
    }
  }

  return { blocked: null, flags, warnings, distanceMeters: distance, registerDevice };
}

function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
