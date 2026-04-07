import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '../lib/api';
import type { AdminStats, AdminLogs } from '../lib/types';

export interface AdminProvider {
  id: string;
  name: string;
  slug: string;
  email: string;
  status: string;
  tier: string;
  websiteUrl?: string;
  createdAt: string;
}

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}` };
  };
}

export function useAdminCheck() {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ['admin', 'check'],
    queryFn: async () => {
      try {
        return await apiFetch<{ isAdmin: boolean }>('/v1/dashboard/admin-check', {
          headers: await getHeaders(),
        });
      } catch {
        // Don't crash — just return not-admin
        return { isAdmin: false };
      }
    },
    retry: false,
    staleTime: 5 * 60_000, // Cache admin check for 5 min to reduce flicker on navigation
  });
}

export function useAdminStats(period: 'week' | 'month' = 'week') {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ['admin', 'stats', period],
    queryFn: async () =>
      apiFetch<AdminStats>(`/v1/dashboard/admin-stats?period=${period}`, {
        headers: await getHeaders(),
      }),
  });
}

export function useAdminLogs(period: 'week' | 'month' = 'week') {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ['admin', 'logs', period],
    queryFn: async () =>
      apiFetch<AdminLogs>(`/v1/dashboard/admin-logs?period=${period}`, {
        headers: await getHeaders(),
      }),
  });
}

export function useAdminProviders(status?: string) {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ['admin', 'providers', status],
    queryFn: async () =>
      apiFetch<{ providers: AdminProvider[] }>(
        `/v1/dashboard/admin-providers${status ? `?status=${status}` : ''}`,
        { headers: await getHeaders() },
      ),
  });
}

export function useActivateProvider() {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (providerId: string) =>
      apiFetch<{ ok: boolean }>(`/v1/dashboard/admin-providers/${providerId}/activate`, {
        headers: await getHeaders(),
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'providers'] });
    },
  });
}
