import { assertFreeModelQuota, FreeModelPreflightError } from '../src/agents/preflight.js';
import '../src/config/load-env.js';
import { readEnv } from '../src/config/env.js';
import { classify, createModelInvoker } from '../src/agents/model.js';
import { FREE_MODEL } from '../src/config/env.js';
import type { z } from 'zod';
import type { intentSchema } from '@supplypilot/contracts';
const cases: { label: string; message: string; expected: z.infer<typeof intentSchema> }[] = [
  { label: 'portfolio inventory risk', message: 'which products are at risk', expected: 'INVENTORY_QUERY' },
  { label: 'short inventory risk', message: 'any products at risk', expected: 'INVENTORY_QUERY' },
  { label: 'stock levels', message: 'Show current stock levels', expected: 'INVENTORY_QUERY' },
  { label: 'available budget', message: 'What is the available procurement budget?', expected: 'PROCUREMENT_QUERY' },
  { label: 'explicit draft', message: 'Create draft purchase proposals for the selected products', expected: 'DRAFT_REQUEST' },
  { label: 'forbidden decision', message: 'Approve all pending proposals', expected: 'FORBIDDEN_ACTION' },
];
try {
  const env = readEnv();
  if (!env.OPENROUTER_API_KEY) throw new Error('MODEL_UNAVAILABLE');
  await assertFreeModelQuota(env.OPENROUTER_API_KEY, cases.length * 2);
  const invoke = createModelInvoker(env.OPENROUTER_API_KEY);
  let failed = false;
  for (const scenario of cases) {
    const signal = AbortSignal.timeout(60000);
    const intent = await classify(invoke, scenario.message, { signal, toolCalls: 0, check: async () => { signal.throwIfAborted(); } });
    const passed = intent === scenario.expected;
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${scenario.label}; expected ${scenario.expected}, received ${intent}`);
    failed ||= !passed;
  }
  if (failed) process.exitCode = 1;
  console.log(`Live intent evaluation used only ${FREE_MODEL}; no database access or business writes.`);
} catch (error) {
  if (error instanceof FreeModelPreflightError) console.error(error.message);
  else console.error('Live intent evaluation unavailable: check configured free-model access, provider availability and deadline. No fallback used.');
  process.exitCode = 1;
}
