import { useCallback, useEffect, useState } from 'react';
import { getBillingStatus, type BillingStatus } from './cortexApi';

interface UseBillingResult {
  status: BillingStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useBilling(enabled: boolean): UseBillingResult {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await getBillingStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billing is unavailable');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    if (!enabled) return undefined;
    const interval = window.setInterval(() => {
      void refresh();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [enabled, refresh]);

  return { status, loading, error, refresh };
}
