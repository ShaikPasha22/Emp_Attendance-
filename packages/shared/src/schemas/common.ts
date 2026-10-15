import { z } from 'zod';
import { EMPLOYEE_TYPES } from '../constants';

export const idSchema = z.string().min(1).max(64);

/** Calendar date in YYYY-MM-DD. */
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Wall-clock time in HH:mm (24h). */
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'));

export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'Enter a domain like company.com');

const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/([0-9]|[12]\d|3[0-2]))?$/;
const ipv6 = /^[0-9a-f:]+(\/(\d|[1-9]\d|1[01]\d|12[0-8]))?$/i;
/** IPv4/IPv6 address, optionally with a CIDR suffix. */
export const ipOrCidrSchema = z
  .string()
  .trim()
  .refine((v) => ipv4.test(v) || (v.includes(':') && ipv6.test(v)), 'Enter an IP like 203.0.113.10 or 203.0.113.0/24');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const employeeTypeSchema = z.enum(EMPLOYEE_TYPES);

/**
 * Darwinbox-style applicability rules. Every non-empty list must match;
 * empty lists mean "any". More filled criteria = more specific policy.
 */
export const appliesToSchema = z.object({
  businessUnitIds: z.array(idSchema).default([]),
  departmentIds: z.array(idSchema).default([]),
  locationIds: z.array(idSchema).default([]),
  gradeIds: z.array(idSchema).default([]),
  employeeTypes: z.array(employeeTypeSchema).default([]),
});
export type AppliesTo = z.infer<typeof appliesToSchema>;
