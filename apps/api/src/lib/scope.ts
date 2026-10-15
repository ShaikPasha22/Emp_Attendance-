import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../types/express';

/**
 * Prisma filter limiting which employees an HR user can see/act on:
 * COMPANY = everyone, ASSIGNED (HRBP) = their business units / locations, SELF = nobody else.
 */
export function employeeScopeWhere(actor: AuthUser): Prisma.UserWhereInput {
  if (actor.scope === 'COMPANY') return {};
  if (actor.scope === 'ASSIGNED') {
    const or: Prisma.UserWhereInput[] = [];
    if (actor.hrScopeBusinessUnitIds.length) or.push({ businessUnitId: { in: actor.hrScopeBusinessUnitIds } });
    if (actor.hrScopeLocationIds.length) or.push({ locationId: { in: actor.hrScopeLocationIds } });
    return or.length ? { OR: or } : { id: '__none__' };
  }
  return { id: '__none__' };
}

export function inHrScope(actor: AuthUser, user: { businessUnitId: string | null; locationId: string | null }) {
  if (actor.scope === 'COMPANY') return true;
  if (actor.scope === 'ASSIGNED') {
    return (
      (!!user.businessUnitId && actor.hrScopeBusinessUnitIds.includes(user.businessUnitId)) ||
      (!!user.locationId && actor.hrScopeLocationIds.includes(user.locationId))
    );
  }
  return false;
}

/** All direct and indirect reports of a manager (walks the reporting tree breadth-first). */
export async function reportIds(
  managerId: string,
  findReports: (ids: string[]) => Promise<{ id: string }[]>,
): Promise<string[]> {
  const seen = new Set<string>();
  let frontier = [managerId];
  for (let depth = 0; depth < 10 && frontier.length; depth++) {
    const rows = await findReports(frontier);
    frontier = rows.map((r) => r.id).filter((id) => !seen.has(id) && id !== managerId);
    frontier.forEach((id) => seen.add(id));
  }
  return [...seen];
}
