import type { AttendancePolicy, Location, RestrictionPolicy, Shift, User } from '@prisma/client';
import type { AttendanceRestrictions, ShiftInfo } from '@app/shared';
import { notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { getCompanySettings, type CompanySettings } from '../lib/settings';
import { pickPolicy, rankPolicies, type EmployeeAttributes } from './applicability';
import { mergeRestrictions, readPatch, type OfficeInfo } from './restrictions';
import type { PolicyRule, ShiftRule } from './status';

interface PolicySet {
  shifts: Shift[];
  attendancePolicies: AttendancePolicy[];
  restrictionPolicies: RestrictionPolicy[];
}

let cache: { value: PolicySet; at: number } | null = null;
const TTL_MS = 30_000;

/** All policies, cached briefly in memory. Admin changes call `invalidatePolicies()`. */
export async function getPolicySet(): Promise<PolicySet> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const [shifts, attendancePolicies, restrictionPolicies] = await Promise.all([
    prisma.shift.findMany({ where: { isActive: true } }),
    prisma.attendancePolicy.findMany({ where: { isActive: true } }),
    prisma.restrictionPolicy.findMany({ where: { isActive: true } }),
  ]);
  const value = { shifts, attendancePolicies, restrictionPolicies };
  cache = { value, at: Date.now() };
  return value;
}

export function invalidatePolicies() {
  cache = null;
}

export const FALLBACK_POLICY: PolicyRule = {
  fullDayMinutes: 480,
  halfDayMinutes: 270,
  absentBelowMinutes: 120,
  weeklyOffs: [6, 7],
  missedPunchCloseHours: 4,
};

export interface PolicyLimits {
  regularizationWindowDays: number;
  maxRegularizationsPerMonth: number;
}

export interface EmployeeContext {
  tz: string;
  attrs: EmployeeAttributes;
  shift: ShiftRule | null;
  shiftInfo: ShiftInfo | null;
  policy: PolicyRule;
  limits: PolicyLimits;
  restrictions: AttendanceRestrictions;
  office: OfficeInfo | null;
}

export type ContextUser = Pick<
  User,
  'businessUnitId' | 'departmentId' | 'locationId' | 'gradeId' | 'employeeType' | 'shiftId' | 'restrictionOverride'
> & { location: Location | null };

/** Resolve shift, attendance policy and restrictions for one employee (pure given its inputs). */
export function resolveContext(user: ContextUser, set: PolicySet, company: CompanySettings): EmployeeContext {
  const attrs: EmployeeAttributes = {
    businessUnitId: user.businessUnitId,
    departmentId: user.departmentId,
    locationId: user.locationId,
    gradeId: user.gradeId,
    employeeType: user.employeeType,
  };

  const shiftRow =
    (user.shiftId ? set.shifts.find((s) => s.id === user.shiftId) : undefined) ?? pickPolicy(set.shifts, attrs);
  const policyRow = pickPolicy(set.attendancePolicies, attrs);

  // Least specific first so the most specific policy wins, then the individual override on top.
  const patches = rankPolicies(set.restrictionPolicies, attrs)
    .reverse()
    .map((p) => readPatch(p.settings));
  const restrictions = mergeRestrictions(company.attendanceRestrictions, [
    ...patches,
    user.restrictionOverride ? readPatch(user.restrictionOverride) : null,
  ]);

  const loc = user.location && user.location.isActive ? user.location : null;
  return {
    tz: loc?.timezone ?? company.timezone,
    attrs,
    shift: shiftRow
      ? {
          name: shiftRow.name,
          startTime: shiftRow.startTime,
          endTime: shiftRow.endTime,
          graceMinutes: shiftRow.graceMinutes,
          earlyOutGraceMinutes: shiftRow.earlyOutGraceMinutes,
        }
      : null,
    shiftInfo: shiftRow
      ? {
          id: shiftRow.id,
          name: shiftRow.name,
          startTime: shiftRow.startTime,
          endTime: shiftRow.endTime,
          graceMinutes: shiftRow.graceMinutes,
        }
      : null,
    policy: policyRow
      ? {
          fullDayMinutes: policyRow.fullDayMinutes,
          halfDayMinutes: policyRow.halfDayMinutes,
          absentBelowMinutes: policyRow.absentBelowMinutes,
          weeklyOffs: policyRow.weeklyOffs,
          missedPunchCloseHours: policyRow.missedPunchCloseHours,
        }
      : FALLBACK_POLICY,
    limits: {
      regularizationWindowDays: policyRow?.regularizationWindowDays ?? 30,
      maxRegularizationsPerMonth: policyRow?.maxRegularizationsPerMonth ?? 5,
    },
    restrictions,
    office: loc
      ? {
          name: loc.name,
          latitude: loc.latitude,
          longitude: loc.longitude,
          radiusMeters: loc.radiusMeters,
          allowedIps: loc.allowedIps,
        }
      : null,
  };
}

export async function loadContext(userId: string): Promise<EmployeeContext> {
  const [user, set, company] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { location: true } }),
    getPolicySet(),
    getCompanySettings(),
  ]);
  if (!user) throw notFound('Employee');
  return resolveContext(user, set, company);
}
