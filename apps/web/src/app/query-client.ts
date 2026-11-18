import { QueryCache, MutationCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

export function createAppQueryClient() {
  let client: QueryClient;
  const handleError = (error: unknown) => {
    if (!(error instanceof ApiError) || !error.protectedRequest) return;
    if (error.status === 401) {
      void client.cancelQueries().then(() => { client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' }); client.setQueryData(['session'], null); });
    } else if (error.status === 403) void client.invalidateQueries({ queryKey: ['session'], exact: true });
  };
  client = new QueryClient({
    queryCache: new QueryCache({ onError: handleError, onSuccess: (data, query) => {
      if (query.queryKey[0] === 'session' && data === null) {
        void client.cancelQueries({ predicate: (item) => item.queryKey[0] !== 'session' }).then(() => client.removeQueries({ predicate: (item) => item.queryKey[0] !== 'session' }));
      }
    } }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: { queries: { staleTime: 20_000, retry: (count, error) => count < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500) }, mutations: { retry: false } },
  });
  return client;
}
export async function refreshProcurement(client: QueryClient) {
  await client.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'business' });
}
