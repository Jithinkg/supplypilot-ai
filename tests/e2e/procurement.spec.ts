import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { dashboardSchema, proposalDetailSchema, proposalListSchema } from '@supplypilot/contracts';
async function login(page: Page, role: 'STAFF' | 'MANAGER') {
  const email = process.env[`SEED_${role}_EMAIL`];
  const password = process.env[`SEED_${role}_PASSWORD`];
  if (!email || !password) throw new Error('Isolated test credentials are missing.');
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByTestId('kpi-Total Products')).toHaveText('50');
}
async function create(page: Page, reason: string, quantity = 10) {
  await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
  await page.getByLabel('Find products', { exact: true }).fill('SP-003');
  await page.getByLabel('Select SP-003', { exact: true }).check();
  await page.getByLabel('Quantity for SP-003 (optional)', { exact: true }).fill(String(quantity));
  await page.getByLabel('Purchase reason', { exact: true }).fill(reason);
  await page.getByRole('button', { name: 'Create drafts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Proposal request complete' })).toBeVisible();
  const link = page.getByRole('link', { name: /View proposal/ }).first();
  const href = await link.getAttribute('href');
  if (!href) throw new Error('Created proposal link missing');
  await link.click();
  await expect(page.getByRole('heading', { name: 'Products in this proposal' })).toBeVisible();
  await expect(page.getByText('SP-003', { exact: true }).first()).toBeVisible();
  return href;
}
test('staff creates; manager approves, rejects and creates over-budget drafts', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, 'STAFF');
  await expect(page.getByText('At Risk (Next 14 Days)', { exact: true })).toBeVisible();
  await expect(page.getByText('Stockout Within 7 Days:', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Ask the assistant')).toBeEnabled();
  await page.getByLabel('Filter inventory risk').selectOption('HIGH');
  await expect(page).toHaveURL(/risk=HIGH/);
  await page.screenshot({ path: '.cache/day4-dashboard.png', fullPage: true });
  const path = await create(page, 'Browser staff procurement');
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect(page.getByText(/A manager must review/)).toBeVisible();
  await page.getByRole('button', { name: 'Compare current quotes' }).click();
  await expect(page.getByText(/Current alternatives for this quantity/)).toBeVisible();
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await login(manager, 'MANAGER');
  const before = dashboardSchema.parse(await (await manager.request.get('/api/dashboard')).json());
  await manager.goto(path);
  const draft = proposalDetailSchema.parse(await (await manager.request.get(`/api${path}`)).json());
  await manager.getByRole('button', { name: 'Approve', exact: true }).click();
  await manager.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(manager.getByText('APPROVED', { exact: true })).toBeVisible();
  const after = dashboardSchema.parse(await (await manager.request.get('/api/dashboard')).json());
  expect(after.availableBudgetPaise).toBe(before.availableBudgetPaise - draft.totalPaise);
  await manager.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(manager.getByTestId('kpi-Pending Proposals')).toHaveText(String(after.pendingProposals));
  await manager.getByRole('link', { name: 'Proposals', exact: true }).click();
  await create(manager, 'Browser manager rejection');
  await manager.getByRole('button', { name: 'Reject', exact: true }).click();
  await manager.getByLabel('Rejection reason').fill('Not needed for this cycle');
  await manager.getByRole('button', { name: 'Confirm rejection' }).click();
  await expect(manager.getByText('REJECTED', { exact: true })).toBeVisible();
  await expect(manager.getByText('Not needed for this cycle')).toBeVisible();
  await manager.getByRole('link', { name: 'Proposals', exact: true }).click();
  await create(manager, 'Browser over budget', 10000);
  await expect(manager.getByText(/Insufficient available funds/)).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  await manager.setViewportSize({ width: 390, height: 844 });
  await manager.screenshot({ path: '.cache/day4-proposal-mobile.png', fullPage: true });
  expect(await manager.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await managerContext.close();
  await page.context().clearCookies();
  await page.getByRole('button', { name: 'Refresh proposal' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});
test('lost POST response recovers after reload with the same key and one committed draft', async ({ page }) => {
  await login(page, 'STAFF');
  await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
  await page.getByLabel('Find products', { exact: true }).fill('SP-003');
  await page.getByLabel('Select SP-003', { exact: true }).check();
  await page.getByLabel('Quantity for SP-003 (optional)').fill('2');
  await page.getByLabel('Purchase reason', { exact: true }).fill('Browser recovery request');
  let originalKey: string | undefined;
  await page.route('**/api/proposals', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    originalKey = route.request().headers()['idempotency-key'];
    await route.fetch(); // Commit on the isolated server, then lose the response.
    await route.abort('connectionreset');
  });
  await page.getByRole('button', { name: 'Create drafts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry saved request' })).toBeVisible();
  await page.unroute('**/api/proposals');
  await page.reload();
  await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
  const request = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/api/proposals'));
  await page.getByRole('button', { name: 'Retry saved request' }).click();
  expect((await request).headers()['idempotency-key']).toBe(originalKey);
  await expect(page.getByRole('heading', { name: 'Proposal request complete' })).toBeVisible();
  const list = proposalListSchema.parse(await (await page.request.get('/api/proposals?pageSize=100')).json());
  expect(list.items.filter((item) => item.reason === 'Browser recovery request')).toHaveLength(1);
});
test('inventory failure leaves KPI cards usable and can be retried', async ({ page }) => {
  await page.route('**/api/inventory/risks**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEMPORARY', message: 'Inventory unavailable' } }) }));
  await login(page, 'STAFF');
  await expect(page.getByText('Inventory unavailable')).toBeVisible();
  await expect(page.getByTestId('kpi-Total Products')).toHaveText('50');
  await page.unroute('**/api/inventory/risks**');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('table').first()).toBeVisible();
  await expect(page.getByText('Inventory unavailable')).toHaveCount(0);
});

test('Vite does not expose private runtime caches or database backup artifacts', async ({ request }) => {
  const privatePath = fileURLToPath(new URL('../../.cache/embeddings/preflight-profile.json', import.meta.url));
  expect((await request.get(`/@fs${privatePath}`)).status()).toBe(403);
});
