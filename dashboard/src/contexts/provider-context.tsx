import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { apiFetch } from '../lib/api';
import type { Provider } from '../lib/types';

interface ProviderContextValue {
  provider: Provider | null;
  isLoading: boolean;
  error: string | null;
}

const ProviderContext = createContext<ProviderContextValue | null>(null);

export function useProvider() {
  const ctx = useContext(ProviderContext);
  if (!ctx) throw new Error('useProvider must be used within ProviderProvider');
  return ctx;
}

export function ProviderProvider({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn, isLoaded } = useAuth();

  const {
    data: provider,
    isLoading: queryLoading,
    error,
  } = useQuery({
    queryKey: ['provider', 'me'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<Provider>('/v1/providers/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    enabled: isLoaded && !!isSignedIn,
    retry: false,
  });

  const isLoading = !isLoaded || (isSignedIn && queryLoading);

  return (
    <ProviderContext.Provider
      value={{
        provider: provider ?? null,
        isLoading,
        error: error ? (error as Error).message : null,
      }}
    >
      {children}
    </ProviderContext.Provider>
  );
}
