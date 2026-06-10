import { describe, it, expect } from 'vitest';
import { zipToState, stateZipProblem, validateShipToAddress } from '../src/lib/integrations/amazon-cxml';

describe('zipToState', () => {
  it('maps ZIPs to their state by prefix', () => {
    expect(zipToState('98002')).toBe('WA'); // Auburn WA
    expect(zipToState('98662')).toBe('WA'); // Vancouver WA
    expect(zipToState('97220')).toBe('OR'); // Portland OR
    expect(zipToState('30301')).toBe('GA');
  });
  it('returns null for malformed input', () => {
    expect(zipToState('abc')).toBeNull();
    expect(zipToState('')).toBeNull();
  });
});

describe('stateZipProblem', () => {
  it('flags the real Portland OR + 98662 mismatch', () => {
    const p = stateZipProblem('OR', '98662', 'US');
    expect(p).toMatch(/mismatch/i);
    expect(p).toContain('WA');
  });
  it('accepts a consistent address and normalizes full state names', () => {
    expect(stateZipProblem('WA', '98002', 'US')).toBeNull();
    expect(stateZipProblem('Washington', '98002', 'US')).toBeNull(); // normalizes to WA
  });
  it('rejects an unrecognized state and a malformed ZIP', () => {
    expect(stateZipProblem('ZZ', '98002', 'US')).toMatch(/unrecognized state/i);
    expect(stateZipProblem('WA', '980', 'US')).toMatch(/invalid ZIP/i);
  });
  it('skips validation when state or ZIP is missing, or non-US', () => {
    expect(stateZipProblem(null, '98002', 'US')).toBeNull();
    expect(stateZipProblem('WA', null, 'US')).toBeNull();
    expect(stateZipProblem('ON', 'K1A0B1', 'CA')).toBeNull();
  });
});

describe('validateShipToAddress', () => {
  const good = { name: 'Auburn', address_line_1: '2118 A St SE', city: 'Auburn', state: 'Washington', postal_code: '98002', country: 'US' };
  it('passes a complete consistent address', () => {
    expect(() => validateShipToAddress(good, 'Auburn')).not.toThrow();
  });
  it('throws on missing fields', () => {
    expect(() => validateShipToAddress({ ...good, postal_code: null }, 'Auburn')).toThrow(/missing structured address/i);
  });
  it('throws naming the location on a state/ZIP mismatch', () => {
    expect(() => validateShipToAddress({ name: 'Portland', address_line_1: '10319 Marx St', city: 'Portland', state: 'OR', postal_code: '98662', country: 'US' }, 'Portland'))
      .toThrow(/Portland.*mismatch/i);
  });
});
