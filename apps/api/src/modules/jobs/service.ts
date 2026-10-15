import type { Prisma } from '@prisma/client';
import { getPolicySet, resolveContext } from '../../engine/context';
import { dayCloseTime } from '../../engine/status';
import { notify } from '../../lib/employees';
import { geocodePending } from '../../lib/geocode';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { getCompanySettings } from '../../lib/settings';
import { addDays, dateKeyToDb, dbDateToKey, todayIn } from '../../lib/time';
import { recomputeDay } from '../attendance/service';

type JobResult = Record<string, unknown>;

/** Marks open punches as Missed Punch once the shift has ended + the policy's close window. */
async function closeMissedPunches(): Promise<JobResult> {
  const company = await getCompanySettings();
  const today = todayIn(company.timezone);
  const set = await getPolicySet();
  const open = await prisma.attendanceRecord.findMany({
    where: {
      clockIn: { not: null },
      clockOut: null,
      finalized: false,
      date: { gte: dateKeyToDb(addDays(today, -7)), lte: dateKeyToDb(today) },
    },
    include: { user: { include: { location: true } }, punches: { where: { type: 'OUT' }, orderBy: { at: 'desc' }, take: 1 } },
  });
  let closed = 0;
  for (const r of open) {
    const ctx = resolveContext(r.user, set, company);
    const date = dbDateToKey(r.date);
    const lastOut = r.punches[0];
    if (lastOut && dayCloseTime(date, ctx.shift, ctx.policy, ctx.tz) <= new Date()) {
      // They clocked in again and forgot to clock out: fall back to their last real clock-out.
      await prisma.attendanceRecord.update({ where: { id: r.id }, data: { clockOut: lastOut.at } });
      await recomputeDay(r.userId, date, { ctx, finalize: true });
      continue;
    }
    const updated = await recomputeDay(r.userId, date, { ctx, finalize: true });
    if (updated?.status === 'MP' && r.status !== 'MP') {
      closed++;
      await notify(prisma, [r.userId], 'You missed your clock-out', `You did not clock out on ${date}. Please raise an attendance correction.`, `/requests/new?type=REGULARIZATION&date=${date}`);
    }
  }
  return { checked: open.length, closed };
}

/**
 * Finalises recent days for every active employee: creates Absent / Weekly-off rows and freezes
 * computed statuses. Covers the last `days` days so a missed run is caught up automatically.
 */
async function dailyStatus(days = 3): Promise<JobResult> {
  const company = await getCompanySettings();
  const set = await getPolicySet();
  const today = todayIn(company.timezone);
  const users = await prisma.user.findMany({ where: { status: 'ACTIVE' }, include: { location: true } });
  let written = 0;
  for (const u of users) {
    const ctx = resolveContext(u, set, company);
    const joined = u.joiningDate ? dbDateToKey(u.joiningDate) : dbDateToKey(u.createdAt);
    for (let i = days; i >= 1; i--) {
      const date = addDays(today, -i);
      if (date < joined) continue;
      const r = await recomputeDay(u.id, date, { ctx, createIfMissing: true, finalize: true });
      if (r) written++;
    }
  }
  return { employees: users.length, daysWritten: written, through: addDays(today, -1) };
}

/** Removes expired sessions, old login attempts, used tokens and old notifications. */
async function cleanup(): Promise<JobResult> {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const [sessions, attempts, tokens, notifications, jobRuns] = await prisma.$transaction([
    prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: daysAgo(7) } }, { revokedAt: { lt: daysAgo(7) } }] } }),
    prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: daysAgo(30) } } }),
    prisma.userToken.deleteMany({ where: { OR: [{ usedAt: { lt: daysAgo(7) } }, { expiresAt: { lt: daysAgo(7) } }] } }),
    prisma.notification.deleteMany({ where: { createdAt: { lt: daysAgo(90) }, readAt: { not: null } } }),
    prisma.jobRun.deleteMany({ where: { startedAt: { lt: daysAgo(90) } } }),
  ]);
  return { sessions: sessions.count, loginAttempts: attempts.count, tokens: tokens.count, notifications: notifications.count, jobRuns: jobRuns.count };
}

export const JOBS: Record<string, () => Promise<JobResult>> = {
  'close-missed-punches': closeMissedPunches,
  'daily-status': () => dailyStatus(3),
  'geocode-pending': () => geocodePending(40),
  cleanup,
};

/** Runs a job and records the outcome in JobRun for observability. */
export async function runJob(name: string): Promise<JobResult> {
  const job = JOBS[name];
  if (!job) throw new Error(`Unknown job ${name}`);
  const run = await prisma.jobRun.create({ data: { name, status: 'RUNNING' } });
  const started = Date.now();
  try {
    const detail = await job();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: 'SUCCESS', finishedAt: new Date(), detail: { ...detail, ms: Date.now() - started } as Prisma.InputJsonValue },
    });
    logger.info({ job: name, ...detail }, 'Job finished');
    return detail;
  } catch (err) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finishedAt: new Date(), detail: { error: err instanceof Error ? err.message : String(err) } },
    });
    throw err;
  }
}
