import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HumanMessage } from '@langchain/core/messages';
const captured = vi.hoisted(() => ({ bind: vi.fn(), invoke: vi.fn(), config: vi.fn() }));
vi.mock('@langchain/openrouter', () => ({ ChatOpenRouter: class {
  constructor(options: unknown) { captured.config(options); }
  bindTools(tools: { name: string }[], options: unknown) {
    captured.bind(tools.map((item) => item.name), options);
    return { invoke: captured.invoke };
  }
} }));
import { createModelInvoker, definition } from './model.js';
import { FREE_MODEL } from '../config/env.js';
it('offers only the graph-selected assigned tool and never executes tools while binding', async () => {
  const execute = vi.fn(async () => 'result');
  captured.invoke.mockResolvedValue({ tool_calls: [{ name: 'getInventoryRisks', args: {}, id: 'read-1' }], usage_metadata: { input_tokens: 100, output_tokens: 20 } });
  const tools = ['getStockLevels', 'getSalesHistory', 'getInventoryRisks'].map((name) => definition(name, 'Read inventory', z.object({}).strict(), execute));
  const result = await createModelInvoker('test-only-key')({ messages: [new HumanMessage('any products at risk')], tools, forced: 'getInventoryRisks', signal: new AbortController().signal });
  expect(captured.bind).toHaveBeenCalledWith(['getInventoryRisks'], { tool_choice: { type: 'function', function: { name: 'getInventoryRisks' } } });
  expect(result.calls).toEqual([{ name: 'getInventoryRisks', args: {}, id: 'read-1' }]);
  expect(execute).not.toHaveBeenCalled();
  expect(captured.config).toHaveBeenCalledWith(expect.objectContaining({ model: FREE_MODEL, maxRetries: 0, provider: { max_price: { prompt: '0', completion: '0', request: '0' }, require_parameters: true } }));
});
it('rejects forcing a tool outside the assigned registry before contacting the provider', async () => {
  captured.bind.mockClear(); captured.invoke.mockClear();
  const tools = [definition('getInventoryRisks', 'Read inventory', z.object({}).strict(), async () => [])];
  await expect(createModelInvoker('test-only-key')({ messages: [], tools, forced: 'approveProposal', signal: new AbortController().signal })).rejects.toThrow('TOOL_DENIED');
  expect(captured.bind).not.toHaveBeenCalled(); expect(captured.invoke).not.toHaveBeenCalled();
});
