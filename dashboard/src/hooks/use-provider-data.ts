import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '../lib/api';
import { useProvider } from '../contexts/provider-context';
import type {
  ProviderStats,
  AnalyticsRow,
  ProviderEndpoint,
  SomaCheckEarnings,
  RevenueData,
  WithdrawalsResponse,
} from '../lib/types';

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}` };
  };
}

function useProviderId() {
  const { provider } = useProvider();
  return provider!.id;
}

// --- Stats ---
export function useProviderStats() {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'stats'],
    queryFn: async () =>
      apiFetch<ProviderStats>(`/v1/providers/${id}/stats`, {
        headers: await getHeaders(),
      }),
  });
}

// --- Analytics (daily breakdown) ---
export function useProviderAnalytics(days = 30) {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'analytics', days],
    queryFn: async () =>
      apiFetch<{ stats: ProviderStats; analytics: AnalyticsRow[] }>(
        `/v1/providers/${id}/analytics?days=${days}`,
        { headers: await getHeaders() },
      ),
  });
}

// --- Endpoints ---
export function useProviderEndpoints() {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'endpoints'],
    queryFn: async () =>
      apiFetch<ProviderEndpoint[]>(`/v1/providers/${id}/endpoints`, {
        headers: await getHeaders(),
      }),
  });
}

export function useSubmitEndpoint() {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      category: string;
      baseUrl: string;
      path: string;
      httpMethod: string;
      creditCost: number;
      cacheTtl?: number;
    }) =>
      apiFetch(`/v1/providers/${id}/endpoints/submit`, {
        headers: await getHeaders(),
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider', id, 'endpoints'] });
    },
  });
}

export function useUpdateEndpoint() {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      endpointId,
      ...data
    }: { endpointId: string } & Record<string, unknown>) =>
      apiFetch(`/v1/providers/${id}/endpoints/${endpointId}`, {
        headers: await getHeaders(),
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider', id, 'endpoints'] });
    },
  });
}

export function useDeleteEndpoint() {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (endpointId: string) =>
      apiFetch(`/v1/providers/${id}/endpoints/${endpointId}`, {
        headers: await getHeaders(),
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider', id, 'endpoints'] });
    },
  });
}

// --- Soma Check Earnings ---
export function useSomaCheckEarnings(window: 'day' | 'week' | 'month' = 'week') {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'soma-check', window],
    queryFn: async () =>
      apiFetch<SomaCheckEarnings>(
        `/v1/providers/${id}/soma-check?window=${window}`,
        { headers: await getHeaders() },
      ),
  });
}

// --- Revenue ---
export function useProviderRevenue() {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'revenue'],
    queryFn: async () =>
      apiFetch<RevenueData>(`/v1/providers/${id}/revenue`, {
        headers: await getHeaders(),
      }),
  });
}

// --- Withdrawals ---
export function useProviderWithdrawals() {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'withdrawals'],
    queryFn: async () =>
      apiFetch<WithdrawalsResponse>(`/v1/providers/${id}/withdrawals`, {
        headers: await getHeaders(),
      }),
  });
}

export function useRequestWithdrawal() {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (amountCredits: number) =>
      apiFetch(`/v1/providers/${id}/withdraw`, {
        headers: await getHeaders(),
        method: 'POST',
        body: JSON.stringify({ amountCredits }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider', id, 'withdrawals'] });
      qc.invalidateQueries({ queryKey: ['provider', id, 'stats'] });
    },
  });
}

// --- Payout Wallet ---
export function useSetPayoutWallet() {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (wallet: string) =>
      apiFetch(`/v1/providers/${id}/payout-wallet`, {
        headers: await getHeaders(),
        method: 'PATCH',
        body: JSON.stringify({ wallet }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider', 'me'] });
      qc.invalidateQueries({ queryKey: ['provider', id, 'withdrawals'] });
    },
  });
}

// --- Cache Invalidation ---
export function useInvalidateCache() {
  const getHeaders = useAuthHeaders();
  const id = useProviderId();
  return useMutation({
    mutationFn: async (endpointId: string) =>
      apiFetch(`/v1/providers/${id}/endpoints/${endpointId}/invalidate`, {
        headers: await getHeaders(),
        method: 'POST',
        body: JSON.stringify({}),
      }),
  });
}
