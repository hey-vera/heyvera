import { Routes, Route, Navigate } from 'react-router-dom';
import { useProvider } from './contexts/provider-context';
import { PortalLayout } from './components/layout/portal-layout';
import { ConnectPage } from './components/connect-page';
import { OverviewPage } from './pages/overview';
import { EndpointsPage } from './pages/endpoints';
import { EarningsPage } from './pages/earnings';
import { PayoutsPage } from './pages/payouts';
import { ApiKeysPage } from './pages/api-keys';
import { SettingsPage } from './pages/settings';

export default function App() {
  const { provider, apiKey, isLoading } = useProvider();

  if (!apiKey) return <ConnectPage />;

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

  if (!provider) return <ConnectPage />;

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
