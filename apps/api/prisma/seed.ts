/**
 * Seeds required defaults (idempotent) and, optionally, demo data.
 *   npm run db:seed
 * Required: company settings, permission profiles, default shift & policy, workflows, first admin.
 * Demo (SEED_DEMO_DATA=true): org units, HR/manager/employee accounts and two weeks of attendance.
 */
import { PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  DEFAULT_ATTENDANCE_RESTRICTIONS,
  DEFAULT_SECURITY_SETTINGS,
  EMPTY_APPLIES_TO,
  PERMISSIONS as P,
} from '@app/shared';
import { DateTime } from 'luxon';
import { hashPassword } from '../src/lib/crypto';

const prisma = new PrismaClient();
const TZ = 'Asia/Kolkata';

async function main() {
  const companyName = process.env.SEED_COMPANY_NAME || 'Acme Corp';
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
  const demo = process.env.SEED_DEMO_DATA === 'true';

  await prisma.company.upsert({
    where: { id: 'company' },
    create: { id: 'company', name: companyName, timezone: TZ, security: DEFAULT_SECURITY_SETTINGS, attendanceRestrictions: DEFAULT_ATTENDANCE_RESTRICTIONS },
    update: {},
  });

  const profiles = [
    { name: 'Employee', description: 'Marks own attendance and raises requests', permissions: [], scope: 'SELF' as const },
    {
      name: 'HR Business Partner',
      description: 'HR for assigned business units / locations',
      permissions: [P.EMPLOYEES_VIEW, P.ATTENDANCE_VIEW, P.ATTENDANCE_OVERRIDE, P.REQUESTS_APPROVE_HR, P.REPORTS_VIEW],
      scope: 'ASSIGNED' as const,
    },
    {
      name: 'HR Admin',
      description: 'Full HR access across the company',
      permissions: ALL_PERMISSIONS.filter((p) => p !== P.PROFILES_MANAGE),
      scope: 'COMPANY' as const,
    },
    { name: 'Super Admin', description: 'Everything, including permission profiles', permissions: ALL_PERMISSIONS, scope: 'COMPANY' as const },
  ];
  for (const p of profiles) {
    await prisma.permissionProfile.upsert({
      where: { name: p.name },
      create: { ...p, isSystem: true },
      update: { permissions: p.permissions, scope: p.scope, description: p.description, isSystem: true },
    });
  }
  const profileId = async (name: string) => (await prisma.permissionProfile.findUniqueOrThrow({ where: { name } })).id;

  await prisma.shift.upsert({
    where: { name: 'General Shift' },
    create: { name: 'General Shift', startTime: '09:30', endTime: '18:30', graceMinutes: 15, breakMinutes: 60, appliesTo: EMPTY_APPLIES_TO, isDefault: true },
    update: {},
  });
  await prisma.attendancePolicy.upsert({
    where: { name: 'Standard Attendance Policy' },
    create: { name: 'Standard Attendance Policy', description: 'Company-wide default', appliesTo: EMPTY_APPLIES_TO, isDefault: true },
    update: {},
  });
  for (const requestType of ['REGULARIZATION', 'WFH', 'ON_DUTY'] as const) {
    await prisma.workflowDefinition.upsert({
      where: { requestType },
      create: { requestType, levels: [{ approverType: 'REPORTING_MANAGER' }, { approverType: 'HR' }] },
      update: {},
    });
  }

  const adminHash = await hashPassword(adminPassword);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      employeeCode: 'EMP0001',
      firstName: 'System',
      lastName: 'Admin',
      email: adminEmail,
      passwordHash: adminHash,
      status: 'ACTIVE',
      profileId: await profileId('Super Admin'),
    },
    update: {},
  });
  console.log(`✔ Defaults ready. Super Admin: ${adminEmail}`);

  if (!demo) return backfillPunches();

  // ---------------- Demo data ----------------
  const bu = await prisma.businessUnit.upsert({ where: { name: 'Corporate' }, create: { name: 'Corporate', code: 'CORP' }, update: {} });
  const dept = async (name: string) =>
    prisma.department.upsert({ where: { name }, create: { name, businessUnitId: bu.id }, update: {} });
  const [engineering, hr, sales] = await Promise.all([dept('Engineering'), dept('Human Resources'), dept('Sales')]);
  const desig = async (name: string) => prisma.designation.upsert({ where: { name }, create: { name }, update: {} });
  const [swe, lead, hrExec, salesExec] = await Promise.all([
    desig('Software Engineer'),
    desig('Engineering Manager'),
    desig('HR Executive'),
    desig('Sales Executive'),
  ]);
  const grade = await prisma.grade.upsert({ where: { name: 'G3' }, create: { name: 'G3', rank: 3 }, update: {} });
  const office = await prisma.location.upsert({
    where: { name: 'Bengaluru HQ' },
    create: { name: 'Bengaluru HQ', address: 'MG Road, Bengaluru', latitude: 12.9755, longitude: 77.6066, radiusMeters: 250, timezone: TZ },
    update: {},
  });
  await prisma.user.update({ where: { id: admin.id }, data: { locationId: office.id, departmentId: hr.id, businessUnitId: bu.id } });

  const demoHash = await hashPassword('Demo@12345');
  const person = async (code: string, first: string, last: string, email: string, extra: Record<string, unknown>) =>
    prisma.user.upsert({
      where: { email },
      create: {
        employeeCode: code,
        firstName: first,
        lastName: last,
        email,
        passwordHash: demoHash,
        status: 'ACTIVE',
        businessUnitId: bu.id,
        locationId: office.id,
        gradeId: grade.id,
        joiningDate: new Date('2025-01-06T00:00:00Z'),
        profileId: await profileId('Employee'),
        ...extra,
      },
      update: {},
    });

  const hrUser = await person('EMP0002', 'Priya', 'Sharma', 'hr@example.com', { departmentId: hr.id, designationId: hrExec.id, profileId: await profileId('HR Admin') });
  const manager = await person('EMP0003', 'Rahul', 'Verma', 'manager@example.com', { departmentId: engineering.id, designationId: lead.id, managerId: hrUser.id });
  const employees = await Promise.all([
    person('EMP0004', 'Ananya', 'Iyer', 'employee@example.com', { departmentId: engineering.id, designationId: swe.id, managerId: manager.id }),
    person('EMP0005', 'Karthik', 'Reddy', 'karthik@example.com', { departmentId: engineering.id, designationId: swe.id, managerId: manager.id }),
    person('EMP0006', 'Sneha', 'Patel', 'sneha@example.com', { departmentId: sales.id, designationId: salesExec.id, managerId: manager.id, employeeType: 'CONTRACT' }),
  ]);
  // A second office in another state, so the live map's country / state views have something to show.
  const mumbai = await prisma.location.upsert({
    where: { name: 'Mumbai Office' },
    create: { name: 'Mumbai Office', address: 'Bandra Kurla Complex, Mumbai', latitude: 19.0662, longitude: 72.8679, radiusMeters: 250, timezone: TZ },
    update: {},
  });
  const mumbaiTeam = await Promise.all([
    person('EMP0008', 'Arjun', 'Mehta', 'arjun@example.com', { departmentId: sales.id, designationId: salesExec.id, managerId: manager.id, locationId: mumbai.id }),
    person('EMP0009', 'Kavya', 'Nair', 'kavya@example.com', { departmentId: sales.id, designationId: salesExec.id, managerId: manager.id, locationId: mumbai.id }),
  ]);

  await prisma.user.upsert({
    where: { email: 'newjoiner@example.com' },
    create: {
      employeeCode: 'EMP0007',
      firstName: 'Vikram',
      lastName: 'Singh',
      email: 'newjoiner@example.com',
      passwordHash: demoHash,
      status: 'PENDING',
      profileId: await profileId('Employee'),
    },
    update: {},
  });

  // Two weeks of realistic punches for the demo team (weekdays only, before today).
  const { recomputeDay } = await import('../src/modules/attendance/service');
  const today = DateTime.now().setZone(TZ).startOf('day');
  const team = [manager, ...employees, ...mumbaiTeam];
  let seeded = 0;
  for (let i = 14; i >= 1; i--) {
    const day = today.minus({ days: i });
    if (day.weekday >= 6) continue;
    const date = day.toISODate()!;
    for (const [idx, u] of team.entries()) {
      const exists = await prisma.attendanceRecord.findUnique({ where: { userId_date: { userId: u.id, date: new Date(`${date}T00:00:00Z`) } } });
      if (exists) continue;
      const seed = (i * 7 + idx * 13) % 100;
      const base = u.locationId === mumbai.id ? { lat: 19.0662, lng: 72.8679 } : { lat: 12.9755, lng: 77.6066 };
      if (seed < 6) continue; // occasional absence
      const inMin = 9 * 60 + 15 + (seed % 45); // 09:15 – 09:59
      const outMin = 18 * 60 + 20 + ((seed * 3) % 60);
      const at = (m: number) => day.set({ hour: Math.floor(m / 60), minute: m % 60 }).toJSDate();
      const forgotOut = seed > 95;
      const rec = await prisma.attendanceRecord.create({
        data: {
          userId: u.id,
          date: new Date(`${date}T00:00:00Z`),
          clockIn: at(inMin),
          clockOut: forgotOut ? null : at(outMin),
          inLat: base.lat + (seed - 50) / 100000,
          inLng: base.lng + (seed - 50) / 100000,
          inAccuracy: 20,
          inDistanceMeters: Math.abs(seed - 50) * 1.5,
          source: 'APP',
          shiftSnapshot: { name: 'General Shift', startTime: '09:30', endTime: '18:30', graceMinutes: 15, earlyOutGraceMinutes: 0 },
        },
      });
      const jitter = (n: number) => (n - 50) / 100000;
      await prisma.attendancePunch.createMany({
        data: [
          { recordId: rec.id, userId: u.id, type: 'IN' as const, at: at(inMin), latitude: base.lat + jitter(seed), longitude: base.lng + jitter(seed), accuracy: 18, distanceMeters: Math.abs(seed - 50) * 1.5 },
          ...(forgotOut
            ? []
            : [{ recordId: rec.id, userId: u.id, type: 'OUT' as const, at: at(outMin), latitude: base.lat + jitter(100 - seed), longitude: base.lng + jitter(seed), accuracy: 22, distanceMeters: Math.abs(50 - seed) * 1.2 }]),
        ],
      });
      await recomputeDay(u.id, date, { finalize: true });
      seeded++;
    }
  }
  console.log(`✔ Demo data ready (${seeded} attendance days). Demo password for all demo users: Demo@12345`);
  console.log('   hr@example.com (HR Admin) · manager@example.com (Manager) · employee@example.com (Employee)');
  await backfillPunches();
}

/** Idempotent: creates punch-log entries for records saved before the punch log existed. */
async function backfillPunches() {
  const records = await prisma.attendanceRecord.findMany({ where: { clockIn: { not: null }, punches: { none: {} } } });
  for (const r of records) {
    await prisma.attendancePunch.createMany({
      data: [
        { recordId: r.id, userId: r.userId, type: 'IN' as const, at: r.clockIn!, latitude: r.inLat, longitude: r.inLng, accuracy: r.inAccuracy, distanceMeters: r.inDistanceMeters, ip: r.inIp },
        ...(r.clockOut
          ? [{ recordId: r.id, userId: r.userId, type: 'OUT' as const, at: r.clockOut, latitude: r.outLat, longitude: r.outLng, accuracy: r.outAccuracy, distanceMeters: r.outDistanceMeters, ip: r.outIp }]
          : []),
      ],
    });
  }
  if (records.length) console.log(`✔ Backfilled punch log for ${records.length} record(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
