import { z } from 'zod';
import { ALL_PERMISSIONS, APPROVER_TYPES, PROFILE_SCOPES, USER_STATUSES } from '../constants';
import {
  appliesToSchema,
  dateSchema,
  emailSchema,
  employeeTypeSchema,
  idSchema,
  ipOrCidrSchema,
  timeSchema,
} from './common';
import { attendanceRestrictionsPatchSchema } from './restrictions';

const optionalId = idSchema.nullable().optional();
const name = z.string().trim().min(1, 'Required').max(100);

// ---------- Employees ----------
export const employeeBaseSchema = z.object({
  firstName: z.string().trim().min(1, 'Required').max(60),
  lastName: z.string().trim().min(1, 'Required').max(60),
  email: emailSchema,
  phone: z.string().trim().max(20).nullable().optional(),
  employeeCode: z.string().trim().max(30).optional(),
  employeeType: employeeTypeSchema.default('PERMANENT'),
  joiningDate: dateSchema.nullable().optional(),
  businessUnitId: optionalId,
  departmentId: optionalId,
  designationId: optionalId,
  gradeId: optionalId,
  locationId: optionalId,
  shiftId: optionalId,
  managerId: optionalId,
  profileId: optionalId,
  hrScopeBusinessUnitIds: z.array(idSchema).optional(),
  hrScopeLocationIds: z.array(idSchema).optional(),
});
export const inviteEmployeeSchema = employeeBaseSchema;
export type InviteEmployeeInput = z.infer<typeof inviteEmployeeSchema>;

export const updateEmployeeSchema = employeeBaseSchema.partial();

export const bulkInviteSchema = z.object({
  employees: z
    .array(
      z.object({
        firstName: z.string().trim().min(1).max(60),
        lastName: z.string().trim().min(1).max(60),
        email: emailSchema,
        phone: z.string().trim().max(20).optional(),
        employeeCode: z.string().trim().max(30).optional(),
        employeeType: employeeTypeSchema.optional(),
        department: z.string().trim().max(100).optional(),
        designation: z.string().trim().max(100).optional(),
        location: z.string().trim().max(100).optional(),
        managerEmail: emailSchema.optional(),
      }),
    )
    .min(1)
    .max(500),
  sendEmails: z.boolean().default(true),
});

export const employeeStatusActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'REACTIVATE', 'EXIT']),
  reason: z.string().trim().max(500).optional(),
});

export const employeeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  status: z.enum(USER_STATUSES).optional(),
  departmentId: idSchema.optional(),
  locationId: idSchema.optional(),
});

export const restrictionOverrideSchema = z.object({
  settings: attendanceRestrictionsPatchSchema.nullable(),
  reason: z.string().trim().max(500).optional(),
});

// ---------- Org ----------
export const businessUnitSchema = z.object({ name, code: z.string().trim().max(20).nullable().optional(), isActive: z.boolean().default(true) });
export const departmentSchema = z.object({ name, businessUnitId: optionalId, isActive: z.boolean().default(true) });
export const designationSchema = z.object({ name, isActive: z.boolean().default(true) });
export const gradeSchema = z.object({ name, rank: z.number().int().min(0).max(100).nullable().optional(), isActive: z.boolean().default(true) });

export const locationSchema = z.object({
  name,
  address: z.string().trim().max(300).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  radiusMeters: z.number().int().min(20).max(10000).default(200),
  timezone: z.string().trim().min(1).max(60).default('Asia/Kolkata'),
  allowedIps: z.array(ipOrCidrSchema).max(50).default([]),
  isActive: z.boolean().default(true),
});

// ---------- Policies ----------
export const shiftSchema = z.object({
  name,
  startTime: timeSchema,
  endTime: timeSchema,
  graceMinutes: z.number().int().min(0).max(240).default(15),
  earlyOutGraceMinutes: z.number().int().min(0).max(240).default(0),
  breakMinutes: z.number().int().min(0).max(240).default(60),
  appliesTo: appliesToSchema,
  priority: z.number().int().min(0).max(1000).default(0),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const attendancePolicySchema = z
  .object({
    name,
    description: z.string().trim().max(300).nullable().optional(),
    fullDayMinutes: z.number().int().min(60).max(1440).default(480),
    halfDayMinutes: z.number().int().min(30).max(1440).default(270),
    absentBelowMinutes: z.number().int().min(0).max(1440).default(120),
    weeklyOffs: z.array(z.number().int().min(1).max(7)).max(7).default([6, 7]),
    regularizationWindowDays: z.number().int().min(1).max(365).default(30),
    maxRegularizationsPerMonth: z.number().int().min(0).max(31).default(5),
    missedPunchCloseHours: z.number().int().min(1).max(12).default(4),
    appliesTo: appliesToSchema,
    priority: z.number().int().min(0).max(1000).default(0),
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.absentBelowMinutes <= v.halfDayMinutes && v.halfDayMinutes <= v.fullDayMinutes, {
    message: 'Thresholds must satisfy: absent ≤ half-day ≤ full-day',
    path: ['halfDayMinutes'],
  });

export const restrictionPolicySchema = z.object({
  name,
  description: z.string().trim().max(300).nullable().optional(),
  settings: attendanceRestrictionsPatchSchema,
  appliesTo: appliesToSchema,
  priority: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

export const workflowLevelSchema = z.object({ approverType: z.enum(APPROVER_TYPES) });
export const workflowSchema = z.object({
  levels: z
    .array(workflowLevelSchema)
    .min(1, 'At least one approval level is required')
    .max(3)
    .refine((ls) => new Set(ls.map((l) => l.approverType)).size === ls.length, 'Each approver type can appear once'),
  escalationDays: z.number().int().min(1).max(30).nullable().optional(),
});

export const permissionProfileSchema = z.object({
  name,
  description: z.string().trim().max(300).nullable().optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])),
  scope: z.enum(PROFILE_SCOPES),
});

// ---------- Queries ----------
export const attendanceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  from: dateSchema,
  to: dateSchema,
  userId: idSchema.optional(),
  departmentId: idSchema.optional(),
  locationId: idSchema.optional(),
  status: z.string().max(10).optional(),
  flagged: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
});

export const auditListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  entityType: z.string().max(50).optional(),
  actorId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
