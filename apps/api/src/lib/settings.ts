import {
  DEFAULT_ATTENDANCE_RESTRICTIONS,
  DEFAULT_SECURITY_SETTINGS,
  DEFAULT_TIMEZONE,
  attendanceRestrictionsSchema,
  securitySettingsSchema,
  type AttendanceRestrictions,
  type SecuritySettings,
} from '@app/shared';
import { prisma } from './prisma';

export interface CompanySettings {
  name: string;
  timezone: string;
  security: SecuritySettings;
  attendanceRestrictions: AttendanceRestrictions;
}

let cache: { value: CompanySettings; at: number } | null = null;
const TTL_MS = 30_000;

/** Company settings with a short in-memory cache (settings change rarely; invalidated on update). */
export async function getCompanySettings(): Promise<CompanySettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await prisma.company.findUnique({ where: { id: 'company' } });
  const value: CompanySettings = {
    name: row?.name ?? 'Company',
    timezone: row?.timezone ?? DEFAULT_TIMEZONE,
    // Merge onto defaults so newly added settings get sensible values for existing rows.
    security: securitySettingsSchema.parse({ ...DEFAULT_SECURITY_SETTINGS, ...((row?.security as object) ?? {}) }),
    attendanceRestrictions: attendanceRestrictionsSchema.parse({
      ...DEFAULT_ATTENDANCE_RESTRICTIONS,
      ...((row?.attendanceRestrictions as object) ?? {}),
    }),
  };
  cache = { value, at: Date.now() };
  return value;
}

export function invalidateCompanySettings() {
  cache = null;
}
