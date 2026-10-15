import { describe, expect, it } from 'vitest';
import { pickPolicy, rankPolicies, type EmployeeAttributes } from './applicability';

const emp: EmployeeAttributes = {
  businessUnitId: 'bu1',
  departmentId: 'sales',
  locationId: 'blr',
  gradeId: 'g3',
  employeeType: 'PERMANENT',
};
const policy = (name: string, appliesTo: object, extra: object = {}) => ({ name, appliesTo, priority: 0, isActive: true, isDefault: false, ...extra });

describe('policy applicability', () => {
  it('picks the most specific matching policy', () => {
    const policies = [
      policy('company', {}, { isDefault: true }),
      policy('bangalore', { locationIds: ['blr'] }),
      policy('bangalore-sales', { locationIds: ['blr'], departmentIds: ['sales'] }),
      policy('mumbai', { locationIds: ['bom'] }),
    ];
    expect(pickPolicy(policies, emp)?.name).toBe('bangalore-sales');
    expect(rankPolicies(policies, emp).map((p) => p.name)).toEqual(['bangalore-sales', 'bangalore', 'company']);
  });

  it('breaks ties by priority', () => {
    const policies = [policy('a', { locationIds: ['blr'] }, { priority: 1 }), policy('b', { departmentIds: ['sales'] }, { priority: 5 })];
    expect(pickPolicy(policies, emp)?.name).toBe('b');
  });

  it('ignores inactive policies and falls back to the default', () => {
    const policies = [policy('specific', { locationIds: ['blr'] }, { isActive: false }), policy('default', { locationIds: ['bom'] }, { isDefault: true })];
    expect(pickPolicy(policies, emp)?.name).toBe('default');
  });

  it('matches employee types and requires every criterion', () => {
    const policies = [policy('interns', { employeeTypes: ['INTERN'] }), policy('perm-blr', { employeeTypes: ['PERMANENT'], locationIds: ['blr'] })];
    expect(pickPolicy(policies, emp)?.name).toBe('perm-blr');
    expect(pickPolicy(policies, { ...emp, employeeType: 'INTERN', locationId: 'bom' })?.name).toBe('interns');
  });
});
