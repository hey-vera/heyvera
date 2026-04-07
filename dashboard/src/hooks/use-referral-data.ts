import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '../lib/api';
import type { ReferralInfo } from '../lib/types';

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}` };
  };
}

export function useReferralCode() {
  const getHeaders = useAuthHeaders();
  return useQuery({
    queryKey: ['referral', 'my-code'],
    queryFn: async () =>
      apiFetch<ReferralInfo>('/v1/referral/my-code', {
        headers: await getHeaders(),
      }),
    retry: false,
  });
}

export function useApplyReferral() {
  const getHeaders = useAuthHeaders();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) =>
      apiFetch<{ ok: boolean; creditsAdded: number; message: string }>(
        '/v1/referral/apply',
        {
          headers: await getHeaders(),
          method: 'POST',
          body: JSON.stringify({ code }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard', 'me'] });
    },
  });
}
