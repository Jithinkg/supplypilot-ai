import { describe, expect, it } from 'vitest';
import { affordability, availableBudgetPaise, lineTotalPaise, sumPaise } from './money.js';
describe('integer paise calculations', () => {
  it('calculates precise line/batch totals and available funds', () => {
    expect(lineTotalPaise(199, 3)).toBe(597);
    expect(sumPaise([597, 101])).toBe(698);
    expect(availableBudgetPaise(50_000_000, 698)).toBe(49_999_302);
    expect(sumPaise([])).toBe(0);
  });
  it('reports shortfall without rejecting over-budget draft estimates', () => {
    expect(affordability(101, 100)).toEqual({ overBudget: true, shortfallPaise: 1 });
    expect(affordability(100, 100)).toEqual({ overBudget: false, shortfallPaise: 0 });
    expect(affordability(99, 100)).toEqual({ overBudget: false, shortfallPaise: 0 });
  });
  it('rejects fractional inputs, negative balances, invalid quantities and overflow', () => {
    expect(() => lineTotalPaise(1.1, 3)).toThrow();
    expect(() => lineTotalPaise(100, 0)).toThrow();
    expect(() => lineTotalPaise(2_147_483_647, 2)).toThrow();
    expect(() => sumPaise([2_147_483_647, 1])).toThrow();
    expect(() => availableBudgetPaise(100, 101)).toThrow();
  });
});
