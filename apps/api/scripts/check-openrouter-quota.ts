import '../src/config/load-env.js';
import { z } from 'zod';
const schema = z.object({ data: z.object({ free_model_daily_requests: z.object({ used: z.number().int().nonnegative(), limit: z.number().int().nonnegative(), remaining: z.number().int().nonnegative() }).optional() }) });
try {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error('Missing key');
  const response = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) { console.log(`Quota metadata unavailable (HTTP ${response.status}). No inference requested.`); process.exitCode = 1; }
  else {
    const result = schema.safeParse(await response.json());
    if (!result.success || !result.data.data.free_model_daily_requests) { console.log('Free-model daily counters are not available in the key response. No inference requested.'); }
    else console.log(JSON.stringify({ freeModelDailyRequests: result.data.data.free_model_daily_requests, note: 'Read-only key metadata; no inference requested.' }));
  }
} catch { console.error('Unable to check quota metadata. No credential or response content logged; no inference requested.'); process.exitCode = 1; }
