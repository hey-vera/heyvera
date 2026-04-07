import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '../lib/api';
import type { DashboardMe, TaskRow, UsageBreakdown, SomaReceipt } from '../lib/types';

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}` };
  };
}

// --- Dashboard /me (credits, key, stats, cache, signal) ---
export function useDashboardMe() {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ['dashboard', 'me'],
    queryFn: async () =>
      apiFetch<DashboardMe>('/v1/dashboard/me', { headers: await getHeaders() }),
  });
}

// --- Reveal API key (one-time) ---
export function useRevealKey() {
  const getHeaders = useAuthHeaders();
  return useMutation({
    mutationFn: async () =>
      apiFetch<{ apiKey: string }>('/v1/dashboard/reveal-key', {
        headers: await getHeaders(),
        method: 'POST',
      }),
  });
}

// --- Regenerate API key ---
export function useRegenerateKey() {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      apiFetch<{ apiKey: string; credits: number }>('/v1/dashboard/regenerate-key', {
        headers: await getHeaders(),
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
    },
  });
}

// --- Task history ---
export function useTaskHistory(limit = 10) {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ['tasks', limit],
    queryFn: async () =>
      apiFetch<{ tasks: TaskRow[] }>(`/v1/tasks?limit=${limit}`, {
        headers: await getHeaders(),
      }),
  });
}

// --- Usage breakdown ---
export function useUsageBreakdown() {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ['usage'],
    queryFn: async () =>
      apiFetch<UsageBreakdown>('/v1/auth/usage', { headers: await getHeaders() }),
  });
}

// --- Soma receipts ---
export function useReceipts(offset = 0, limit = 50) {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ['receipts', offset],
    queryFn: async () =>
      apiFetch<{ receipts: SomaReceipt[]; total: number }>(
        `/v1/account/soma-receipts?limit=${limit}&offset=${offset}`,
        { headers: await getHeaders() },
      ),
  });
}

// --- Billing checkout (Stripe) ---
export function useCreateCheckout() {
  const getHeaders = useAuthHeaders();
  return useMutation({
    mutationFn: async (amountUsd: number) =>
      apiFetch<{ url: string }>('/v1/billing/checkout', {
        headers: await getHeaders(),
        method: 'POST',
        body: JSON.stringify({ amount: amountUsd }),
      }),
  });
}

// --- Billing portal (Stripe) ---
export function useBillingPortal() {
  const getHeaders = useAuthHeaders();
  return useMutation({
    mutationFn: async () =>
      apiFetch<{ url: string }>('/v1/dashboard/billing-portal', {
        headers: await getHeaders(),
        method: 'POST',
      }),
  });
}

// --- Health check ---
export function useHealthCheck() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<{ status: string }>('/health'),
    refetchInterval: 60_000,
    retry: false,
  });
}
