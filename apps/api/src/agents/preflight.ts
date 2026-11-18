import { z } from 'zod';
const quotaSchema = z.object({ data: z.object({ free_model_daily_requests: z.object({ used: z.number().int().nonnegative(), limit: z.number().int().nonnegative(), remaining: z.number().int().nonnegative() }) }) });
export class FreeModelPreflightError extends Error {}
// Operator smoke checks only. Metadata requests do not generate model tokens.
export async function assertFreeModelQuota(key: string, minimumRequests = 1) {
  z.number().int().positive().parse(minimumRequests);
  let response: Response;
  try { response = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }); }
  catch { throw new FreeModelPreflightError('FREE_MODEL_QUOTA_UNAVAILABLE: No inference attempted.'); }
  if (!response.ok) throw new FreeModelPreflightError('FREE_MODEL_QUOTA_UNAVAILABLE: No inference attempted.');
  const quota = quotaSchema.safeParse(await response.json().catch(() => null));
  if (!quota.success) throw new FreeModelPreflightError('FREE_MODEL_QUOTA_UNAVAILABLE: No inference attempted.');
  if (quota.data.data.free_model_daily_requests.remaining < minimumRequests) throw new FreeModelPreflightError('FREE_MODEL_QUOTA_EXHAUSTED: Not enough free-model requests for this check. No inference attempted.');
  return quota.data.data.free_model_daily_requests;
}
