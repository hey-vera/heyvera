import { Link } from 'react-router-dom';
import {
  Phone,
  Database,
  TrendingUp,
  Wallet,
  CheckCircle2,
  Circle,
  ArrowRight,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useProvider } from '@/contexts/provider-context';
import { useProviderStats, useProviderAnalytics, useProviderEndpoints } from '@/hooks/use-provider-data';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const TIER_CRITERIA = {
  verified: {
    label: 'T2 Verified',
    requirements: [
      { key: 'uptime', label: 'Uptime >= 99%', check: () => true },
      { key: 'endpoints', label: 'At least 3 endpoints', check: (n: number) => n >= 3 },
      { key: 'calls', label: '10,000+ calls served', check: (n: number) => n >= 10_000 },
      { key: 'age', label: 'Account age >= 30 days', check: (days: number) => days >= 30 },
    ],
  },
};

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  loading,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OnboardingChecklist({
  hasEndpoints,
  hasWallet,
  hasCalls,
}: {
  hasEndpoints: boolean;
  hasWallet: boolean;
  hasCalls: boolean;
}) {
  const steps = [
    { done: true, label: 'Create account', link: '' },
    { done: hasEndpoints, label: 'Add your first endpoint', link: '/endpoints' },
    { done: hasWallet, label: 'Configure payout wallet', link: '/settings' },
    { done: hasCalls, label: 'Receive your first API call', link: '' },
  ];

  const allDone = steps.every((s) => s.done);
  if (allDone) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Getting Started</CardTitle>
        <CardDescription>
          Complete these steps to start earning on ClawNet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((step) => (
          <div key={step.label} className="flex items-center gap-3">
            {step.done ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span
              className={
                step.done
                  ? 'text-sm text-muted-foreground line-through'
                  : 'text-sm'
              }
            >
              {step.label}
            </span>
            {!step.done && step.link && (
              <Link to={step.link} className="ml-auto">
                <Button variant="ghost" size="xs">
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EarningsChart({ loading }: { loading: boolean }) {
  const { data } = useProviderAnalytics(7);
  const chartData = data?.analytics ?? [];

  if (loading || chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Earnings (7 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
              Earnings will appear here once your endpoints receive calls.
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Earnings (7 days)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="fillRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(0 0% 60%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(0 0% 60%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'hsl(0 0% 45%)', fontSize: 12 }}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              tick={{ fill: 'hsl(0 0% 45%)', fontSize: 12 }}
              tickFormatter={(v: number) => `${v}cr`}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(0 0% 12%)',
                border: '1px solid hsl(0 0% 20%)',
                borderRadius: 8,
              }}
              labelStyle={{ color: 'hsl(0 0% 70%)' }}
            />
            <Area
              type="monotone"
              dataKey="revenueCredits"
              stroke="hsl(0 0% 65%)"
              fill="url(#fillRev)"
              name="Credits"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function TierProgress() {
  const { provider } = useProvider();
  const { data: stats } = useProviderStats();
  const { data: endpoints } = useProviderEndpoints();

  const tier = provider?.tier ?? 'founding';
  if (tier !== 'founding') return null;

  const totalCalls = stats?.totalCalls ?? 0;
  const endpointCount = endpoints?.length ?? 0;
  const accountAgeDays = provider?.createdAt
    ? Math.floor(
        (Date.now() - new Date(provider.createdAt).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : 0;

  const criteria = TIER_CRITERIA.verified;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tier Progress</CardTitle>
        <CardDescription>
          Requirements for {criteria.label}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {[
          { label: 'Uptime >= 99%', met: true },
          { label: `Endpoints: ${endpointCount} / 3`, met: endpointCount >= 3 },
          {
            label: `Calls: ${totalCalls.toLocaleString()} / 10,000`,
            met: totalCalls >= 10_000,
          },
          {
            label: `Account age: ${accountAgeDays}d / 30d`,
            met: accountAgeDays >= 30,
          },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-sm">
            {item.met ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className={item.met ? 'text-muted-foreground' : ''}>
              {item.label}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  const { provider } = useProvider();
  const { data: stats, isLoading: statsLoading } = useProviderStats();
  const { data: endpoints } = useProviderEndpoints();

  const hasEndpoints = (endpoints?.length ?? 0) > 0;
  const hasWallet = !!provider?.solanaWallet;
  const hasCalls = (stats?.totalCalls ?? 0) > 0;

  const cacheRate = stats?.cacheHitRate ?? 0;
  const totalCredits = stats?.totalRevenueUsdc ?? 0;

  return (
    <div className="space-y-6">
      {/* Welcome banner for new providers */}
      {!hasEndpoints && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold">
            Welcome to ClawNet, {provider?.name ?? 'Provider'}!
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Let's get your first endpoint earning. Both parties earn from day one.
          </p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Calls"
          value={stats?.totalCalls?.toLocaleString() ?? '0'}
          icon={Phone}
          loading={statsLoading}
        />
        <StatCard
          title="Cache Hit Rate"
          value={`${(cacheRate * 100).toFixed(1)}%`}
          subtitle="Passive income from cached responses"
          icon={Database}
          loading={statsLoading}
        />
        <StatCard
          title="Total Earnings"
          value={`${totalCredits.toFixed(2)} cr`}
          subtitle={`~$${(totalCredits * 0.001).toFixed(4)} USD`}
          icon={TrendingUp}
          loading={statsLoading}
        />
        <StatCard
          title="Balance"
          value={`${totalCredits.toFixed(2)} cr`}
          subtitle={totalCredits >= 100 ? 'Ready to withdraw' : `${(100 - totalCredits).toFixed(0)} cr to minimum`}
          icon={Wallet}
          loading={statsLoading}
        />
      </div>

      {/* Onboarding + chart + tier */}
      <div className="grid gap-6 lg:grid-cols-2">
        <OnboardingChecklist
          hasEndpoints={hasEndpoints}
          hasWallet={hasWallet}
          hasCalls={hasCalls}
        />
        <EarningsChart loading={statsLoading} />
        <TierProgress />
      </div>
    </div>
  );
}
