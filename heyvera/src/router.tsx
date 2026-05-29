import { createBrowserRouter, Navigate, Outlet, useLocation, useRouteError } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AppShell } from './components/layout/AppShell';

function RouteErrorBoundary() {
  const error = useRouteError();
  return (
    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-primary)' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '0.5rem' }}>Something went wrong</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '15px', marginBottom: '1rem' }}>
        {error instanceof Error ? error.message : 'An unexpected error occurred'}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          backgroundColor: 'var(--accent)',
          color: 'var(--bg-primary)',
          border: 'none',
          borderRadius: '9999px',
          padding: '0.5rem 1.25rem',
          fontSize: '15px',
          fontWeight: 'bold',
          cursor: 'pointer',
        }}
      >
        Refresh page
      </button>
    </div>
  );
}

const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })));
const ExplorePage = lazy(() => import('./pages/ExplorePage').then(m => ({ default: m.ExplorePage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then(m => ({ default: m.NotificationsPage })));
const MessagesPage = lazy(() => import('./pages/MessagesPage').then(m => ({ default: m.MessagesPage })));
const BookmarksPage = lazy(() => import('./pages/BookmarksPage').then(m => ({ default: m.BookmarksPage })));
const CommunitiesPage = lazy(() => import('./pages/CommunitiesPage').then(m => ({ default: m.CommunitiesPage })));
const PremiumPage = lazy(() => import('./pages/PremiumPage').then(m => ({ default: m.PremiumPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AIPage = lazy(() => import('./pages/AIPage').then(m => ({ default: m.AIPage })));
const PostThreadPage = lazy(() => import('./pages/PostThreadPage').then(m => ({ default: m.PostThreadPage })));

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0' }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>Loading...</div>
    </div>
  );
}

function RootLayout() {
  const location = useLocation();
  const activeRoute = '/' + (location.pathname.split('/')[1] || 'home');

  return (
    <AppShell activeRoute={activeRoute}>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'home', element: <HomePage /> },
      { path: 'explore', element: <ExplorePage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'messages', element: <MessagesPage /> },
      { path: 'bookmarks', element: <BookmarksPage /> },
      { path: 'communities', element: <CommunitiesPage /> },
      { path: 'premium', element: <PremiumPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'profile/:handle', element: <ProfilePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'ai', element: <AIPage /> },
      { path: 'post/:id', element: <PostThreadPage /> },
      { path: '*', element: <Navigate to="/home" replace /> },
    ],
  },
]);
