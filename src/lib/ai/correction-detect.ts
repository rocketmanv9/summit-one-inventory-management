/**
 * Correction Detection — Detects mid-flow corrections like "actually make it 90"
 * and maps them to the appropriate previously-collected field.
 */

import type { ActiveFlow } from './types';

export interface CorrectionResult {
  field: string;
  fieldLabel: string;
  value: string;
}

const CORRECTION_PATTERNS: Array<{ re: RegExp; valueGroup: number; fieldHintGroup?: number }> = [
  { re: /^actually[,\s]+(?:make it |change (?:it |that )?to |use )?(.+)/i, valueGroup: 1 },
  { re: /^i meant[,\s]+(.+)/i, valueGroup: 1 },
  { re: /^wait[,\s]+(.+)/i, valueGroup: 1 },
  { re: /^(?:no|nah)[,\s]+(?:make it |change (?:it |that )?to |use )?(.+)/i, valueGroup: 1 },
  { re: /^not .+[,\s]+(?:but |use |it(?:'s| is) )(.+)/i, valueGroup: 1 },
  { re: /^change (?:the )?(\w+) to (.+)/i, valueGroup: 2, fieldHintGroup: 1 },
];

export function detectCorrection(input: string, flow: ActiveFlow): CorrectionResult | null {
  const trimmed = input.trim();

  for (const pattern of CORRECTION_PATTERNS) {
    const match = trimmed.match(pattern.re);
    if (!match) continue;
    const newValue = match[pattern.valueGroup].trim();

    // For "change X to Y", try to match X to a field name
    if (pattern.fieldHintGroup) {
      const fieldHint = match[pattern.fieldHintGroup]?.toLowerCase();
      for (let i = 0; i < flow.currentStepIndex; i++) {
        const step = flow.action.steps[i];
        if (
          step.field.toLowerCase().includes(fieldHint) ||
          step.prompt.toLowerCase().includes(fieldHint)
        ) {
          return { field: step.field, fieldLabel: step.field.replace(/_/g, ' '), value: newValue };
        }
      }
    }

    // For "actually X" / "I meant X", try to match the value to a previous step's options or type
    for (let i = flow.currentStepIndex - 1; i >= 0; i--) {
      const step = flow.action.steps[i];
      if (step.type === 'confirm') continue;

      // If this step has select options, check if the new value matches one
      if (step.options) {
        const found = step.options.find(
          (o) =>
            o.label.toLowerCase().includes(newValue.toLowerCase()) ||
            newValue.toLowerCase().includes(o.label.toLowerCase())
        );
        if (found) {
          return { field: step.field, fieldLabel: step.field.replace(/_/g, ' '), value: found.value };
        }
      }

      // If this step is a number and the new value is a number, assume it's this field
      if (step.type === 'number' && !isNaN(Number(newValue))) {
        return { field: step.field, fieldLabel: step.field.replace(/_/g, ' '), value: newValue };
      }

      // If this step is text, assume it's the most recent text field
      if (step.type === 'text') {
        return { field: step.field, fieldLabel: step.field.replace(/_/g, ' '), value: newValue };
      }
    }
  }

  return null;
}
