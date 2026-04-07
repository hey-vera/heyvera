import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '../lib/api';
import type { AdminStats, AdminLogs } from '../lib/types';

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
