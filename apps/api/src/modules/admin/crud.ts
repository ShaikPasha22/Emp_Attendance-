import { Router, type Request } from 'express';
import type { Permission } from '@app/shared';
import type { z } from 'zod';
import { audit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { param, parse } from '../../lib/validate';
import { requirePermission } from '../../middleware/auth';

/** Minimal shape shared by Prisma model delegates that this factory needs. */
interface Delegate {
  findMany(args?: object): Promise<unknown[]>;
  findUnique(args: { where: { id: string } }): Promise<unknown | null>;
  create(args: { data: object }): Promise<{ id: string }>;
  update(args: { where: { id: string }; data: object }): Promise<{ id: string }>;
  delete(args: { where: { id: string } }): Promise<unknown>;
}

/** Prisma delegates have generic signatures; this narrows them to what the factory uses. */
export const asDelegate = (d: unknown) => d as Delegate;

interface CrudOptions<S extends z.ZodType> {
  delegate: Delegate;
  schema: S;
  entityType: string;
  readPermissions: Permission[];
  writePermission: Permission;
  orderBy?: object;
  include?: object;
  /** Number of records that reference this item; deletion is blocked when > 0. */
  usage?: (id: string) => Promise<number>;
  /** Normalise / validate data before saving (e.g. only one default policy). */
  beforeSave?: (data: z.output<S>, id: string | null) => Promise<object> | object;
  afterChange?: () => void;
}

const nameOf = (row: unknown) => (row as { name?: string })?.name ?? '';

/** Standard list / create / update / delete routes with permissions and audit logging. */
export function crudRouter<S extends z.ZodType>(opts: CrudOptions<S>) {
  const router = Router();
  const read = requirePermission(...opts.readPermissions);
  const write = requirePermission(opts.writePermission);
  const save = async (data: z.output<S>, id: string | null) =>
    (opts.beforeSave ? await opts.beforeSave(data, id) : data) as object;

  router.get('/', read, async (_req, res) => {
    res.json(await opts.delegate.findMany({ orderBy: opts.orderBy ?? { name: 'asc' }, include: opts.include }));
  });

  router.post('/', write, async (req: Request, res) => {
    const data = parse(opts.schema, req.body);
    const created = await opts.delegate.create({ data: await save(data, null) });
    opts.afterChange?.();
    await audit(req, { action: `${opts.entityType}.created`, entityType: opts.entityType, entityId: created.id, summary: `Created ${nameOf(created)}`, after: created });
    res.status(201).json(created);
  });

  router.put('/:id', write, async (req: Request, res) => {
    const before = await opts.delegate.findUnique({ where: { id: param(req, 'id') } });
    if (!before) throw notFound(opts.entityType);
    const data = parse(opts.schema, req.body);
    const updated = await opts.delegate.update({ where: { id: param(req, 'id') }, data: await save(data, param(req, 'id')) });
    opts.afterChange?.();
    await audit(req, { action: `${opts.entityType}.updated`, entityType: opts.entityType, entityId: updated.id, summary: `Updated ${nameOf(updated)}`, before, after: updated });
    res.json(updated);
  });

  router.delete('/:id', write, async (req: Request, res) => {
    const before = await opts.delegate.findUnique({ where: { id: param(req, 'id') } });
    if (!before) throw notFound(opts.entityType);
    const used = opts.usage ? await opts.usage(param(req, 'id')) : 0;
    if (used > 0) {
      throw new AppError(409, 'IN_USE', `This is used by ${used} employee${used > 1 ? 's' : ''}. Reassign them or mark it inactive instead.`);
    }
    await opts.delegate.delete({ where: { id: param(req, 'id') } });
    opts.afterChange?.();
    await audit(req, { action: `${opts.entityType}.deleted`, entityType: opts.entityType, entityId: param(req, 'id'), summary: `Deleted ${nameOf(before)}`, before });
    res.status(204).end();
  });

  return router;
}
