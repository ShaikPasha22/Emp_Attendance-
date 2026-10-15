// Pure values and helpers with no runtime dependency on zod, so the web bundle stays small.
import type { AppliesTo } from './schemas/common';
import type { AttendanceRestrictions, EnforcementMode, SecuritySettings } from './schemas/restrictions';

export const EMPTY_APPLIES_TO: AppliesTo = {
  businessUnitIds: [],
  departmentIds: [],
  locationIds: [],
  gradeIds: [],
  employeeTypes: [],
};

export const ENFORCEMENT_MODE_LABELS: Record<EnforcementMode, string> = {
  OFF: 'Off',
  FLAG: 'Allow & flag for HR',
  BLOCK: 'Block',
};

export const DEFAULT_ATTENDANCE_RESTRICTIONS: AttendanceRestrictions = {
  geoCapture: true,
  geofenceMode: 'FLAG',
  maxAccuracyMeters: 150,
  remoteClockInOnApprovedRequests: true,
  clockInWindow: { enabled: false, start: '07:00', end: '12:00' },
  deviceBinding: { enabled: false, maxDevices: 1 },
  ipRestrictionMode: 'OFF',
  selfieRequired: false,
};

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  signupMode: 'INVITE_AND_SIGNUP',
  allowedEmailDomains: [],
  passwordMinLength: 8,
  passwordRequireNumber: true,
  passwordRequireUppercase: false,
  passwordRequireSymbol: false,
  lockoutMaxAttempts: 5,
  lockoutMinutes: 15,
  dashboardIdleMinutes: 30,
  appSessionDays: 30,
  dashboardIpAllowlist: [],
  adminTwoFactor: 'OFF',
  maxConcurrentSessions: 0,
};

export type PasswordRules = Pick<
  SecuritySettings,
  'passwordMinLength' | 'passwordRequireNumber' | 'passwordRequireUppercase' | 'passwordRequireSymbol'
>;

/** Returns the list of password rules and whether each passes — used for live UI checks and server validation. */
export function checkPassword(password: string, rules: PasswordRules) {
  const checks = [
    { label: `At least ${rules.passwordMinLength} characters`, ok: password.length >= rules.passwordMinLength },
    { label: 'Contains a letter', ok: /[a-zA-Z]/.test(password) },
  ];
  if (rules.passwordRequireNumber) checks.push({ label: 'Contains a number', ok: /\d/.test(password) });
  if (rules.passwordRequireUppercase)
    checks.push({ label: 'Contains an uppercase letter', ok: /[A-Z]/.test(password) });
  if (rules.passwordRequireSymbol)
    checks.push({ label: 'Contains a symbol', ok: /[^a-zA-Z0-9]/.test(password) });
  return { ok: checks.every((c) => c.ok) && password.length <= 128, checks };
}
