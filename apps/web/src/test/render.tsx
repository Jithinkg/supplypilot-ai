import type { ReactNode } from 'react';
import type { AuthResponse } from '@supplypilot/contracts';
import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { createAppQueryClient } from '@/app/query-client';
import { account } from './fixtures';
export function renderWorkspace(ui: ReactNode, identity: AuthResponse = account) {
  const client = createAppQueryClient();
  client.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  client.setQueryData(['session'], identity);
  const result = render(<QueryClientProvider client={client}><MemoryRouter><Routes><Route element={<Outlet context={identity} />}><Route path="*" element={ui} /></Route></Routes></MemoryRouter></QueryClientProvider>);
  return { ...result, client };
}
