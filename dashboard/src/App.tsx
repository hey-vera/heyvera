import { Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';
import { useProvider } from './contexts/provider-context';
import { PortalLayout } from './components/layout/portal-layout';
import { SessionTimeout } from './components/session-timeout';
import { useAdminCheck } from './hooks/use-admin-data';

// Customer pages
import { CustomerOverviewPage } from './pages/customer-overview';
import { KeysPage } from './pages/keys';
import { BillingPage } from './pages/billing';
import { UsagePage } from './pages/usage';
import { ReferralPage } from './pages/referral';

// Provider pages
import { EndpointsPage } from './pages/endpoints';
import { EarningsPage } from './pages/earnings';
import { PayoutsPage } from './pages/payouts';

// Admin
import { AdminPage } from './pages/admin';

// Shared
import { SettingsPage } from './pages/settings';

function GuardSpinner() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
        <p className="text-xs text-muted-foreground">Checking access...</p>
      </div>
    </div>
  );
}

/** Guard that redirects non-providers to home (admins bypass) */
function ProviderGuard({ children }: { children: React.ReactNode }) {
  const { provider, isLoading } = useProvider();
  const { data: adminData, isLoading: adminLoading } = useAdminCheck();
  if (isLoading || adminLoading) return <GuardSpinner />;
  if (!provider && !adminData?.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Guard that redirects non-admins to home */
function AdminGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useAdminCheck();
  if (isLoading) return <GuardSpinner />;
  if (!data?.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function DashboardRoutes() {
  const { isLoading } = useProvider();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <PortalLayout>
      <Routes>
        {/* Customer routes — always available */}
        <Route path="/" element={<CustomerOverviewPage />} />
        <Route path="/keys" element={<KeysPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/referral" element={<ReferralPage />} />

        {/* Provider routes — guarded */}
        <Route path="/endpoints" element={<ProviderGuard><EndpointsPage /></ProviderGuard>} />
        <Route path="/earnings" element={<ProviderGuard><EarningsPage /></ProviderGuard>} />
        <Route path="/payouts" element={<ProviderGuard><PayoutsPage /></ProviderGuard>} />

        {/* Admin — guarded */}
        <Route path="/admin" element={<AdminGuard><AdminPage /></AdminGuard>} />

        {/* Shared */}
        <Route path="/settings" element={<SettingsPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PortalLayout>
  );
}

export default function App() {
  return (
    <>
      <SignedOut>
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <SessionTimeout />
        <DashboardRoutes />
      </SignedIn>
    </>
  );
}
