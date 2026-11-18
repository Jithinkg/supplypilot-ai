import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createProposalSchema } from '@supplypilot/contracts';
import { canonicalDraft } from './proposals.js';
import { transaction } from './transactions.js';

const a = '11111111-1111-4111-a111-111111111111';
const b = '22222222-2222-4222-a222-222222222222';
describe('proposal trust boundaries', () => {
  it('normalizes equivalent item orders and reasons for idempotency', () => {
    expect(canonicalDraft({ items: [{ productId: b }, { productId: a, quantity: 2 }], reason: ' Restock ' }))
      .toEqual(canonicalDraft({ items: [{ productId: a, quantity: 2 }, { productId: b }], reason: 'Restock' }));
  });
  it('rejects duplicates, invalid quantities and client-selected financial/authority fields', () => {
    const valid = { items: [{ productId: a, quantity: 2 }], reason: 'Restock' };
    for (const extra of [{ status: 'APPROVED' }, { supplierId: b }, { totalPaise: 1 }, { role: 'MANAGER' }, { creatorId: b }, { agentRunId: b }]) {
      expect(createProposalSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
    expect(createProposalSchema.safeParse({ ...valid, items: [{ productId: a }, { productId: a }] }).success).toBe(false);
    expect(createProposalSchema.safeParse({ ...valid, items: [{ productId: a, quantity: 0 }] }).success).toBe(false);
    expect(createProposalSchema.safeParse({ ...valid, reason: ' ' }).success).toBe(false);
  });
  it('retries transaction conflicts a bounded number of times, but not other errors', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Conflict', { code: 'P2034', clientVersion: 'test' })).mockResolvedValue('ok');
    const db = { $transaction: run } as unknown as PrismaClient;
    expect(await transaction(db, async () => 'unused')).toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
    run.mockReset().mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Deadlock', { code: 'P2010', clientVersion: 'test', meta: { code: '40P01' } })).mockResolvedValue('retried');
    expect(await transaction(db, async () => 'unused')).toBe('retried');
    expect(run).toHaveBeenCalledTimes(2);
    run.mockReset().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Conflict', { code: 'P2034', clientVersion: 'test' }));
    await expect(transaction(db, async () => 'unused')).rejects.toMatchObject({ status: 409, code: 'TRANSACTION_CONFLICT' });
    expect(run).toHaveBeenCalledTimes(3);
    run.mockReset().mockRejectedValue(new Error('Audit failure'));
    await expect(transaction(db, async () => 'unused')).rejects.toThrow('Audit failure');
    expect(run).toHaveBeenCalledOnce();
  });
});
