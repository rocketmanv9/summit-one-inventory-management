/**
 * Provisioning Policy Engine
 *
 * Evaluates policy rules against employee context to determine what
 * provisioning actions to take. First-match-wins with priority ordering.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface EmployeeContext {
  employeeId: string;
  employeeName?: string;
  position?: string;
  division?: string;
  location?: string;
  certifications?: string[];
  employmentType?: string;
  shirtSize?: string;
  attributes?: Record<string, unknown>;
}

export interface PolicyRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  priority: number;
  match_positions: string[] | null;
  match_divisions: string[] | null;
  match_locations: string[] | null;
  match_certifications: string[] | null;
  match_employment_type: string | null;
  match_custom: Record<string, unknown> | null;
  kit_id: string | null;
  items: PolicyRuleInlineItem[] | null;
  trigger_events: string[];
  effective_from: string | null;
  effective_until: string | null;
  requires_approval: boolean;
  is_active: boolean;
}

export interface PolicyRuleInlineItem {
  catalog_item_id: string;
  qty: number;
  size_source?: 'employee_profile' | 'fixed' | 'ask_at_provision';
  fixed_variant_attributes?: Record<string, string>;
}

export interface PolicyEvaluationResult {
  matched: boolean;
  rule: PolicyRule | null;
  kitId: string | null;
  items: PolicyRuleInlineItem[] | null;
  requiresApproval: boolean;
}

/**
 * Check if an array condition matches.
 * null/empty condition = wildcard (matches everything).
 * Non-null condition: employee value must be contained in the condition array.
 */
function matchArrayCondition(condition: string[] | null, value: string | undefined): boolean {
  if (!condition || condition.length === 0) return true;
  if (!value) return false;
  return condition.some((c) => c.toLowerCase() === value.toLowerCase());
}

/**
 * Check if certifications overlap.
 * null/empty condition = wildcard.
 * Non-null: at least one of the employee's certifications must be in the condition.
 */
function matchCertifications(condition: string[] | null, employeeCerts: string[] | undefined): boolean {
  if (!condition || condition.length === 0) return true;
  if (!employeeCerts || employeeCerts.length === 0) return false;
  const condSet = new Set(condition.map((c) => c.toLowerCase()));
  return employeeCerts.some((ec) => condSet.has(ec.toLowerCase()));
}

/**
 * Check temporal validity of a rule against a given date.
 */
function isTemporallyValid(rule: PolicyRule, evalDate: Date): boolean {
  if (rule.effective_from) {
    const from = new Date(rule.effective_from);
    if (evalDate < from) return false;
  }
  if (rule.effective_until) {
    const until = new Date(rule.effective_until);
    if (evalDate > until) return false;
  }
  return true;
}

/**
 * Check if a single rule matches the employee context.
 */
function ruleMatchesEmployee(rule: PolicyRule, employee: EmployeeContext): boolean {
  if (!matchArrayCondition(rule.match_positions, employee.position)) return false;
  if (!matchArrayCondition(rule.match_divisions, employee.division)) return false;
  if (!matchArrayCondition(rule.match_locations, employee.location)) return false;
  if (!matchCertifications(rule.match_certifications, employee.certifications)) return false;

  if (rule.match_employment_type) {
    if (!employee.employmentType) return false;
    if (rule.match_employment_type.toLowerCase() !== employee.employmentType.toLowerCase()) return false;
  }

  return true;
}

/**
 * Evaluate provisioning policies for an employee + trigger event.
 *
 * 1. Load active rules filtered by trigger event, ordered by priority ASC
 * 2. Check temporal validity
 * 3. Match conditions against employee context
 * 4. First match wins
 * 5. Resolve kit or inline items
 */
export async function evaluatePolicies(
  supabase: SupabaseClient,
  tenantId: string,
  triggerEvent: string,
  employee: EmployeeContext,
  evalDate?: Date,
): Promise<PolicyEvaluationResult> {
  const prov = (supabase as any).schema('provisioning');
  const date = evalDate ?? new Date();

  // Load active rules that include this trigger event, ordered by priority
  const { data: rules, error } = await prov
    .from('policy_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .contains('trigger_events', [triggerEvent])
    .order('priority', { ascending: true })
    .limit(100);

  if (error || !rules || rules.length === 0) {
    return { matched: false, rule: null, kitId: null, items: null, requiresApproval: false };
  }

  for (const rule of rules as PolicyRule[]) {
    // Check temporal validity
    if (!isTemporallyValid(rule, date)) continue;

    // Check employee match
    if (!ruleMatchesEmployee(rule, employee)) continue;

    // First match wins
    return {
      matched: true,
      rule,
      kitId: rule.kit_id,
      items: rule.items,
      requiresApproval: rule.requires_approval,
    };
  }

  return { matched: false, rule: null, kitId: null, items: null, requiresApproval: false };
}

// Re-export for testing
export { matchArrayCondition, matchCertifications, isTemporallyValid, ruleMatchesEmployee };
