import { useState, useEffect, useRef } from 'react';
import type { CortexState } from '../types';

const EMPTY_STATE: CortexState = {
  providers: null,
  routing: null,
  rooms: null,
  decisions: [],
  outcomes: [],
  costs: null,
  lastUpdated: null,
};

export function useCortexState(pollMs = 3000): CortexState {
  const [state, setState] = useState<CortexState>(EMPTY_STATE);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/cortex/state');
        if (res.ok) {
          const data = await res.json();
          setState({ ...data, lastUpdated: new Date().toISOString() });
        }
      } catch {
        // server not available yet
      }
    }

    poll();
    timer.current = setInterval(poll, pollMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [pollMs]);

  return state;
}
