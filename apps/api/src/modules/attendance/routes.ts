import { Router } from 'express';
import { dateSchema, monthSchema, punchSchema } from '@app/shared';
import { z } from 'zod';
import { param, parse } from '../../lib/validate';
import { punchLimiter } from '../../middleware/security';
import * as attendance from './service';

export const attendanceRouter = Router();

attendanceRouter.get('/today', async (req, res) => {
  res.json(await attendance.getToday(req.user!.id));
});

attendanceRouter.post('/clock-in', punchLimiter, async (req, res) => {
  const { location } = parse(punchSchema, req.body ?? {});
  res.status(201).json(await attendance.clockIn(req, location));
});

attendanceRouter.post('/clock-out', punchLimiter, async (req, res) => {
  const { location } = parse(punchSchema, req.body ?? {});
  res.json(await attendance.clockOut(req, location));
});

attendanceRouter.get('/me', async (req, res) => {
  const { month } = parse(z.object({ month: monthSchema }), req.query);
  res.json(await attendance.getMonth(req.user!.id, month));
});

attendanceRouter.get('/me/day/:date', async (req, res) => {
  res.json(await attendance.getDayDetail(req.user!.id, parse(dateSchema, param(req, 'date'))));
});
