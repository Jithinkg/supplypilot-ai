import { assertFreeModelQuota, FreeModelPreflightError } from '../src/agents/preflight.js';
import { z } from 'zod';
import { ChatOpenRouter } from '@langchain/openrouter';
import { tool } from '@langchain/core/tools';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { calculatorSchema } from '@supplypilot/contracts';
import '../src/config/load-env.js';
import { FREE_MODEL } from '../src/config/env.js';
import { calculate } from '../src/services/calculator.js';

class SmokeFailure extends Error {}

async function main() {
  const modelId = process.env.OPENROUTER_MODEL || FREE_MODEL;
  if (modelId !== FREE_MODEL) throw new SmokeFailure('Only the approved :free model is allowed. No fallback will be used.');
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) { console.log('SKIPPED: OPENROUTER_API_KEY is not configured. Live inference not verified.'); return; }
  if (!/^sk-or-[A-Za-z0-9_-]{16,}$/.test(key)) throw new SmokeFailure('API key format is invalid. Live test not attempted.');
  const signal = AbortSignal.timeout(60_000);
  const response = await fetch('https://openrouter.ai/api/v1/models', { signal });
  if (!response.ok) throw new SmokeFailure('OpenRouter catalog unavailable; no inference attempted.');
  const catalog = z.object({ data: z.array(z.object({ id: z.string(), supported_parameters: z.array(z.string()), pricing: z.object({ prompt: z.string(), completion: z.string() }) })) }).parse(await response.json());
  const entry = catalog.data.find((item) => item.id === FREE_MODEL);
  if (!entry || !entry.supported_parameters.includes('tools') || !entry.supported_parameters.includes('tool_choice') || Number(entry.pricing.prompt) !== 0 || Number(entry.pricing.completion) !== 0) {
    throw new SmokeFailure('Approved free model is unavailable, not free, or lacks tool calling. Agent implementation must remain blocked.');
  }
  await assertFreeModelQuota(key, 2);
  const calculator = tool(async (args) => String(calculate(args)), { name: 'calculator', description: 'Add or multiply two integers.', schema: calculatorSchema });
  const model = new ChatOpenRouter({ apiKey: key, model: FREE_MODEL, temperature: 0, maxTokens: 512, maxRetries: 0, provider: { max_price: { prompt: '0', completion: '0', request: '0' }, require_parameters: true } });
  const bound = model.bindTools([calculator], { tool_choice: { type: 'function', function: { name: 'calculator' } } });
  const question = new HumanMessage('Use calculator to multiply 6 by 7.');
  const answer = await bound.invoke([question], { signal });
  const calls = answer.tool_calls ?? [];
  if (calls.length !== 1) throw new SmokeFailure('Expected exactly one tool call.');
  const call = calls[0];
  if (!call || call.name !== 'calculator' || !call.id) throw new SmokeFailure('Unexpected tool call.');
  const args = calculatorSchema.parse(call.args);
  if (args.operation !== 'multiply' || args.a !== 6 || args.b !== 7) throw new SmokeFailure('Unexpected calculator arguments.');
  const result = await calculator.invoke(args);
  if (result !== '42') throw new SmokeFailure('Calculator result mismatch.');
  const final = await model.invoke([question, answer, new ToolMessage({ tool_call_id: call.id, content: result })], { signal });
  if (typeof final.content !== 'string' || !/\b42\b/.test(final.content)) throw new SmokeFailure('Model did not acknowledge the tool result.');
  console.log(`PASS: ${FREE_MODEL}; catalog, Zod-validated tool call, execution and result round trip verified.`);
}
main().catch((error: unknown) => {
  // SDK errors can include headers/request data: never dump raw provider errors.
  const reason = error instanceof SmokeFailure || error instanceof FreeModelPreflightError ? error.message : error instanceof z.ZodError ? 'Provider response or tool arguments failed schema validation.' : 'Provider request failed; check key authorization, network availability, rate limits and tool compatibility.';
  console.error(`OpenRouter smoke test FAILED: ${reason} No paid fallback was attempted; agents remain unverified.`);
  process.exitCode = 1;
});
