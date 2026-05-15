import { describe, it, expect, vi } from 'vitest';
import {
  matchArrayCondition,
  matchCertifications,
  isTemporallyValid,
  ruleMatchesEmployee,
  type PolicyRule,
  type EmployeeContext,
} from '../../src/lib/provisioning/policy-engine';

vi.spyOn(console, 'log').mockImplementation(() => {});

const baseRule: PolicyRule = {
  id: 'rule-1',
  tenant_id: 'tenant-1',
  name: 'Default Kit',
  description: null,
  priority: 100,
  match_positions: null,
  match_divisions: null,
  match_locations: null,
  match_certifications: null,
  match_employment_type: null,
  match_custom: null,
  kit_id: 'kit-1',
  items: null,
  trigger_events: ['employee.created'],
  effective_from: null,
  effective_until: null,
  requires_approval: false,
  is_active: true,
};

const baseEmployee: EmployeeContext = {
  employeeId: 'emp-1',
  employeeName: 'John Doe',
  position: 'Electrician',
  division: 'Residential',
  location: 'Phoenix',
  certifications: ['OSHA-30', 'First Aid'],
  employmentType: 'full_time',
};

describe('matchArrayCondition', () => {
  it('returns true when condition is null (wildcard)', () => {
    expect(matchArrayCondition(null, 'anything')).toBe(true);
  });

  it('returns true when condition is empty array (wildcard)', () => {
    expect(matchArrayCondition([], 'anything')).toBe(true);
  });

  it('returns true when value is in condition array', () => {
    expect(matchArrayCondition(['Electrician', 'Plumber'], 'Electrician')).toBe(true);
  });

  it('returns true case-insensitively', () => {
    expect(matchArrayCondition(['electrician'], 'Electrician')).toBe(true);
  });

  it('returns false when value is not in condition array', () => {
    expect(matchArrayCondition(['Plumber'], 'Electrician')).toBe(false);
  });

  it('returns false when value is undefined', () => {
    expect(matchArrayCondition(['Electrician'], undefined)).toBe(false);
  });
});

describe('matchCertifications', () => {
  it('returns true when condition is null (wildcard)', () => {
    expect(matchCertifications(null, ['OSHA-30'])).toBe(true);
  });

  it('returns true when at least one cert overlaps', () => {
    expect(matchCertifications(['OSHA-30', 'CPR'], ['OSHA-30', 'First Aid'])).toBe(true);
  });

  it('returns false when no overlap', () => {
    expect(matchCertifications(['CPR'], ['OSHA-30', 'First Aid'])).toBe(false);
  });

  it('returns false when employee has no certs', () => {
    expect(matchCertifications(['OSHA-30'], undefined)).toBe(false);
    expect(matchCertifications(['OSHA-30'], [])).toBe(false);
  });
});

describe('isTemporallyValid', () => {
  it('returns true when no temporal bounds', () => {
    expect(isTemporallyValid(baseRule, new Date())).toBe(true);
  });

  it('returns true when within bounds', () => {
    const rule = { ...baseRule, effective_from: '2025-01-01', effective_until: '2027-12-31' };
    expect(isTemporallyValid(rule, new Date('2026-06-15'))).toBe(true);
  });

  it('returns false when before effective_from', () => {
    const rule = { ...baseRule, effective_from: '2027-01-01' };
    expect(isTemporallyValid(rule, new Date('2026-06-15'))).toBe(false);
  });

  it('returns false when after effective_until', () => {
    const rule = { ...baseRule, effective_until: '2025-12-31' };
    expect(isTemporallyValid(rule, new Date('2026-06-15'))).toBe(false);
  });
});

describe('ruleMatchesEmployee', () => {
  it('matches when all conditions are null (wildcards)', () => {
    expect(ruleMatchesEmployee(baseRule, baseEmployee)).toBe(true);
  });

  it('matches when specific position matches', () => {
    const rule = { ...baseRule, match_positions: ['Electrician', 'Plumber'] };
    expect(ruleMatchesEmployee(rule, baseEmployee)).toBe(true);
  });

  it('does not match when position does not match', () => {
    const rule = { ...baseRule, match_positions: ['Plumber'] };
    expect(ruleMatchesEmployee(rule, baseEmployee)).toBe(false);
  });

  it('matches when all non-null conditions match', () => {
    const rule = {
      ...baseRule,
      match_positions: ['Electrician'],
      match_divisions: ['Residential'],
      match_locations: ['Phoenix'],
      match_certifications: ['OSHA-30'],
      match_employment_type: 'full_time',
    };
    expect(ruleMatchesEmployee(rule, baseEmployee)).toBe(true);
  });

  it('does not match when employment type differs', () => {
    const rule = { ...baseRule, match_employment_type: 'part_time' };
    expect(ruleMatchesEmployee(rule, baseEmployee)).toBe(false);
  });

  it('does not match when one condition fails', () => {
    const rule = {
      ...baseRule,
      match_positions: ['Electrician'],
      match_divisions: ['Commercial'], // employee is Residential
    };
    expect(ruleMatchesEmployee(rule, baseEmployee)).toBe(false);
  });
});
