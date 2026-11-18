import { expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { createAppQueryClient } from './query-client';
import { account } from '@/test/fixtures';
it('clears protected cached data and ends the session on a protected 401', async () => {
  const client = createAppQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  client.setQueryData(['session'], account);
  client.setQueryData(['business', account.user.id, 'proposals'], { confidential: true });
  await expect(client.fetchQuery({ queryKey: ['business', account.user.id, 'dashboard'], queryFn: () => { throw new ApiError(401, 'Session expired'); } })).rejects.toThrow();
  await waitFor(() => expect(client.getQueryData(['session'])).toBeNull());
  expect(client.getQueryCache().findAll({ queryKey: ['business'] })).toHaveLength(0);
  client.clear();
});
