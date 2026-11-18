import { describe, expect, it } from 'vitest';
import { calculate } from './calculator.js';
describe('smoke calculator', () => {
  it('calculates the smoke result and rejects unsafe inputs', () => {
    expect(calculate({ operation: 'multiply', a: 6, b: 7 })).toBe(42);
    expect(calculate({ operation: 'add', a: -6, b: 7 })).toBe(1);
    expect(() => calculate({ operation: 'multiply', a: 1e20, b: 7 })).toThrow();
  });
});
