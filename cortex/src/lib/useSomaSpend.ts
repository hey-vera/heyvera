import { useEffect, useState } from 'react';
import {
  getSomaDelegationSpend,
  getSomaSpend,
  type SomaDelegationSpend,
  type SomaSpendSummary,
} from './cortexApi';

export function useSomaSpend() {
  const [data, setData] = useState<SomaSpendSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSomaSpend()
      .then((summary) => {
        if (!cancelled) {
          setData(summary);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load spend');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}

export function useSomaDelegationSpend(delegationId: string | null) {
  const [data, setData] = useState<SomaDelegationSpend | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!delegationId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getSomaDelegationSpend(delegationId)
      .then((detail) => {
        if (!cancelled) {
          setData(detail);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load receipts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [delegationId]);

  return { data, loading, error };
}
