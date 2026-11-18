import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import { dashboard, product, id } from '@/test/fixtures';
import { money, stockoutDays } from './format';

describe('API trust boundaries', () => {
  it('rejects malformed assistant results without treating an uncertain request as complete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ runId: id, status: 'COMPLETED', createdProposalIds: ['invalid-id'] }))));
    await expect(api.assistant({ message: 'Check budget', mode: 'READ_ONLY' }, 'csrf', 'same-key')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('lets the browser set multipart boundaries while preserving CSRF and cookies', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    const file = new File(['%PDF'], 'policy.pdf', { type: 'application/pdf' });
    await expect(api.uploadDocument({ title: 'Policy', type: 'PROCUREMENT_POLICY' }, file, 'csrf')).rejects.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledWith('/api/knowledge/documents', expect.objectContaining({ credentials: 'include', body: expect.any(FormData), headers: { 'x-csrf-token': 'csrf' } }));
  });
  it('validates responses instead of rendering malformed monetary data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...dashboard, availableBudgetPaise: 1.5 }))));
    await expect(api.dashboard()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('keeps error status, safe message and request reference', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds.', requestId: 'trace-1' } }), { status: 409 })));
    await expect(api.approve(product.productId, 'csrf')).rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_FUNDS', requestId: 'trace-1' });
  });
  it('sends cookies, CSRF and the supplied retry key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(api.create({ items: [{ productId: product.productId }], reason: 'Needed' }, 'csrf', 'same-key')).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledWith('/api/proposals', expect.objectContaining({ credentials: 'include', headers: expect.objectContaining({ 'x-csrf-token': 'csrf', 'idempotency-key': 'same-key' }) }));
  });
  it('does not mark failed login as an expired protected session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(api.login('staff@example.test', 'incorrect')).rejects.toMatchObject({ protectedRequest: false });
  });
  it('only converts paise at display time and handles no demand', () => {
    expect(money(12345)).toBe('₹123.45');
    expect(stockoutDays(null)).toBe('No recent demand');
  });
});
