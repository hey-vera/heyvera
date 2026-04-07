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
    queryFn: async () =>
      apiFetch<{ isAdmin: boolean }>('/v1/dashboard/admin-check', {
        headers: await getHeaders(),
      }),
    retry: false,
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
