import { expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateProposalDialog } from './create-dialog';
import { api, ApiError } from '@/lib/api';
import { account, batch, comparison, dashboard, product } from '@/test/fixtures';
import { renderWorkspace } from '@/test/render';
import { readPendingDraft, savePendingDraft } from './pending-draft';
function reads() {
  vi.spyOn(api, 'inventory').mockResolvedValue({ items: [product], total: 1, page: 1, pageSize: 8, summary: dashboard, asOf: dashboard.asOf, windowStart: '2026-10-18', windowEnd: '2026-11-16' });
  vi.spyOn(api, 'quotes').mockResolvedValue(comparison);
}
it('retries a lost response with exactly the same user-scoped key and body', async () => {
  reads();
  const create = vi.spyOn(api, 'create').mockRejectedValueOnce(new ApiError(0, 'Connection interrupted', 'NETWORK_ERROR')).mockResolvedValueOnce(batch);
  renderWorkspace(<CreateProposalDialog initial={[product]} onClose={vi.fn()} />);
  await screen.findByText(/Harbor Supplies · 50 units/);
  await userEvent.type(screen.getByLabelText('Purchase reason'), 'Replenish packing tape');
  await userEvent.click(screen.getByRole('button', { name: 'Create drafts' }));
  expect(await screen.findByText('Connection interrupted')).toBeVisible();
  const saved = readPendingDraft(account.user.id);
  expect(saved?.input.items).toEqual([{ productId: product.productId }]);
  expect(readPendingDraft('another-user')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Retry saved request' }));
  await screen.findByText('Proposal request complete');
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
  expect(create.mock.calls[0]?.[2]).toBe(saved?.key);
  expect(readPendingDraft(account.user.id)).toBeNull();
});
it('recovers saved requests after reopening without generating another key', async () => {
  reads();
  const saved = { userId: account.user.id, key: 'persisted-key', input: { items: [{ productId: product.productId, quantity: 5 }], reason: 'Saved request' } };
  savePendingDraft(saved);
  const create = vi.spyOn(api, 'create').mockResolvedValue(batch);
  renderWorkspace(<CreateProposalDialog onClose={vi.fn()} />);
  expect(screen.getByText('Recover pending request')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Retry saved request' }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(saved.input, account.csrfToken, saved.key));
});
it('requires explicit quantity for zero-demand products', async () => {
  reads();
  vi.mocked(api.quotes).mockResolvedValue({ ...comparison, quantity: null, quantityRequired: true, selectedQuoteId: null, exclusionReason: 'NO_RECENT_DEMAND' });
  const create = vi.spyOn(api, 'create');
  renderWorkspace(<CreateProposalDialog initial={[product]} onClose={vi.fn()} />);
  await screen.findByText('No recent demand. Enter a quantity to purchase.');
  await userEvent.type(screen.getByLabelText('Purchase reason'), 'Manual purchase');
  await userEvent.click(screen.getByRole('button', { name: 'Create drafts' }));
  expect(screen.getByText('Enter an explicit quantity for products with no recent demand.')).toBeVisible();
  expect(create).not.toHaveBeenCalled();
});
