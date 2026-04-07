import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ProviderProvider } from './contexts/provider-context';
import App from './App';
import './index.css';

const CLERK_KEY = 'pk_live_Y2xlcmsuY2xhdy1uZXQub3JnJA';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={CLERK_KEY} afterSignOutUrl="/dashboard/">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/dashboard">
          <ProviderProvider>
            <App />
          </ProviderProvider>
        </BrowserRouter>
        <Toaster position="bottom-right" theme="dark" />
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>,
);
