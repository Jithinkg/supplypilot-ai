import { expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProposalDetailPage } from './proposal-detail';
import { api } from '@/lib/api';
import { proposal, comparison } from '@/test/fixtures';
import { renderWorkspace } from '@/test/render';
it('shows product names and immutable snapshots and fetches comparison only on request', async () => {
  vi.spyOn(api, 'proposal').mockResolvedValue(proposal);
  const quotes = vi.spyOn(api, 'quotes').mockResolvedValue(comparison);
  renderWorkspace(<ProposalDetailPage />);
  expect(await screen.findByRole('heading', { name: 'Products in this proposal' })).toBeVisible();
  expect(within(screen.getByRole('table')).getByText('SP-003', { exact: true })).toBeVisible();
  expect(screen.getByText('10 rolls')).toBeVisible();
  expect(quotes).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Compare current quotes' }));
  expect(await screen.findByText(/Harbor Supplies · Proposal supplier/)).toBeVisible();
  expect(quotes).toHaveBeenCalledWith(proposal.lines[0]?.product.id, 10, expect.any(AbortSignal));
});
