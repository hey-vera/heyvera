import { NavLink, Outlet, useNavigate } from 'react-router';
import { Activity, BadgeCheck, Coins, GitBranch, MessageSquare, Shield } from 'lucide-react';
import { useAuthGate } from '../../lib/useAuthGate';
import SignInScreen from '../auth/SignInScreen';

/**
 * Mission control — the six panes defined in cortex/plan/SURFACE.md.
 *
 * The web app is mission control, not the product: delivery happens at the
 * forge (SURFACE.md ranks the GitHub App first). Chat is pane six and a
 * doorway, never the identity of the app.
 *
 * This is the F1 IA skeleton. Panes mount the components that already exist
 * and state plainly where one does not — an empty pane that says why is
 * honest; a pane filled with numbers the ledger cannot back is not
 * (SURFACE.md, "What not to do").
 */

const PANES = [
  { to: '/runs', label: 'Runs', icon: Activity, hint: 'live steps and state' },
  { to: '/receipts', label: 'Receipts', icon: BadgeCheck, hint: 'proof the checks ran' },
  { to: '/ledger', label: 'Ledger', icon: Coins, hint: 'credits, spend, refunds' },
  { to: '/leases', label: 'Leases', icon: GitBranch, hint: 'who holds what surface' },
  { to: '/admin', label: 'Admin', icon: Shield, hint: 'members, policy, keys' },
  { to: '/', label: 'Chat', icon: MessageSquare, hint: 'a doorway, not the product' },
] as const;

export default function MissionControl() {
  const { isLoaded, isSignedIn, clerkEnabled } = useAuthGate();
  const navigate = useNavigate();

  if (clerkEnabled && !isLoaded) return null;
  if (clerkEnabled && !isSignedIn) return <SignInScreen />;

  return (
    <div className="flex h-screen w-full bg-[var(--bg)] text-[var(--fg)]">
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-white/8 bg-black/20 p-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mb-3 px-2 text-left text-sm font-semibold tracking-wide text-white"
        >
          Cortex
        </button>
        {PANES.map(({ to, label, icon: Icon, hint }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-sm transition ${
                isActive
                  ? 'bg-white/8 text-white'
                  : 'text-[var(--muted)] hover:bg-white/4 hover:text-white'
              }`
            }
          >
            <span className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              {label}
            </span>
            <span className="pl-6 text-[11px] text-[var(--muted)]">{hint}</span>
          </NavLink>
        ))}
      </nav>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Honest empty state. Names the build task that fills the pane so the screen
 * is never a mystery to whoever opens it — including Josh, dogfooding.
 */
export function PaneStub({
  title,
  blockedOn,
  children,
}: {
  title: string;
  blockedOn: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{children}</p>
      <p className="mt-4 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-xs text-[var(--muted)]">
        Not built yet — waiting on <span className="text-white">{blockedOn}</span>.
      </p>
    </div>
  );
}
