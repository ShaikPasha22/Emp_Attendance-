import { z } from 'zod';
import { domainSchema, ipOrCidrSchema, timeSchema } from './common';

export const enforcementModeSchema = z.enum(['OFF', 'FLAG', 'BLOCK']);
export type EnforcementMode = z.infer<typeof enforcementModeSchema>;


/** Clock-in/out restrictions. Resolved company → policy → employee override. */
export const attendanceRestrictionsSchema = z.object({
  geoCapture: z.boolean(),
  geofenceMode: enforcementModeSchema,
  maxAccuracyMeters: z.number().int().min(10).max(5000),
  remoteClockInOnApprovedRequests: z.boolean(),
  clockInWindow: z.object({ enabled: z.boolean(), start: timeSchema, end: timeSchema }),
  deviceBinding: z.object({ enabled: z.boolean(), maxDevices: z.number().int().min(1).max(5) }),
  ipRestrictionMode: enforcementModeSchema,
  selfieRequired: z.boolean(),
});
export type AttendanceRestrictions = z.infer<typeof attendanceRestrictionsSchema>;

/** Partial version used by restriction policies and employee overrides (nested objects replace whole). */
export const attendanceRestrictionsPatchSchema = attendanceRestrictionsSchema.partial();
export type AttendanceRestrictionsPatch = z.infer<typeof attendanceRestrictionsPatchSchema>;


export const signupModeSchema = z.enum(['INVITE_ONLY', 'INVITE_AND_SIGNUP']);

/** Company-wide login & account restrictions (HR/Admin controlled). */
export const securitySettingsSchema = z.object({
  signupMode: signupModeSchema,
  allowedEmailDomains: z.array(domainSchema).max(20),
  passwordMinLength: z.number().int().min(8).max(64),
  passwordRequireNumber: z.boolean(),
  passwordRequireUppercase: z.boolean(),
  passwordRequireSymbol: z.boolean(),
  lockoutMaxAttempts: z.number().int().min(3).max(20),
  lockoutMinutes: z.number().int().min(1).max(1440),
  dashboardIdleMinutes: z.number().int().min(5).max(480),
  appSessionDays: z.number().int().min(1).max(90),
  dashboardIpAllowlist: z.array(ipOrCidrSchema).max(50),
  adminTwoFactor: z.enum(['OFF', 'OPTIONAL', 'REQUIRED']),
  maxConcurrentSessions: z.number().int().min(0).max(20),
});
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;
