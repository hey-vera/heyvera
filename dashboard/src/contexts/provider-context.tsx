import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Provider } from '../lib/types';

interface ProviderContextValue {
  provider: Provider | null;
  apiKey: string | null;
  isLoading: boolean;
  error: string | null;
  connect: (apiKey: string) => Promise<void>;
  disconnect: () => void;
}

const ProviderContext = createContext<ProviderContextValue | null>(null);

export function useProvider() {
  const ctx = useContext(ProviderContext);
  if (!ctx) throw new Error('useProvider must be used within ProviderProvider');
  return ctx;
}

const STORAGE_KEY = 'clawnet_provider_key';

function getStoredKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ProviderProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState<string | null>(getStoredKey);
  const queryClient = useQueryClient();

  const {
    data: provider,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['provider', 'me', apiKey],
    queryFn: () =>
      apiFetch<Provider>('/v1/providers/me', { apiKey: apiKey! }),
    enabled: !!apiKey,
    retry: false,
  });

  const connect = useCallback(
    async (key: string) => {
      const prov = await apiFetch<Provider>('/v1/providers/me', {
        apiKey: key,
      });
      if (!prov?.id) throw new Error('Invalid API key');
      localStorage.setItem(STORAGE_KEY, key);
      setApiKey(key);
      queryClient.setQueryData(['provider', 'me', key], prov);
    },
    [queryClient],
  );

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setApiKey(null);
    queryClient.clear();
  }, [queryClient]);

  return (
    <ProviderContext.Provider
      value={{
        provider: provider ?? null,
        apiKey,
        isLoading,
        error: error ? (error as Error).message : null,
        connect,
        disconnect,
      }}
    >
      {children}
    </ProviderContext.Provider>
  );
}
