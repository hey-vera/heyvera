import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { SignInButton } from '@clerk/clerk-react';
import { redeemCommunityInvite } from '../api/social';
import type { Community } from '../api/social';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { useAuth } from '../hooks/useAuth';
import { communitiesListPath } from '../utils/guildVisibility';

/**
 * Redeem a private guild invite token (`/invite/:token`).
 * Hits POST /v1/social/invites/{token}/redeem — no open private join.
 */
export function InviteRedeemPage() {
  const { token: inviteToken } = useParams<{ token: string }>();
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<boolean | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function redeem() {
      if (!inviteToken?.trim()) {
        setStatus('error');
        setError('Missing invite token.');
        return;
      }
      if (!authEnabled) {
        setStatus('error');
        setError('Sign-in is not configured for this environment.');
        return;
      }
      if (!isSignedIn) {
        setStatus('idle');
        setError(null);
        return;
      }

      setStatus('loading');
      setError(null);
      try {
        const authToken = await getToken();
        if (!authToken) {
          if (!cancelled) {
            setStatus('error');
            setError('Unable to get auth token. Try signing in again.');
          }
          return;
        }
        const result = await redeemCommunityInvite(authToken, inviteToken.trim());
        if (cancelled) return;
        setJoined(result.joined ?? true);
        setCommunity(result.community ?? null);
        setStatus('ok');
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Invite redeem failed');
        }
      }
    }

    void redeem();
    return () => {
      cancelled = true;
    };
  }, [inviteToken, authEnabled, isSignedIn, getToken]);

  return (
    <div className="min-h-screen px-4 py-8" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="mx-auto max-w-lg">
        <h1 className="text-[20px] font-bold">Guild invite</h1>
        <p className="mt-2 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
          Private communities require a real invite. Open join by slug is closed.
        </p>

        {!inviteToken?.trim() && (
          <div className="mt-6">
            <ErrorState title="Invalid invite" detail="This link is missing a token." />
          </div>
        )}

        {inviteToken?.trim() && authEnabled && !isSignedIn && (
          <div className="mt-6 rounded-2xl border p-6" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
            <EmptyState
              title="Sign in to join"
              detail="Redeeming an invite uses your signed-in profile membership."
            />
            <div className="mt-4 flex justify-center">
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="rounded-full px-5 py-2 text-[14px] font-bold transition-opacity hover:opacity-90"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
                >
                  Sign in
                </button>
              </SignInButton>
            </div>
          </div>
        )}

        {status === 'loading' && <LoadingState label="Redeeming invite" />}

        {status === 'error' && error && (
          <div className="mt-6">
            <ErrorState title="Could not redeem invite" detail={error} />
            <p className="mt-4 text-center text-[13px]">
              <Link to={communitiesListPath()} className="font-semibold underline-offset-2 hover:underline" style={{ color: 'var(--accent)' }}>
                Back to Communities
              </Link>
            </p>
          </div>
        )}

        {status === 'ok' && (
          <div
            className="mt-6 rounded-2xl border p-6"
            style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
            role="status"
          >
            <h2 className="text-[17px] font-bold">
              {joined ? 'You joined' : 'Already a member'}
            </h2>
            {community && (
              <p className="mt-2 text-[15px]">
                <span className="font-semibold">{community.name}</span>
                {community.slug ? (
                  <span style={{ color: 'var(--text-secondary)' }}> · {community.slug}</span>
                ) : null}
              </p>
            )}
            <p className="mt-3 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Membership is real — open the community feed from Communities.
            </p>
            <div className="mt-4">
              <Link
                to={communitiesListPath()}
                className="inline-flex rounded-full px-5 py-2 text-[14px] font-bold transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
              >
                Open Communities
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default InviteRedeemPage;
