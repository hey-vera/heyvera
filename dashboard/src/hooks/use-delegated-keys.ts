import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '../lib/api';

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}` };
  };
}

export interface DelegatedKey {
  maskedKey: string;
  label: string | null;
  credits: number;
  maxCredits: number | null;
  creditsDelegated: number;
  allowedEndpoints: string[] | null;
  expiresAt: string | null;
  rateLimitRpm: number | null;
  delegationDepth: number;
  active: boolean;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ChildrenResponse {
  children: DelegatedKey[];
  parentKey: string;
  creditsDelegated: number;
}

export function useDelegatedKeys() {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ['delegated-keys'],
    queryFn: async () =>
      apiFetch<ChildrenResponse>('/v1/dashboard/keys/children', {
        headers: await getHeaders(),
      }),
  });
}

export function useCreateDelegatedKey() {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      label?: string;
      maxCredits?: number;
      allowedEndpoints?: string[];
      expiresAt?: string;
      rateLimitRpm?: number;
    }) =>
      apiFetch<{ ok: boolean; apiKey: string; message: string }>('/v1/dashboard/keys/delegate', {
        headers: await getHeaders(),
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delegated-keys'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
    },
  });
}

export function useRevokeDelegatedKey() {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (maskedKey: string) =>
      apiFetch<{ ok: boolean; revoked: number; message: string }>('/v1/dashboard/keys/revoke', {
        headers: await getHeaders(),
        method: 'POST',
        body: JSON.stringify({ maskedKey }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delegated-keys'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
    },
  });
}
