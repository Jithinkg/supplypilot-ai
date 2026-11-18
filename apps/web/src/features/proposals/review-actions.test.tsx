import { expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewActions } from './review-actions';
import { api, ApiError } from '@/lib/api';
import { account, proposal } from '@/test/fixtures';
import { renderWorkspace } from '@/test/render';
const manager = { ...account, user: { ...account.user, role: 'MANAGER' as const } };
it('staff can read but cannot see decision buttons', () => {
  renderWorkspace(<ReviewActions proposal={proposal} />);
  expect(screen.getByText(/A manager must review/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
});
it('manager confirmation sends the CSRF token and refreshes business data', async () => {
  const approve = vi.spyOn(api, 'approve').mockResolvedValue({ ...proposal, status: 'APPROVED', affordability: null });
  const { client } = renderWorkspace(<ReviewActions proposal={proposal} />, manager);
  const refresh = vi.spyOn(client, 'invalidateQueries');
  await userEvent.click(screen.getByRole('button', { name: /^Approve$/ }));
  expect(approve).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
  await waitFor(() => expect(approve).toHaveBeenCalledWith(proposal.id, account.csrfToken));
  expect(await screen.findByText(/Proposal approved/)).toBeVisible();
  expect(refresh).toHaveBeenCalled();
});
it('blocks insufficient-funds approval but permits rejection', () => {
  renderWorkspace(<ReviewActions proposal={{ ...proposal, affordability: { overBudget: true, shortfallPaise: 345 } }} />, manager);
  expect(screen.getByRole('button', { name: /^Approve$/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /^Reject$/ })).toBeEnabled();
});
it('requires a rejection reason and sends the trimmed reason', async () => {
  const reject = vi.spyOn(api, 'reject').mockResolvedValue({ ...proposal, status: 'REJECTED', affordability: null });
  renderWorkspace(<ReviewActions proposal={proposal} />, manager);
  await userEvent.click(screen.getByRole('button', { name: /^Reject$/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));
  expect(reject).not.toHaveBeenCalled();
  expect(screen.getByText('Enter a rejection reason.')).toBeVisible();
  await userEvent.type(screen.getByLabelText('Rejection reason'), '  Not needed  ');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));
  await waitFor(() => expect(reject).toHaveBeenCalledWith(proposal.id, 'Not needed', account.csrfToken));
});
it('refreshes after a conflicting decision and prevents blindly retrying', async () => {
  vi.spyOn(api, 'approve').mockRejectedValue(new ApiError(409, 'Already decided', 'INVALID_STATUS'));
  const { client } = renderWorkspace(<ReviewActions proposal={proposal} />, manager);
  const refresh = vi.spyOn(client, 'invalidateQueries');
  await userEvent.click(screen.getByRole('button', { name: /^Approve$/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
  expect(await screen.findByText('Already decided')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirm approval' })).toBeDisabled();
  expect(refresh).toHaveBeenCalled();
});
