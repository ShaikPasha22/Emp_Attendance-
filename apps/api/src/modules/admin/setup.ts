import { Router } from 'express';
import {
  attendancePolicySchema,
  businessUnitSchema,
  departmentSchema,
  designationSchema,
  gradeSchema,
  locationSchema,
  PERMISSIONS,
  restrictionPolicySchema,
  shiftSchema,
} from '@app/shared';
import { invalidatePolicies } from '../../engine/context';
import { badRequest } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { isValidTimezone } from '../../lib/time';
import { asDelegate, crudRouter } from './crud';

const { SETTINGS_MANAGE, SECURITY_MANAGE, EMPLOYEES_VIEW, ATTENDANCE_VIEW, REPORTS_VIEW } = PERMISSIONS;
const readAny = [SETTINGS_MANAGE, SECURITY_MANAGE, EMPLOYEES_VIEW, ATTENDANCE_VIEW, REPORTS_VIEW];

/** Only one default per policy type: setting a new default clears the old one. */
const singleDefault = (model: 'shift' | 'attendancePolicy') => async <T extends { isDefault: boolean }>(data: T, id: string | null) => {
  if (data.isDefault) {
    const where = { isDefault: true, ...(id ? { NOT: { id } } : {}) };
    if (model === 'shift') await prisma.shift.updateMany({ where, data: { isDefault: false } });
    else await prisma.attendancePolicy.updateMany({ where, data: { isDefault: false } });
  }
  return data;
};

export const setupRouter = Router();

setupRouter.use(
  '/business-units',
  crudRouter({
    delegate: asDelegate(prisma.businessUnit),
    schema: businessUnitSchema,
    entityType: 'BusinessUnit',
    readPermissions: readAny,
    writePermission: SETTINGS_MANAGE,
    include: { _count: { select: { users: true } } },
    usage: (id) => prisma.user.count({ where: { businessUnitId: id } }),
    afterChange: invalidatePolicies,
  }),
);

setupRouter.use(
  '/departments',
  crudRouter({
    delegate: asDelegate(prisma.department),
    schema: departmentSchema,
    entityType: 'Department',
    readPermissions: readAny,
    writePermission: SETTINGS_MANAGE,
    include: { businessUnit: { select: { id: true, name: true } }, _count: { select: { users: true } } },
    usage: (id) => prisma.user.count({ where: { departmentId: id } }),
  }),
);

setupRouter.use(
  '/designations',
  crudRouter({
    delegate: asDelegate(prisma.designation),
    schema: designationSchema,
    entityType: 'Designation',
    readPermissions: readAny,
    writePermission: SETTINGS_MANAGE,
    include: { _count: { select: { users: true } } },
    usage: (id) => prisma.user.count({ where: { designationId: id } }),
  }),
);

setupRouter.use(
  '/grades',
  crudRouter({
    delegate: asDelegate(prisma.grade),
    schema: gradeSchema,
    entityType: 'Grade',
    readPermissions: readAny,
    writePermission: SETTINGS_MANAGE,
    orderBy: [{ rank: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { users: true } } },
    usage: (id) => prisma.user.count({ where: { gradeId: id } }),
  }),
);

setupRouter.use(
  '/locations',
  crudRouter({
    delegate: asDelegate(prisma.location),
    schema: locationSchema,
    entityType: 'Location',
    readPermissions: readAny,
    writePermission: SETTINGS_MANAGE,
    include: { _count: { select: { users: true } } },
    usage: (id) => prisma.user.count({ where: { locationId: id } }),
    beforeSave: (data) => {
      if (!isValidTimezone(data.timezone)) throw badRequest(`Unknown timezone "${data.timezone}"`);
      if ((data.latitude == null) !== (data.longitude == null)) throw badRequest('Set both latitude and longitude, or neither');
      return data;
    },
    afterChange: invalidatePolicies,
  }),
);

setupRouter.use(
  '/shifts',
  crudRouter({
    delegate: asDelegate(prisma.shift),
    schema: shiftSchema,
    entityType: 'Shift',
    readPermissions: readAny,
    writePermission: SETTINGS_MANAGE,
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { users: true } } },
    usage: (id) => prisma.user.count({ where: { shiftId: id } }),
    beforeSave: singleDefault('shift'),
    afterChange: invalidatePolicies,
  }),
);

setupRouter.use(
  '/attendance-policies',
  crudRouter({
    delegate: asDelegate(prisma.attendancePolicy),
    schema: attendancePolicySchema,
    entityType: 'AttendancePolicy',
    readPermissions: readAny,
    writePermission: SETTINGS_MANAGE,
    orderBy: [{ isDefault: 'desc' }, { priority: 'desc' }, { name: 'asc' }],
    beforeSave: singleDefault('attendancePolicy'),
    afterChange: invalidatePolicies,
  }),
);

setupRouter.use(
  '/restriction-policies',
  crudRouter({
    delegate: asDelegate(prisma.restrictionPolicy),
    schema: restrictionPolicySchema,
    entityType: 'RestrictionPolicy',
    readPermissions: [SECURITY_MANAGE, SETTINGS_MANAGE],
    writePermission: SECURITY_MANAGE,
    orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    afterChange: invalidatePolicies,
  }),
);
