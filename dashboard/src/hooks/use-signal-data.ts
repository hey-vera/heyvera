import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '../lib/api';
import type { SignalDetail } from '../lib/types';

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}` };
  };
}

export function useSignalDetail() {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ['signal', 'detail'],
    queryFn: async () =>
      apiFetch<SignalDetail>('/v1/dashboard/signal', {
        headers: await getHeaders(),
      }),
    retry: false,
  });
}

export function useVaultLock() {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { credits: number; lockDays: 30 | 90 | 180 }) =>
      apiFetch<{ ok: boolean; vault: { id: string; creditsLocked: number; lockDays: number; multiplier: number; unlocksAt: string }; message: string }>(
        '/v1/dashboard/vault/lock',
        {
          headers: await getHeaders(),
          method: 'POST',
          body: JSON.stringify(params),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['signal'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
    },
  });
}

export function useVaultUnlock() {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lockId: string) =>
      apiFetch<{ ok: boolean }>(`/v1/dashboard/vault/${lockId}/unlock`, {
        headers: await getHeaders(),
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['signal'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
    },
  });
}
