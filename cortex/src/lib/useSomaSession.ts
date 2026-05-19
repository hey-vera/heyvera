import { useEffect, useRef, useState } from 'react';
import { createSomaSession, type SomaSession } from './cortexApi';

const STORAGE_PREFIX = 'cortex:soma-session:';

interface SomaSessionState {
  session: SomaSession | null;
  loading: boolean;
  error: string | null;
  userDid: string | null;
}

function getStoredSession(userId: string): SomaSession | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (!raw) return null;
    const session = JSON.parse(raw) as SomaSession;
    // Check if delegation has expired
    const expiresAt = session.delegation.issued_at + 24 * 3600 * 1000;
    if (Date.now() > expiresAt) {
      localStorage.removeItem(`${STORAGE_PREFIX}${userId}`);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function storeSession(userId: string, session: SomaSession) {
  localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(session));
}

export function useSomaSession(userId: string, isSignedIn: boolean): SomaSessionState {
  const [state, setState] = useState<SomaSessionState>({
    session: null,
    loading: false,
    error: null,
    userDid: null,
  });
  const requested = useRef(false);

  useEffect(() => {
    if (!isSignedIn || !userId || userId === 'local' || userId === 'anonymous') return;
    if (requested.current) return;

    // Check for cached session first
    const cached = getStoredSession(userId);
    if (cached) {
      setState({
        session: cached,
        loading: false,
        error: null,
        userDid: cached.user_identity.did,
      });
      return;
    }

    requested.current = true;
    setState((s) => ({ ...s, loading: true }));

    createSomaSession()
      .then((session) => {
        storeSession(userId, session);
        setState({
          session,
          loading: false,
          error: null,
          userDid: session.user_identity.did,
        });
      })
      .catch((err) => {
        setState({
          session: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to create Soma session',
          userDid: null,
        });
        requested.current = false;
      });
  }, [userId, isSignedIn]);

  return state;
}
