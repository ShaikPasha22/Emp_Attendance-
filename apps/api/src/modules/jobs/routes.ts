import { Router } from 'express';
import { env } from '../../config/env';
import { safeEqual } from '../../lib/crypto';
import { notFound, unauthorized } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { param } from '../../lib/validate';
import { JOBS, runJob } from './service';

/** Scheduled jobs, triggered by GitHub Actions cron with the JOB_SECRET header. */
export const jobsRouter = Router();

jobsRouter.use((req, _res, next) => {
  const secret = req.header('x-job-secret') ?? '';
  if (!safeEqual(secret, env.JOB_SECRET)) throw unauthorized('Invalid job secret', 'INVALID_JOB_SECRET');
  next();
});

jobsRouter.post('/:name', async (req, res) => {
  if (!JOBS[param(req, 'name')]) throw notFound('Job');
  res.json({ job: param(req, 'name'), result: await runJob(param(req, 'name')) });
});

jobsRouter.get('/runs', async (_req, res) => {
  res.json(await prisma.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 50 }));
});
