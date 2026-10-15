import { DEFAULT_ATTENDANCE_RESTRICTIONS, type AttendanceRestrictions } from '@app/shared';
import { describe, expect, it } from 'vitest';
import { ipMatches } from '../lib/ip';
import { evaluatePunch, locationLooksSuspicious, mergeRestrictions, type PunchCheckInput } from './restrictions';

const office = { name: 'HQ', latitude: 12.9755, longitude: 77.6066, radiusMeters: 250, allowedIps: ['203.0.113.0/24'] };
const atOffice = { latitude: 12.9756, longitude: 77.6067, accuracy: 20 };
const farAway = { latitude: 12.99, longitude: 77.62, accuracy: 20 };

const input = (r: Partial<AttendanceRestrictions> = {}, over: Partial<PunchCheckInput> = {}): PunchCheckInput => ({
  kind: 'IN',
  restrictions: { ...DEFAULT_ATTENDANCE_RESTRICTIONS, ...r },
  office,
  point: atOffice,
  ip: '203.0.113.7',
  deviceId: 'dev-1',
  registeredDevices: [],
  approvedRemote: false,
  localTime: '09:30',
  ...over,
});

describe('evaluatePunch', () => {
  it('allows a normal clock-in at the office with defaults', () => {
    const r = evaluatePunch(input());
    expect(r.blocked).toBeNull();
    expect(r.flags).toEqual([]);
    expect(r.distanceMeters).toBeLessThan(50);
  });

  it('requires location when geo capture is on', () => {
    expect(evaluatePunch(input({}, { point: undefined })).blocked?.code).toBe('LOCATION_REQUIRED');
    expect(evaluatePunch(input({ geoCapture: false }, { point: undefined })).blocked).toBeNull();
  });

  it('rejects imprecise locations', () => {
    expect(evaluatePunch(input({}, { point: { ...atOffice, accuracy: 500 } })).blocked?.code).toBe('LOCATION_IMPRECISE');
  });

  it('flags or blocks outside the geo-fence depending on mode', () => {
    const flagged = evaluatePunch(input({ geofenceMode: 'FLAG' }, { point: farAway }));
    expect(flagged.blocked).toBeNull();
    expect(flagged.flags).toContain('OUTSIDE_GEOFENCE_IN');
    expect(evaluatePunch(input({ geofenceMode: 'BLOCK' }, { point: farAway })).blocked?.code).toBe('OUTSIDE_GEOFENCE');
    expect(evaluatePunch(input({ geofenceMode: 'OFF' }, { point: farAway })).flags).toEqual([]);
  });

  it('skips the geo-fence on approved remote days', () => {
    const r = evaluatePunch(input({ geofenceMode: 'BLOCK' }, { point: farAway, approvedRemote: true }));
    expect(r.blocked).toBeNull();
    expect(r.flags).toContain('REMOTE_APPROVED');
  });

  it('enforces the clock-in window only for clock-in', () => {
    const w = { clockInWindow: { enabled: true, start: '08:00', end: '11:00' } };
    expect(evaluatePunch(input(w, { localTime: '11:30' })).blocked?.code).toBe('OUTSIDE_CLOCK_IN_WINDOW');
    expect(evaluatePunch(input(w, { localTime: '10:59' })).blocked).toBeNull();
    expect(evaluatePunch(input(w, { kind: 'OUT', localTime: '19:00' })).blocked).toBeNull();
  });

  it('enforces office network restriction', () => {
    expect(evaluatePunch(input({ ipRestrictionMode: 'BLOCK' }, { ip: '198.51.100.1' })).blocked?.code).toBe('OUTSIDE_OFFICE_NETWORK');
    expect(evaluatePunch(input({ ipRestrictionMode: 'FLAG' }, { ip: '198.51.100.1' })).flags).toContain('OUTSIDE_NETWORK_IN');
    expect(evaluatePunch(input({ ipRestrictionMode: 'BLOCK' })).blocked).toBeNull();
  });

  it('binds the first device and blocks unknown devices once full', () => {
    const binding = { deviceBinding: { enabled: true, maxDevices: 1 } };
    expect(evaluatePunch(input(binding)).registerDevice).toBe(true);
    expect(evaluatePunch(input(binding, { registeredDevices: ['dev-1'] })).registerDevice).toBe(false);
    expect(evaluatePunch(input(binding, { registeredDevices: ['dev-0'] })).blocked?.code).toBe('DEVICE_NOT_REGISTERED');
  });
});

describe('location integrity', () => {
  const now = new Date('2026-10-15T10:00:00Z');

  it('rejects stale (cached) GPS readings', () => {
    expect(evaluatePunch(input({}, { point: { ...atOffice, ageMs: 5 * 60_000 } })).blocked?.code).toBe('LOCATION_STALE');
    expect(evaluatePunch(input({}, { point: { ...atOffice, ageMs: 3_000 } })).blocked).toBeNull();
  });

  it('skips the clock-in window when clocking in again the same day', () => {
    const w = { clockInWindow: { enabled: true, start: '08:00', end: '11:00' } };
    expect(evaluatePunch(input(w, { localTime: '15:00', firstPunchOfDay: false })).blocked).toBeNull();
  });

  it('flags zero-accuracy readings, impossible travel and frozen coordinates', () => {
    expect(locationLooksSuspicious({ ...atOffice, accuracy: 0 }, null, now)).toBe(true);
    const tenMinAgo = new Date(now.getTime() - 10 * 60_000);
    // ~1,000 km away ten minutes ago
    expect(locationLooksSuspicious(atOffice, { latitude: 19.07, longitude: 72.87, at: tenMinAgo }, now)).toBe(true);
    const threeHoursAgo = new Date(now.getTime() - 3 * 3_600_000);
    expect(locationLooksSuspicious(atOffice, { latitude: atOffice.latitude, longitude: atOffice.longitude, at: threeHoursAgo }, now)).toBe(true);
    // Normal: a few metres of jitter from this morning
    expect(locationLooksSuspicious(atOffice, { latitude: 12.97561, longitude: 77.60672, at: threeHoursAgo }, now)).toBe(false);
  });

  it('sends suspicious punches to review instead of blocking', () => {
    const r = evaluatePunch(input({}, { point: { ...atOffice, accuracy: 0 } }));
    expect(r.blocked).toBeNull();
    expect(r.flags).toContain('SUSPICIOUS_LOCATION');
  });
});

describe('mergeRestrictions', () => {
  it('applies patches in order and ignores undefined values', () => {
    const merged = mergeRestrictions(DEFAULT_ATTENDANCE_RESTRICTIONS, [
      { geofenceMode: 'BLOCK', maxAccuracyMeters: 100 },
      { geofenceMode: 'OFF', maxAccuracyMeters: undefined },
      null,
    ]);
    expect(merged.geofenceMode).toBe('OFF');
    expect(merged.maxAccuracyMeters).toBe(100);
    expect(merged.geoCapture).toBe(true);
  });
});

describe('ipMatches', () => {
  it('matches single IPs, CIDRs and IPv4-mapped IPv6', () => {
    expect(ipMatches('203.0.113.9', ['203.0.113.0/24'])).toBe(true);
    expect(ipMatches('::ffff:203.0.113.9', ['203.0.113.0/24'])).toBe(true);
    expect(ipMatches('10.0.0.1', ['10.0.0.1'])).toBe(true);
    expect(ipMatches('10.0.0.2', ['10.0.0.1', '192.168.0.0/16'])).toBe(false);
    expect(ipMatches('2001:db8::1', ['2001:db8::/32'])).toBe(true);
  });
});
