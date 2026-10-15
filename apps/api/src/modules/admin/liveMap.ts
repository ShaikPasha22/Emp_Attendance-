import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import {
  dateSchema,
  PERMISSIONS,
  type AttendanceFlag,
  type AttendanceStatus,
  type LiveMapEmployee,
  type LiveMapResponse,
} from '@app/shared';
import { z } from 'zod';
import { fullName } from '../../lib/employees';
import { forbidden } from '../../lib/errors';
import { mapUrl } from '../../lib/geocode';
import { subscribePunches, type PunchEvent } from '../../lib/live';
import { prisma } from '../../lib/prisma';
import { employeeScopeWhere, inHrScope, reportIds } from '../../lib/scope';
import { getCompanySettings } from '../../lib/settings';
import { dateKeyToDb, todayIn } from '../../lib/time';
import { parse } from '../../lib/validate';
import type { AuthUser } from '../../types/express';

export const liveMapRouter = Router();

interface LiveScope {
  where: Prisma.UserWhereInput;
  matches: (e: PunchEvent) => boolean;
}

/**
 * Who appears on the actor's live map: HR sees everyone in their HR scope, managers see their
 * direct and indirect reports, and someone who is both sees the union.
 */
async function liveScope(actor: AuthUser): Promise<LiveScope> {
  const isHr = actor.permissions.includes(PERMISSIONS.ATTENDANCE_VIEW);
  const team = actor.hasReports
    ? new Set(
        await reportIds(actor.id, (frontier) =>
          prisma.user.findMany({ where: { managerId: { in: frontier }, status: 'ACTIVE' }, select: { id: true } }),
        ),
      )
    : new Set<string>();
  if (!isHr && team.size === 0) throw forbidden('The live map is available to managers and HR.');

  const or: Prisma.UserWhereInput[] = [];
  if (isHr) or.push(employeeScopeWhere(actor));
  if (team.size) or.push({ id: { in: [...team] } });
  return {
    where: { OR: or },
    matches: (e) => team.has(e.userId) || (isHr && inHrScope(actor, e)),
  };
}

liveMapRouter.get('/', async (req, res) => {
  const { date: requested } = parse(z.object({ date: dateSchema.optional() }), req.query);
  const company = await getCompanySettings();
  const today = todayIn(company.timezone);
  const date = requested ?? today;
  const scope = await liveScope(req.user!);

  const users = await prisma.user.findMany({
    where: { AND: [scope.where, { status: 'ACTIVE' }] },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      department: { select: { name: true } },
      designation: { select: { name: true } },
      location: { select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true } },
      attendance: {
        where: { date: dateKeyToDb(date) },
        include: { punches: { where: { latitude: { not: null } }, orderBy: { at: 'desc' }, take: 1 } },
      },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });

  const offices = new Map<string, LiveMapResponse['offices'][number]>();
  const employees: LiveMapEmployee[] = users.map((u) => {
    const loc = u.location;
    if (loc && loc.latitude != null && loc.longitude != null) {
      offices.set(loc.id, { id: loc.id, name: loc.name, latitude: loc.latitude, longitude: loc.longitude, radiusMeters: loc.radiusMeters });
    }
    const r = u.attendance[0];
    const p = r?.punches[0];
    return {
      id: u.id,
      name: fullName(u),
      employeeCode: u.employeeCode,
      department: u.department?.name ?? null,
      designation: u.designation?.name ?? null,
      office: loc?.name ?? null,
      liveStatus: r?.clockIn ? (r.clockOut ? 'CLOCKED_OUT' : 'WORKING') : 'NOT_IN',
      attendanceStatus: (r?.status as AttendanceStatus | null) ?? null,
      firstIn: r?.clockIn?.toISOString() ?? null,
      lastOut: r?.clockOut?.toISOString() ?? null,
      workMinutes: r?.workMinutes ?? null,
      lastPunch: p
        ? {
            type: p.type,
            at: p.at.toISOString(),
            latitude: p.latitude!,
            longitude: p.longitude!,
            accuracy: p.accuracy,
            address: p.address,
            state: p.state || null,
            country: p.country || null,
            distanceMeters: p.distanceMeters,
            mapUrl: mapUrl(p.latitude!, p.longitude!),
            outsideOffice: !!loc && p.distanceMeters != null && p.distanceMeters > loc.radiusMeters,
            flags: p.flags as AttendanceFlag[],
          }
        : null,
    };
  });

  const body: LiveMapResponse = {
    date,
    timezone: company.timezone,
    generatedAt: new Date().toISOString(),
    isToday: date === today,
    offices: [...offices.values()],
    employees,
    summary: {
      total: employees.length,
      working: employees.filter((e) => e.liveStatus === 'WORKING').length,
      clockedOut: employees.filter((e) => e.liveStatus === 'CLOCKED_OUT').length,
      notIn: employees.filter((e) => e.liveStatus === 'NOT_IN').length,
      outsideOffice: employees.filter((e) => e.lastPunch?.outsideOffice).length,
    },
  };
  res.json(body);
});

/** Matches the access-token lifetime: the client reconnects with a fresh token, which also re-checks access. */
const STREAM_MAX_MS = 14 * 60_000;

/**
 * Server-Sent Events stream: pushes `punch` events for employees in the actor's scope the moment
 * they clock in / out (and again when their address resolves). Clients refetch the map on each event.
 */
liveMapRouter.get('/stream', async (req: Request, res) => {
  let scope = await liveScope(req.user!);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    // no-transform stops the compression middleware from buffering the stream.
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  res.write(`event: ready\ndata: {}\n\n`);

  const unsubscribe = subscribePunches((e) => {
    if (scope.matches(e)) res.write(`event: punch\ndata: ${JSON.stringify({ kind: e.kind, userId: e.userId, at: e.at })}\n\n`);
  });
  // Comment pings keep proxies (Render, Cloudflare) from closing an idle connection.
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  // Team membership can change; refresh the scope every few minutes.
  const rescope = setInterval(() => {
    liveScope(req.user!).then((s) => (scope = s)).catch(() => res.end());
  }, 5 * 60_000);
  const expire = setTimeout(() => res.end(), STREAM_MAX_MS);

  req.on('close', () => {
    unsubscribe();
    clearInterval(ping);
    clearInterval(rescope);
    clearTimeout(expire);
  });
});
