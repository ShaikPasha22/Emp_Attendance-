import { Router } from 'express';
import { loadContext } from '../../engine/context';
import { fullName, toSessionUser } from '../../lib/employees';
import { prisma } from '../../lib/prisma';

export const meRouter = Router();

meRouter.get('/', async (req, res) => {
  res.json(await toSessionUser(req.user!));
});

meRouter.get('/profile', async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    include: {
      department: true,
      designation: true,
      businessUnit: true,
      location: true,
      grade: true,
      manager: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  const ctx = await loadContext(u.id);
  res.json({
    employeeCode: u.employeeCode,
    name: fullName(u),
    email: u.email,
    phone: u.phone,
    employeeType: u.employeeType,
    joiningDate: u.joiningDate?.toISOString().slice(0, 10) ?? null,
    department: u.department?.name ?? null,
    designation: u.designation?.name ?? null,
    businessUnit: u.businessUnit?.name ?? null,
    grade: u.grade?.name ?? null,
    location: u.location?.name ?? null,
    manager: u.manager ? { name: fullName(u.manager), email: u.manager.email } : null,
    shift: ctx.shiftInfo,
    weeklyOffs: ctx.policy.weeklyOffs,
    timezone: ctx.tz,
  });
});

meRouter.get('/notifications', async (req, res) => {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  res.json({ items, unread });
});

meRouter.post('/notifications/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.status(204).end();
});
