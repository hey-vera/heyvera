import { Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';
import { useProvider } from './contexts/provider-context';
import { PortalLayout } from './components/layout/portal-layout';
import { OverviewPage } from './pages/overview';
import { EndpointsPage } from './pages/endpoints';
import { EarningsPage } from './pages/earnings';
import { PayoutsPage } from './pages/payouts';
import { ApiKeysPage } from './pages/api-keys';
import { SettingsPage } from './pages/settings';

function PortalRoutes() {
  const { provider, isLoading, error } = useProvider();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading portal...</p>
        </div>
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="max-w-md text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg">
            C
          </div>
          <h1 className="text-xl font-semibold">No Provider Account</h1>
          <p className="text-sm text-muted-foreground">
            {error ?? 'Your account is not linked to a provider. Contact the ClawNet team to get set up.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <PortalLayout>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/endpoints" element={<EndpointsPage />} />
        <Route path="/earnings" element={<EarningsPage />} />
        <Route path="/payouts" element={<PayoutsPage />} />
        <Route path="/keys" element={<ApiKeysPage />} />
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
        <PortalRoutes />
      </SignedIn>
    </>
  );
}
