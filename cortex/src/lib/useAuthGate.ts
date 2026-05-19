import { useAuth } from '@clerk/clerk-react';
import type { ComponentType } from 'react';
import SignInScreen from '../components/auth/SignInScreen';

const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

interface AuthGateResult {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string;
  AuthScreen: ComponentType | null;
  getToken: (() => Promise<string | null>) | null;
}

function useClerkGate(): AuthGateResult {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  return {
    isLoaded,
    isSignedIn: isSignedIn ?? false,
    userId: userId ?? 'anonymous',
    AuthScreen: SignInScreen,
    getToken: () => getToken(),
  };
}

function getLocalGate(): AuthGateResult {
  return {
    isLoaded: true,
    isSignedIn: true,
    userId: 'local',
    AuthScreen: null,
    getToken: null,
  };
}

export function useAuthGate(): AuthGateResult {
  if (CLERK_ENABLED) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useClerkGate();
  }
  return getLocalGate();
}
