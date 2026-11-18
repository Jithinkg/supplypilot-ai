import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useOutletContext } from 'react-router-dom';
import type { AuthResponse } from '@supplypilot/contracts';

export function useAccount() {
  return useOutletContext<AuthResponse>();
}
export function useDashboard() {
  const { user } = useAccount();
  return useQuery({ queryKey: ['business', user.id, 'dashboard'], queryFn: ({ signal }) => api.dashboard(signal) });
}
export function useInventory(query: { search?: string; risk?: string; page?: number; pageSize?: number }) {
  const { user } = useAccount();
  return useQuery({ queryKey: ['business', user.id, 'inventory', query], queryFn: ({ signal }) => api.inventory(query, signal) });
}
export function useProposals(query: { status?: string; page?: number; pageSize?: number }) {
  const { user } = useAccount();
  return useQuery({ queryKey: ['business', user.id, 'proposals', query], queryFn: ({ signal }) => api.proposals(query, signal) });
}
export function useProposal(id: string) {
  const { user } = useAccount();
  return useQuery({ queryKey: ['business', user.id, 'proposal', id], queryFn: ({ signal }) => api.proposal(id, signal) });
}
