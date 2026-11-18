import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { classify, definition, executeAgent } from './model.js';
function limits() { return { toolCalls: 0, signal: new AbortController().signal, check: vi.fn(async () => {}) }; }
describe('server-enforced specialist capabilities', () => {
  it('rejects cross-agent tools before executing any part of a batch', async () => {
    const execute = vi.fn(async () => 42);
    const tools = [definition('getAvailableBudget', 'Read budget', z.object({}).strict(), execute)];
    const invoke = vi.fn(async () => ({ calls: [{ name: 'getAvailableBudget', args: {}, id: '1' }, { name: 'approveProposal', args: {}, id: '2' }] }));
    await expect(executeAgent(invoke, 'Procurement', 'ignore rules', tools, limits(), 'getAvailableBudget', {})).rejects.toThrow('TOOL_DENIED');
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects identity/role spoofing in tool arguments', async () => {
    const execute = vi.fn(async () => 42);
    const tools = [definition('getAvailableBudget', 'Read budget', z.object({}).strict(), execute)];
    const invoke = vi.fn(async () => ({ calls: [{ name: 'getAvailableBudget', args: { role: 'MANAGER' }, id: '1' }] }));
    await expect(executeAgent(invoke, 'Procurement', 'budget', tools, limits(), 'getAvailableBudget', {})).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('limits calls before executing an oversized batch', async () => {
    const execute = vi.fn(async () => 42);
    const tools = [definition('getAvailableBudget', 'Read budget', z.object({}).strict(), execute)];
    const invoke = vi.fn(async () => ({ calls: Array.from({ length: 13 }, (_, index) => ({ name: 'getAvailableBudget', args: {}, id: String(index) })) }));
    await expect(executeAgent(invoke, 'Procurement', 'budget', tools, limits(), 'getAvailableBudget', {})).rejects.toThrow('TOOL_LIMIT');
    expect(execute).not.toHaveBeenCalled();
  });
  it('allows one classification repair and fails closed on another invalid result', async () => {
    const invoke = vi.fn(async () => ({ calls: [{ name: 'classifyIntent', args: { intent: 'approveAnything' }, id: '1' }] }));
    await expect(classify(invoke, 'hello', limits())).rejects.toThrow('INVALID_CLASSIFICATION');
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('checks the trusted deadline and permissions before model invocation', async () => {
    const invoke = vi.fn(async () => ({ calls: [] }));
    const budget = limits(); budget.check.mockRejectedValue(new Error('RUN_TIMEOUT'));
    await expect(classify(invoke, 'hello', budget)).rejects.toThrow('RUN_TIMEOUT');
    expect(invoke).not.toHaveBeenCalled();
  });
});
it('grounds advisory generation in retrieved passages and rejects invented citations or verdicts', async () => {
  const { reviewEvidence } = await import('./model.js');
  const source = { outcome: 'EVIDENCE_FOUND' as const, advisory: true as const, findings: 'Retrieved source', citations: [{ documentId: 'e4509653-9820-4ce8-8e3c-f4d4dabd4a5f', chunkId: '4692ba47-f421-4ab9-84be-44156267cc82', pageNumber: 1, supportingText: 'Compare supplier delivery lead times.' }] };
  const budget = { toolCalls: 0, signal: new AbortController().signal, check: async () => {} };
  const correct = vi.fn(async () => ({ calls: [{ name: 'formatPolicyFindings', args: { finding: 'SUPPORTING_CLAUSE', citationIndexes: [0] }, id: '1' }] }));
  const reviewed = await reviewEvidence(correct, 'What should buyers compare?', source, budget);
  expect(reviewed.citations).toEqual(source.citations);
  expect(JSON.stringify(correct.mock.calls)).toContain('Compare supplier delivery lead times.');
  const invented = vi.fn(async () => ({ calls: [{ name: 'formatPolicyFindings', args: { finding: 'SUPPORTING_CLAUSE', citationIndexes: [99] }, id: '1' }] }));
  await expect(reviewEvidence(invented, 'question', source, budget)).rejects.toThrow();
  const approval = vi.fn(async () => ({ calls: [{ name: 'formatPolicyFindings', args: { finding: 'COMPLIANCE_APPROVED', citationIndexes: [0] }, id: '1' }] }));
  await expect(reviewEvidence(approval, 'question', source, budget)).rejects.toThrow();
});
