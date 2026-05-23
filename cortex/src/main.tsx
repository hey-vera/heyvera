import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// Clear old cached data - force fresh start after auth fixes
const APP_VERSION = '2026-05-23-auth-fix'
const storedVersion = localStorage.getItem('cortex-app-version')
if (storedVersion !== APP_VERSION) {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('cortex-app-version', APP_VERSION)
  console.log('Cleared old app data for fresh start')
}

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

const root = PUBLISHABLE_KEY ? (
  <React.StrictMode>
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      appearance={{
        variables: {
          colorPrimary: '#9cc7b8',
          colorBackground: '#141717',
          colorText: '#f2f4f3',
          colorInputBackground: '#1a1e1e',
          colorInputText: '#f2f4f3',
        },
      }}
    >
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ClerkProvider>
  </React.StrictMode>
) : (
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

ReactDOM.createRoot(document.getElementById('root')!).render(root)
