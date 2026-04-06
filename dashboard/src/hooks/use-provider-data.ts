import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

function useApiKey() {
  const { apiKey } = useProvider();
  return apiKey!;
}

function useProviderId() {
  const { provider } = useProvider();
  return provider!.id;
}

// --- Stats ---
export function useProviderStats() {
  const key = useApiKey();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'stats'],
    queryFn: () =>
      apiFetch<ProviderStats>(`/v1/providers/${id}/stats`, { apiKey: key }),
  });
}

// --- Analytics (daily breakdown) ---
export function useProviderAnalytics(days = 30) {
  const key = useApiKey();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'analytics', days],
    queryFn: () =>
      apiFetch<{ stats: ProviderStats; analytics: AnalyticsRow[] }>(
        `/v1/providers/${id}/analytics?days=${days}`,
        { apiKey: key },
      ),
  });
}

// --- Endpoints ---
export function useProviderEndpoints() {
  const key = useApiKey();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'endpoints'],
    queryFn: () =>
      apiFetch<ProviderEndpoint[]>(`/v1/providers/${id}/endpoints`, {
        apiKey: key,
      }),
  });
}

export function useSubmitEndpoint() {
  const key = useApiKey();
  const id = useProviderId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
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
        apiKey: key,
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider', id, 'endpoints'] });
    },
  });
}

export function useUpdateEndpoint() {
  const key = useApiKey();
  const id = useProviderId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      endpointId,
      ...data
    }: { endpointId: string } & Record<string, unknown>) =>
      apiFetch(`/v1/providers/${id}/endpoints/${endpointId}`, {
        apiKey: key,
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider', id, 'endpoints'] });
    },
  });
}

export function useDeleteEndpoint() {
  const key = useApiKey();
  const id = useProviderId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (endpointId: string) =>
      apiFetch(`/v1/providers/${id}/endpoints/${endpointId}`, {
        apiKey: key,
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider', id, 'endpoints'] });
    },
  });
}

// --- Soma Check Earnings ---
export function useSomaCheckEarnings(window: 'day' | 'week' | 'month' = 'week') {
  const key = useApiKey();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'soma-check', window],
    queryFn: () =>
      apiFetch<SomaCheckEarnings>(
        `/v1/providers/${id}/soma-check?window=${window}`,
        { apiKey: key },
      ),
  });
}

// --- Revenue ---
export function useProviderRevenue() {
  const key = useApiKey();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'revenue'],
    queryFn: () =>
      apiFetch<RevenueData>(`/v1/providers/${id}/revenue`, { apiKey: key }),
  });
}

// --- Withdrawals ---
export function useProviderWithdrawals() {
  const key = useApiKey();
  const id = useProviderId();
  return useQuery({
    queryKey: ['provider', id, 'withdrawals'],
    queryFn: () =>
      apiFetch<WithdrawalsResponse>(`/v1/providers/${id}/withdrawals`, {
        apiKey: key,
      }),
  });
}

export function useRequestWithdrawal() {
  const key = useApiKey();
  const id = useProviderId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountCredits: number) =>
      apiFetch(`/v1/providers/${id}/withdraw`, {
        apiKey: key,
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
  const key = useApiKey();
  const id = useProviderId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (wallet: string) =>
      apiFetch(`/v1/providers/${id}/payout-wallet`, {
        apiKey: key,
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
  const key = useApiKey();
  const id = useProviderId();
  return useMutation({
    mutationFn: (endpointId: string) =>
      apiFetch(`/v1/providers/${id}/endpoints/${endpointId}/invalidate`, {
        apiKey: key,
        method: 'POST',
        body: JSON.stringify({}),
      }),
  });
}
