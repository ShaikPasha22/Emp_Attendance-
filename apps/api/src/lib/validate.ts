import type { z } from 'zod';
import { AppError } from './errors';

/** Parse input with a Zod schema, converting failures into a 422 with field-level details. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = details[0];
    throw new AppError(
      422,
      'VALIDATION_ERROR',
      first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid input',
      details,
    );
  }
  return result.data;
}

/** A route parameter as a plain string (Express 5 types params as string | string[]). */
export function param(req: { params: Record<string, unknown> }, name = 'id'): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new AppError(400, 'BAD_PARAM', `Invalid ${name}`);
  }
  return value;
}
