import { Clock3, Fingerprint } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSomaSession } from '../lib/useSomaSession';
import type { SomaSession } from '../lib/cortexApi';

interface SomaIdentityBadgeProps {
  userId: string;
  isSignedIn: boolean;
}

function shortDid(did: string) {
  if (did.length <= 24) return did;
  return `${did.slice(0, 13)}...${did.slice(-6)}`;
}

function getExpiry(session: SomaSession | null): number | null {
  const caveat = session?.delegation.caveats?.find((item) => item.type === 'expires_at');
  return typeof caveat?.timestamp === 'number' ? caveat.timestamp : null;
}

function formatCountdown(expiresAt: number | null, now: number) {
  if (!expiresAt) return '24h session';
  const remaining = Math.max(expiresAt - now, 0);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

export default function SomaIdentityBadge({ userId, isSignedIn }: SomaIdentityBadgeProps) {
  const { session, userDid, loading, error } = useSomaSession(userId, isSignedIn);
  const [now, setNow] = useState(0);
  const expiresAt = useMemo(() => getExpiry(session), [session]);
  const active = Boolean(session && (!expiresAt || expiresAt > now));

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!isSignedIn || userId === 'local') {
    return null;
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          <Fingerprint className="h-3.5 w-3.5 text-[var(--accent)]" />
          Identity
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
          <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-300' : 'bg-white/25'}`} />
          {active ? 'delegated' : loading ? 'creating' : 'inactive'}
        </span>
      </div>
      <p className="truncate font-mono text-[11px] text-[var(--muted-strong)]" title={userDid ?? undefined}>
        {userDid ? shortDid(userDid) : loading ? 'Preparing identity...' : 'Identity unavailable'}
      </p>
      <p className="mt-1 inline-flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
        <Clock3 className="h-3 w-3" />
        {error ? 'Delegation unavailable' : formatCountdown(expiresAt, now)}
      </p>
    </div>
  );
}
