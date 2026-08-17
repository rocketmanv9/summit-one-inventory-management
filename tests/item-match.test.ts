// Unit tests for the shared item-name matcher (@/lib/ai/item-match).
//
// This is the DRY matcher that both recommend-vendor's resolveItem and
// execute-action's resolveItem now share. The load-bearing case: a plural query
// ("Fuel Cans") must resolve to the singular catalog row ("Fuel Can") — that
// exact miss was defect 2 of the conversational-procure fix.

import { describe, it, expect } from 'vitest';
import {
  norm,
  singularize,
  tokens,
  tokenOverlapScore,
  singularizedIlikePattern,
} from '@/lib/ai/item-match';

describe('item-match: norm', () => {
  it('lowercases, collapses punctuation and whitespace', () => {
    expect(norm('  Fuel-Can  (94lb) ')).toBe('fuel can 94lb');
    expect(norm('Wheel_Stop / Curb')).toBe('wheel stop curb');
  });
});

describe('item-match: singularize', () => {
  it('folds common plural endings', () => {
    expect(singularize('cans')).toBe('can');
    expect(singularize('wheelstops')).toBe('wheelstop');
    expect(singularize('batteries')).toBe('battery');
    expect(singularize('boxes')).toBe('box');
  });
  it('leaves short and non-plural words alone', () => {
    expect(singularize('gas')).toBe('gas'); // <=3 chars
    expect(singularize('glass')).toBe('glass'); // ss
    expect(singularize('status')).toBe('status'); // us
    expect(singularize('axis')).toBe('axis'); // is
  });
});

describe('item-match: tokens', () => {
  it('singularizes each token and drops 1-char noise', () => {
    expect(tokens('Fuel Cans')).toEqual(['fuel', 'can']);
    expect(tokens('5 Fuel Cans')).toEqual(['fuel', 'can']); // single-char "5" is dropped
  });
});

describe('item-match: tokenOverlapScore', () => {
  it('scores a plural query against the singular row as a full match', () => {
    // "Fuel Cans" vs "Fuel Can" → tokens {fuel,can} vs {fuel,can} → 1.0
    expect(tokenOverlapScore('Fuel Cans', 'Fuel Can')).toBe(1);
  });
  it('clears the 0.34 resolver threshold for a plural vs singular catalog name', () => {
    // Multi-word plural "Wheel Stops" folds to {wheel, stop} — a full match for
    // the "Wheel Stop" catalog row.
    expect(tokenOverlapScore('Wheel Stops', 'Wheel Stop')).toBe(1);
    // "5 Fuel Cans" (the qty-prefixed phrasing) still lands on "Fuel Can".
    expect(tokenOverlapScore('5 Fuel Cans', 'Fuel Can')).toBeGreaterThanOrEqual(0.34);
  });
  it('a single-word compound query is left to the raw/singularized ilike, not token overlap', () => {
    // "wheelstops" folds to "wheelstop" — one token, no overlap with {wheel,stop}.
    // The resolver tries a raw + singularized ilike BEFORE token overlap, which is
    // what catches a single-word catalog row like "Wheelstop".
    expect(tokenOverlapScore('wheelstops', 'Wheel Stop')).toBe(0);
    expect(singularizedIlikePattern('wheelstops')).toBe('%wheelstop%');
  });
  it('returns 0 for no shared tokens', () => {
    expect(tokenOverlapScore('rebar', 'Fuel Can')).toBe(0);
  });
  it('returns 0 when either side is empty', () => {
    expect(tokenOverlapScore('', 'Fuel Can')).toBe(0);
    expect(tokenOverlapScore('Fuel Can', '')).toBe(0);
  });
});

describe('item-match: singularizedIlikePattern', () => {
  it('builds a singularized wildcard so a plural query catches the singular row', () => {
    expect(singularizedIlikePattern('Fuel Cans')).toBe('%fuel%can%');
    expect(singularizedIlikePattern('wheelstops')).toBe('%wheelstop%');
  });
  it('returns null when there are no usable tokens', () => {
    expect(singularizedIlikePattern('   ')).toBeNull();
    expect(singularizedIlikePattern('!!')).toBeNull();
  });
});
