import { Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';
import { useProvider } from './contexts/provider-context';
import { PortalLayout } from './components/layout/portal-layout';
import { SessionTimeout } from './components/session-timeout';

// Customer pages
import { CustomerOverviewPage } from './pages/customer-overview';
import { KeysPage } from './pages/keys';
import { BillingPage } from './pages/billing';
import { UsagePage } from './pages/usage';

// Provider pages
import { EndpointsPage } from './pages/endpoints';
import { EarningsPage } from './pages/earnings';
import { PayoutsPage } from './pages/payouts';

// Shared
import { SettingsPage } from './pages/settings';

/** Guard that redirects non-providers to home */
function ProviderGuard({ children }: { children: React.ReactNode }) {
  const { provider, isLoading } = useProvider();
  if (isLoading) return null;
  if (!provider) return <Navigate to="/" replace />;
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

        {/* Provider routes — guarded */}
        <Route path="/endpoints" element={<ProviderGuard><EndpointsPage /></ProviderGuard>} />
        <Route path="/earnings" element={<ProviderGuard><EarningsPage /></ProviderGuard>} />
        <Route path="/payouts" element={<ProviderGuard><PayoutsPage /></ProviderGuard>} />

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
