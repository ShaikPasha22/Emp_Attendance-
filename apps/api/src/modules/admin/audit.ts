import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { auditListQuerySchema, PERMISSIONS } from '@app/shared';
import { prisma } from '../../lib/prisma';
import { parse } from '../../lib/validate';
import { requirePermission } from '../../middleware/auth';

export const auditRouter = Router();

auditRouter.get('/', requirePermission(PERMISSIONS.AUDIT_VIEW), async (req, res) => {
  const q = parse(auditListQuerySchema, req.query);
  const where: Prisma.AuditLogWhereInput = {
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.q
      ? {
          OR: [
            { summary: { contains: q.q, mode: 'insensitive' } },
            { action: { contains: q.q, mode: 'insensitive' } },
            { actorName: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});
