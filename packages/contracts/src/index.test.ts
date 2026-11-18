import { describe, expect, it } from 'vitest';
import { loginSchema, paiseSchema, calculatorSchema } from './index.js';

describe('trust boundary schemas', () => {
  it('permits only integer paise within PostgreSQL bounds', () => {
    expect(paiseSchema.parse(50_000_000)).toBe(50_000_000);
    for (const input of [-1, 1.5, 2_147_483_648, '100', NaN, Infinity]) expect(paiseSchema.safeParse(input).success).toBe(false);
  });
  it('rejects client role escalation and bounds password inputs', () => {
    expect(loginSchema.safeParse({ email: 'staff@example.test', password: 'x', role: 'MANAGER' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'staff@example.test', password: 'x'.repeat(129) }).success).toBe(false);
    expect(loginSchema.parse({ email: 'STAFF@example.test', password: 'x' }).email).toBe('staff@example.test');
  });
  it('rejects malformed or extra calculator arguments', () => {
    expect(calculatorSchema.safeParse({ operation: 'divide', a: 6, b: 7 }).success).toBe(false);
    expect(calculatorSchema.safeParse({ operation: 'add', a: '6', b: 7 }).success).toBe(false);
    expect(calculatorSchema.safeParse({ operation: 'add', a: 6, b: 7, code: 'run' }).success).toBe(false);
  });
});
