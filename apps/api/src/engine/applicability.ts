import { appliesToSchema, type AppliesTo, type EmployeeType } from '@app/shared';

export interface EmployeeAttributes {
  businessUnitId: string | null;
  departmentId: string | null;
  locationId: string | null;
  gradeId: string | null;
  employeeType: EmployeeType;
}

export interface ApplicablePolicy {
  appliesTo: unknown;
  priority: number;
  isActive: boolean;
  isDefault?: boolean;
}

export function readAppliesTo(raw: unknown): AppliesTo {
  const parsed = appliesToSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : appliesToSchema.parse({});
}

/** Number of filled criteria — a higher number means a more specific policy. */
export function specificity(rules: AppliesTo): number {
  return (
    Number(rules.businessUnitIds.length > 0) +
    Number(rules.departmentIds.length > 0) +
    Number(rules.locationIds.length > 0) +
    Number(rules.gradeIds.length > 0) +
    Number(rules.employeeTypes.length > 0)
  );
}

const inList = (list: string[], value: string | null) => list.length === 0 || (value !== null && list.includes(value));

/** Every non-empty criterion must match the employee. Empty criteria mean "any". */
export function matches(rules: AppliesTo, emp: EmployeeAttributes): boolean {
  return (
    inList(rules.businessUnitIds, emp.businessUnitId) &&
    inList(rules.departmentIds, emp.departmentId) &&
    inList(rules.locationIds, emp.locationId) &&
    inList(rules.gradeIds, emp.gradeId) &&
    inList(rules.employeeTypes, emp.employeeType)
  );
}

/** Matching active policies ordered from MOST to LEAST specific (ties: higher priority, then default first). */
export function rankPolicies<T extends ApplicablePolicy>(policies: T[], emp: EmployeeAttributes): T[] {
  return policies
    .filter((p) => p.isActive)
    .map((p) => ({ p, rules: readAppliesTo(p.appliesTo) }))
    .filter(({ rules }) => matches(rules, emp))
    .sort(
      (a, b) =>
        specificity(b.rules) - specificity(a.rules) ||
        b.p.priority - a.p.priority ||
        Number(b.p.isDefault ?? false) - Number(a.p.isDefault ?? false),
    )
    .map(({ p }) => p);
}

/** The single policy that applies to an employee: most specific match, else the default policy. */
export function pickPolicy<T extends ApplicablePolicy>(policies: T[], emp: EmployeeAttributes): T | null {
  return rankPolicies(policies, emp)[0] ?? policies.find((p) => p.isActive && p.isDefault) ?? null;
}
