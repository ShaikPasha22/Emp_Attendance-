import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@app/shared';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFoundHandler(req: Request, res: Response) {
  const body: ApiErrorBody = {
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, requestId: String(req.id ?? '') },
  };
  res.status(404).json(body);
}

// Express recognises error handlers by their 4-argument signature.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = String(req.id ?? '');
  let status = 500;
  let body: ApiErrorBody = {
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId },
  };

  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details, requestId } };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? (err.meta.target as string[]).join(', ') : 'value';
      status = 409;
      body = { error: { code: 'DUPLICATE', message: `A record with this ${target} already exists`, requestId } };
    } else if (err.code === 'P2025') {
      status = 404;
      body = { error: { code: 'NOT_FOUND', message: 'Record not found', requestId } };
    } else if (err.code === 'P2003') {
      status = 409;
      body = { error: { code: 'IN_USE', message: 'This record is linked to other data and cannot be changed', requestId } };
    }
  } else if (err instanceof SyntaxError && 'body' in err) {
    status = 400;
    body = { error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON', requestId } };
  } else if (typeof err === 'object' && err && 'type' in err && err.type === 'entity.too.large') {
    status = 413;
    body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large', requestId } };
  }

  if (status >= 500) {
    logger.error({ err, requestId }, 'Unhandled error');
    Sentry.captureException(err);
  }
  res.status(status).json(body);
}
