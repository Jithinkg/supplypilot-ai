import { afterEach, expect, it, vi } from 'vitest';
import { assertFreeModelQuota } from './preflight.js';
afterEach(() => vi.unstubAllGlobals());
it('blocks checks when the shared free-model quota is exhausted', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { free_model_daily_requests: { used: 51, limit: 50, remaining: 0 }, label: 'private account metadata' } })));
  vi.stubGlobal('fetch', fetcher);
  await expect(assertFreeModelQuota('test-only-key', 2)).rejects.toThrow('FREE_MODEL_QUOTA_EXHAUSTED');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key', expect.objectContaining({ headers: { Authorization: 'Bearer test-only-key' } }));
});
it('requires enough remaining requests for the planned check and returns only the counters', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: { free_model_daily_requests: { used: 45, limit: 50, remaining: 5 }, label: 'private' } }))));
  await expect(assertFreeModelQuota('test-only-key', 6)).rejects.toThrow('FREE_MODEL_QUOTA_EXHAUSTED');
  await expect(assertFreeModelQuota('test-only-key', 2)).resolves.toEqual({ used: 45, limit: 50, remaining: 5 });
});
it('fails closed without echoing malformed or unavailable account responses', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { label: 'secret-value' } }))));
  await expect(assertFreeModelQuota('test-only-key')).rejects.toThrow('FREE_MODEL_QUOTA_UNAVAILABLE');
});
