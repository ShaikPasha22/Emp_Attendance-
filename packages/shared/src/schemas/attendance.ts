import { z } from 'zod';
import { ATTENDANCE_STATUSES, REQUEST_TYPES } from '../constants';
import { dateSchema, timeSchema } from './common';

export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000),
  /** How old the GPS reading is, in ms, measured on the device (stale readings are rejected). */
  ageMs: z.number().min(0).max(86_400_000).optional(),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

export const punchSchema = z.object({
  location: geoPointSchema.optional(),
});

export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

export const regularizationPayloadSchema = z.object({
  clockIn: timeSchema,
  clockOut: timeSchema,
});

export const createRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('REGULARIZATION'),
    date: dateSchema,
    clockIn: timeSchema,
    clockOut: timeSchema,
    reason: z.string().trim().min(5, 'Please add a short reason').max(500),
  }),
  z.object({
    type: z.literal('WFH'),
    startDate: dateSchema,
    endDate: dateSchema,
    reason: z.string().trim().min(5, 'Please add a short reason').max(500),
  }),
  z.object({
    type: z.literal('ON_DUTY'),
    startDate: dateSchema,
    endDate: dateSchema,
    reason: z.string().trim().min(5, 'Please add a short reason').max(500),
  }),
]);
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const decideRequestSchema = z.object({
  comment: z.string().trim().max(500).optional(),
});
export const rejectRequestSchema = z.object({
  comment: z.string().trim().min(3, 'A comment is required when rejecting').max(500),
});
export const bulkDecisionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(500).optional(),
});

export const requestTypeSchema = z.enum(REQUEST_TYPES);

export const attendanceOverrideSchema = z.object({
  clockIn: timeSchema.nullable().optional(),
  clockOut: timeSchema.nullable().optional(),
  statusOverride: attendanceStatusSchema.nullable().optional(),
  reason: z.string().trim().min(5, 'A reason is required for overrides').max(500),
});

export const reviewDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(500).optional(),
});
