import { expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssistantResult } from '@supplypilot/contracts';
import { AssistantPanel } from './panel';
import { Evidence } from './evidence';
import { api, ApiError } from '@/lib/api';
import { account, id, product } from '@/test/fixtures';
import { renderWorkspace } from '@/test/render';
import { readPendingAssistant, savePendingAssistant } from './pending';
const result: AssistantResult = { runId: id, status: 'COMPLETED', intent: 'INVENTORY_QUERY', answer: 'Backend findings.', data: [], knowledge: [], warnings: [], createdProposalIds: [], toolCalls: 2, errorCode: null };
it('explains provider rate limits and does not automatically replay the request', async () => {
  const send = vi.spyOn(api, 'assistant').mockResolvedValue({ ...result, status: 'FAILED', errorCode: 'MODEL_HTTP_429', answer: 'The assistant request did not complete.' });
  renderWorkspace(<AssistantPanel selected={[]} />);
  await userEvent.type(screen.getByLabelText('Ask the assistant'), 'any products at risk');
  await userEvent.click(screen.getByRole('button', { name: 'Send question' }));
  expect(await screen.findByText(/The free AI provider is rate-limiting requests/)).toBeVisible();
  expect(send).toHaveBeenCalledTimes(1);
});
it('defaults to read-only, passes selected products and preserves the exact uncertain request after reload', async () => {
  const send = vi.spyOn(api, 'assistant').mockRejectedValueOnce(new ApiError(0, 'Connection interrupted')).mockResolvedValueOnce(result);
  const first = renderWorkspace(<AssistantPanel selected={[product]} />);
  await userEvent.type(screen.getByLabelText('Ask the assistant'), 'Check selected inventory');
  await userEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await screen.findByText('Connection interrupted');
  const saved = readPendingAssistant(account.user.id);
  expect(saved?.input).toEqual({ message: 'Check selected inventory', mode: 'READ_ONLY', items: [{ productId: id }] });
  expect(readPendingAssistant(crypto.randomUUID())).toBeNull();
  expect(screen.queryByRole('button', { name: 'Send question' })).not.toBeInTheDocument();
  first.unmount();
  renderWorkspace(<AssistantPanel selected={[]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Recover saved request' }));
  await screen.findByText('Backend findings.');
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  expect(readPendingAssistant(account.user.id)).toBeNull();
});
it('only grants draft permission explicitly, keeps user quantities and links committed drafts even on failure', async () => {
  const send = vi.spyOn(api, 'assistant').mockResolvedValue({ ...result, status: 'FAILED', errorCode: 'INTERRUPTED', createdProposalIds: [id] });
  renderWorkspace(<AssistantPanel selected={[product]} />);
  await userEvent.type(screen.getByLabelText('Ask the assistant'), 'Create drafts for selected products');
  await userEvent.type(screen.getByLabelText('Assistant quantity for SP-003'), '7');
  await userEvent.click(screen.getByLabelText('Allow draft proposals'));
  await userEvent.click(screen.getByRole('button', { name: 'Send question' }));
  expect(await screen.findByRole('link', { name: 'Open draft proposal 1' })).toHaveAttribute('href', `/proposals/${id}`);
  expect(send).toHaveBeenCalledWith({ message: 'Create drafts for selected products', mode: 'CREATE_DRAFT', items: [{ productId: id, quantity: 7 }] }, account.csrfToken, expect.any(String));
  expect(screen.getByLabelText('Allow draft proposals')).not.toBeChecked();
});
it('recovers a known run by GET without replaying a write', async () => {
  savePendingAssistant({ userId: account.user.id, role: 'STAFF', key: 'saved-run-key', runId: id, input: { message: 'Create drafts', mode: 'CREATE_DRAFT' } });
  const get = vi.spyOn(api, 'assistantRun').mockResolvedValue(result);
  const send = vi.spyOn(api, 'assistant');
  renderWorkspace(<AssistantPanel selected={[]} />);
  await screen.findByText('Backend findings.');
  expect(get).toHaveBeenCalledWith(id, expect.any(AbortSignal));
  expect(send).not.toHaveBeenCalled();
});
it('handles RUNNING responses by retrieving the owned run instead of starting another request', async () => {
  const send = vi.spyOn(api, 'assistant').mockResolvedValue({ ...result, status: 'RUNNING' });
  const get = vi.spyOn(api, 'assistantRun').mockResolvedValue(result);
  renderWorkspace(<AssistantPanel selected={[]} />);
  await userEvent.type(screen.getByLabelText('Ask the assistant'), 'Check budget');
  await userEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await screen.findByText('Backend findings.');
  expect(send).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1);
});
it('does not send anything if recovery storage is unavailable', async () => {
  const send = vi.spyOn(api, 'assistant');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  renderWorkspace(<AssistantPanel selected={[]} />);
  await userEvent.type(screen.getByLabelText('Ask the assistant'), 'Check budget');
  await userEvent.click(screen.getByRole('button', { name: 'Send question' }));
  expect(await screen.findByText(/Enable session storage/)).toBeVisible();
  expect(send).not.toHaveBeenCalled();
});
it('rechecks citations with the supplier scope and never renders denied source text', async () => {
  const citation = { documentId: id, chunkId: id, pageNumber: 2, supportingText: 'SECRET-CONTRACT-EXCERPT' };
  const resolve = vi.spyOn(api, 'citation').mockRejectedValue(new ApiError(404, 'Citation is unavailable.'));
  const manager = { ...account, user: { ...account.user, role: 'MANAGER' as const } };
  renderWorkspace(<Evidence result={{ outcome: 'EVIDENCE_FOUND', advisory: true, findings: 'Advisory only', scope: { type: 'SUPPLIER_CONTRACT', supplierId: id }, citations: [citation] }} />, manager);
  expect(screen.queryByText(citation.supportingText)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'View source 1 · page 2' }));
  await screen.findByText('Citation is unavailable.');
  expect(resolve).toHaveBeenCalledWith(citation, account.csrfToken, id);
  expect(screen.queryByText(citation.supportingText)).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Download source/ })).not.toBeInTheDocument();
});
it('suppresses manager contract findings and sources for staff', () => {
  renderWorkspace(<Evidence result={{ outcome: 'EVIDENCE_FOUND', advisory: true, findings: 'SECRET-MANAGER-FINDING', scope: { type: 'SUPPLIER_CONTRACT', supplierId: id }, citations: [{ documentId: id, chunkId: id, pageNumber: 1, supportingText: 'SECRET' }] }} />);
  expect(screen.queryByText('SECRET-MANAGER-FINDING')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /View source/ })).not.toBeInTheDocument();
});
it('renders injected markup as text without executing it', async () => {
  vi.spyOn(api, 'assistant').mockResolvedValue({ ...result, answer: '<img src=x onerror=alert(1)>', warnings: ['<script>steal()</script>'] });
  const { container } = renderWorkspace(<AssistantPanel selected={[]} />);
  await userEvent.type(screen.getByLabelText('Ask the assistant'), 'Check budget');
  await userEvent.click(screen.getByRole('button', { name: 'Send question' }));
  await waitFor(() => expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible());
  expect(container.querySelector('img, script')).toBeNull();
});
