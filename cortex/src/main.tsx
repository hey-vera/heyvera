import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App'
import './index.css'

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
      <App />
    </ClerkProvider>
  </React.StrictMode>
) : (
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

ReactDOM.createRoot(document.getElementById('root')!).render(root)
