import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { getClientIp } from './ip';
import { logger } from './logger';
import { prisma, type Tx } from './prisma';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

const toJson = (v: unknown) =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/** Write an audit log entry. Pass `tx` to make it part of the same transaction as the change. */
export async function audit(req: Request | null, entry: AuditEntry, tx: Tx = prisma) {
  try {
    await tx.auditLog.create({
      data: {
        actorId: req?.user?.id ?? null,
        actorName: req?.user ? `${req.user.firstName} ${req.user.lastName}` : 'System',
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        before: toJson(entry.before),
        after: toJson(entry.after),
        ip: req ? getClientIp(req) : null,
        requestId: req ? String(req.id ?? '') : null,
      },
    });
  } catch (err) {
    if (tx !== prisma) throw err;
    logger.error({ err, entry }, 'Failed to write audit log');
  }
}
