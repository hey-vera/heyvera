import { type ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { UserButton, useUser } from '@clerk/clerk-react';
import {
  LayoutDashboard,
  Globe,
  TrendingUp,
  Wallet,
  Key,
  Settings,
  Menu,
  CreditCard,
  BarChart3,
  Flame,
  Gift,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { useProvider } from '@/contexts/provider-context';
import { useAdminCheck } from '@/hooks/use-admin-data';

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const CUSTOMER_NAV: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/keys', icon: Key, label: 'API Keys' },
  { to: '/billing', icon: CreditCard, label: 'Billing' },
  { to: '/usage', icon: BarChart3, label: 'Usage' },
  { to: '/referral', icon: Gift, label: 'Referrals' },
];

const EXTRAS_NAV: NavItem[] = [
  { to: '/signal', icon: Flame, label: 'Founding Protocol' },
];

const PROVIDER_NAV: NavItem[] = [
  { to: '/endpoints', icon: Globe, label: 'Endpoints' },
  { to: '/earnings', icon: TrendingUp, label: 'Earnings' },
  { to: '/payouts', icon: Wallet, label: 'Payouts' },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', icon: ShieldCheck, label: 'Admin' },
];

const COMMON_NAV: NavItem[] = [
  { to: '/settings', icon: Settings, label: 'Settings' },
];

const ALL_NAV = [...CUSTOMER_NAV, ...EXTRAS_NAV, ...PROVIDER_NAV, ...ADMIN_NAV, ...COMMON_NAV];

const TIER_LABELS: Record<string, string> = {
  founding: 'T1 Active',
  verified: 'T2 Verified',
  champion: 'T3 Champion',
};

function NavSection({
  items,
  label,
  location,
  onNavigate,
}: {
  items: NavItem[];
  label?: string;
  location: ReturnType<typeof useLocation>;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-1">
      {label && (
        <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
          {label}
        </p>
      )}
      {items.map(({ to, icon: Icon, label: navLabel }) => {
        const active =
          to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(to);
        return (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {navLabel}
          </NavLink>
        );
      })}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { provider } = useProvider();
  const { user } = useUser();
  const location = useLocation();
  const { data: adminData } = useAdminCheck();
  const isAdmin = adminData?.isAdmin ?? false;

  const displayName =
    provider?.name ?? user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress ?? 'User';

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
          C
        </div>
        <span className="text-lg font-semibold tracking-tight">ClawNet</span>
      </div>

      <Separator />

      {/* Nav */}
      <nav className="flex-1 space-y-4 px-3 py-4">
        <NavSection items={CUSTOMER_NAV} location={location} onNavigate={onNavigate} />

        <Separator className="mx-0" />
        <NavSection
          items={EXTRAS_NAV}
          label="Extras"
          location={location}
          onNavigate={onNavigate}
        />

        {(provider || isAdmin) && (
          <>
            <Separator className="mx-0" />
            <NavSection
              items={PROVIDER_NAV}
              label="Provider"
              location={location}
              onNavigate={onNavigate}
            />
          </>
        )}

        {isAdmin && (
          <>
            <Separator className="mx-0" />
            <NavSection
              items={ADMIN_NAV}
              label="Admin"
              location={location}
              onNavigate={onNavigate}
            />
          </>
        )}

        <Separator className="mx-0" />
        <NavSection items={COMMON_NAV} location={location} onNavigate={onNavigate} />
      </nav>

      <Separator />

      {/* User info */}
      <div className="px-4 py-4 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {provider && (
            <Badge variant="secondary" className="text-xs">
              {TIER_LABELS[provider.tier] ?? 'T1 Active'}
            </Badge>
          )}
        </div>
        <UserButton
          appearance={{
            elements: { avatarBox: 'h-8 w-8' },
          }}
        />
      </div>
    </div>
  );
}

function PageTitle() {
  const location = useLocation();
  const current = ALL_NAV.find((item) =>
    item.to === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(item.to),
  );
  return (
    <h1 className="text-lg font-semibold">{current?.label ?? 'Dashboard'}</h1>
  );
}

export function PortalLayout({ children }: { children: ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r border-sidebar-border bg-sidebar">
        <SidebarContent />
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 items-center gap-4 border-b border-border px-4 md:px-6">
          {/* Mobile menu */}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" />}>
              <Menu className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-60 p-0">
              <SidebarContent onNavigate={() => setSheetOpen(false)} />
            </SheetContent>
          </Sheet>

          <PageTitle />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
