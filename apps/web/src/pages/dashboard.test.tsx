import { expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardPage } from './dashboard';
import { api } from '@/lib/api';
import { dashboard, product } from '@/test/fixtures';
import { renderWorkspace } from '@/test/render';
it('renders server KPIs and filters inventory without recalculating portfolio counts', async () => {
  vi.spyOn(api, 'dashboard').mockResolvedValue(dashboard);
  const inventory = vi.spyOn(api, 'inventory').mockResolvedValue({ items: [product], total: 1, page: 1, pageSize: 10, summary: dashboard, asOf: dashboard.asOf, windowStart: '2026-10-18', windowEnd: '2026-11-16' });
  renderWorkspace(<DashboardPage />);
  expect(await screen.findByTestId('kpi-At Risk (Next 14 Days)')).toHaveTextContent('20');
  expect(screen.getByTestId('kpi-Available Budget')).toHaveTextContent('₹4,99,900.00');
  expect(await screen.findByText('Packing tape')).toBeVisible();
  expect(screen.getByLabelText('Ask the assistant')).toBeEnabled();
  await userEvent.selectOptions(screen.getByLabelText('Filter inventory risk'), 'HIGH');
  await waitFor(() => expect(inventory).toHaveBeenLastCalledWith(expect.objectContaining({ risk: 'HIGH', page: 1 }), expect.any(AbortSignal)));
  expect(screen.getByTestId('kpi-At Risk (Next 14 Days)')).toHaveTextContent('20');
});
it('keeps the dashboard usable when inventory fails and supports retry', async () => {
  vi.spyOn(api, 'dashboard').mockResolvedValue(dashboard);
  vi.spyOn(api, 'inventory').mockRejectedValue(new Error('Inventory temporarily unavailable'));
  renderWorkspace(<DashboardPage />);
  expect(await screen.findByText('Inventory temporarily unavailable')).toBeVisible();
  expect(await screen.findByTestId('kpi-Total Products')).toHaveTextContent('50');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
});
