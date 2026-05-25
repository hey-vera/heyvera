import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './pages/HomePage';
import { ExplorePage } from './pages/ExplorePage';
import { NotificationsPage } from './pages/NotificationsPage';
import { MessagesPage } from './pages/MessagesPage';
import { BookmarksPage } from './pages/BookmarksPage';
import { CommunitiesPage } from './pages/CommunitiesPage';
import { PremiumPage } from './pages/PremiumPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { AIPage } from './pages/AIPage';
import { PostThreadPage } from './pages/PostThreadPage';

function RootLayout() {
  const location = useLocation();
  const activeRoute = '/' + (location.pathname.split('/')[1] || 'home');

  return (
    <AppShell activeRoute={activeRoute}>
      <Outlet />
    </AppShell>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
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
    ],
  },
]);
