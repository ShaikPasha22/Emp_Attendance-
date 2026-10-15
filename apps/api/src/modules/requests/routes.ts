import { Router } from 'express';
import { bulkDecisionSchema, createRequestSchema, decideRequestSchema, rejectRequestSchema, REQUEST_STATUSES } from '@app/shared';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { param, parse } from '../../lib/validate';
import * as requests from './service';

export const requestsRouter = Router();

requestsRouter.get('/me', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(REQUEST_STATUSES).optional() }), req.query);
  res.json(await requests.listMine(req.user!.id, status));
});

requestsRouter.post('/', async (req, res) => {
  const input = parse(createRequestSchema, req.body);
  res.status(201).json(await requests.createRequest(req, input));
});

requestsRouter.get('/inbox', async (req, res) => {
  res.json(await requests.inbox(req.user!));
});

requestsRouter.get('/history', async (req, res) => {
  res.json(await requests.history(req.user!));
});

requestsRouter.post('/bulk', async (req, res) => {
  const { ids, decision, comment } = parse(bulkDecisionSchema, req.body);
  if (decision === 'REJECT' && (!comment || comment.length < 3)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'A comment is required when rejecting');
  }
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      if (decision === 'APPROVE') await requests.approve(req, id, comment);
      else await requests.reject(req, id, comment!);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  }
  res.json({ results });
});

requestsRouter.get('/:id', async (req, res) => {
  res.json(await requests.getOne(req.user!, param(req, 'id')));
});

requestsRouter.post('/:id/approve', async (req, res) => {
  const { comment } = parse(decideRequestSchema, req.body ?? {});
  res.json(await requests.approve(req, param(req, 'id'), comment));
});

requestsRouter.post('/:id/reject', async (req, res) => {
  const { comment } = parse(rejectRequestSchema, req.body);
  res.json(await requests.reject(req, param(req, 'id'), comment));
});

requestsRouter.post('/:id/cancel', async (req, res) => {
  res.json(await requests.cancel(req, param(req, 'id')));
});
