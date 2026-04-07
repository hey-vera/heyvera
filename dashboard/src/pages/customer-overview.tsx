import {
  CreditCard,
  Activity,
  Database,
  CheckCircle2,
  Clock,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDashboardMe, useTaskHistory, useHealthCheck } from '@/hooks/use-dashboard-data';
import { Sparkline } from '@/components/sparkline';
import { GaugeRing } from '@/components/gauge-ring';

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  loading,
  sparkData,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
  sparkData?: number[];
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
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-2xl font-bold">{value}</p>
              {subtitle && (
                <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
              )}
            </div>
            {sparkData && sparkData.length >= 2 && (
              <Sparkline data={sparkData} width={72} height={28} className="opacity-80" />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HealthIndicator() {
  const { data, isLoading, isError } = useHealthCheck();

  if (isLoading) return <Skeleton className="h-5 w-20" />;

  const healthy = !isError && data?.status === 'ok';

  return (
    <Badge variant={healthy ? 'default' : 'destructive'} className="gap-1">
      <span
        className={`h-2 w-2 rounded-full ${healthy ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}
      />
      {healthy ? 'Online' : 'Degraded'}
    </Badge>
  );
}

function RecentTasks() {
  const { data, isLoading } = useTaskHistory(5);
  const tasks = data?.tasks ?? [];

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-3.5 w-3.5 text-red-400" />;
      default:
        return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Tasks</CardTitle>
        <CardDescription>Last 5 API calls</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No tasks yet. Make your first API call to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-sm font-mono">
                    {t.skill_name ?? 'direct'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {statusIcon(t.status)}
                      <span className="text-xs">{t.status}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {(t.credits_cost ?? 0).toFixed(1)} cr
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {t.duration_ms ? `${t.duration_ms}ms` : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CacheGauge({ loading }: { loading: boolean }) {
  const { data } = useDashboardMe();
  const cache = data?.cacheStats;

  if (!cache && !loading) return null;

  const hitRate = ((cache?.hitRate ?? 0) * 100);
  const creditsSaved = cache?.creditsSaved ?? 0;
  const totalHits = cache?.totalHits ?? 0;
  const totalMisses = cache?.totalMisses ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cache Performance</CardTitle>
        <CardDescription>Soma Check saves you credits on unchanged data</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-28 w-full" />
        ) : cache ? (
          <div className="flex items-center gap-6">
            {/* Gauge ring */}
            <div className="relative shrink-0">
              <GaugeRing
                value={hitRate}
                label={`${hitRate.toFixed(0)}%`}
                sublabel="hit rate"
                size={96}
                strokeWidth={8}
              />
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 flex-1">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Credits Saved</p>
                <p className="text-lg font-bold">{creditsSaved.toFixed(1)} cr</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Cache Hits</p>
                <p className="text-sm font-medium">{totalHits.toLocaleString()}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Cache Misses</p>
                <p className="text-sm font-medium">{totalMisses.toLocaleString()}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">USD Saved</p>
                <p className="text-sm font-medium">${(creditsSaved * 0.001).toFixed(4)}</p>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CustomerOverviewPage() {
  const { data, isLoading } = useDashboardMe();

  const credits = data?.credits ?? 0;
  const creditsUsed = data?.creditsUsed ?? 0;
  const stats = data?.stats;
  const trend = data?.trend ?? [];

  // Build sparkline arrays from trend data (pad to 7 days)
  const callsSpark = trend.map(t => t.calls);
  const creditsSpark = trend.map(t => t.credits);

  return (
    <div className="space-y-6">
      {/* Header with health */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            {data?.memberSince
              ? `Member since ${new Date(data.memberSince).toLocaleDateString()}`
              : 'Your account overview'}
          </p>
        </div>
        <HealthIndicator />
      </div>

      {/* Stat cards with sparklines */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Credit Balance"
          value={`${credits.toFixed(1)} cr`}
          subtitle={`~$${(credits * 0.001).toFixed(4)} USD`}
          icon={CreditCard}
          loading={isLoading}
        />
        <StatCard
          title="Credits Used"
          value={`${creditsUsed.toFixed(1)} cr`}
          icon={Zap}
          loading={isLoading}
          sparkData={creditsSpark}
        />
        <StatCard
          title="Total Tasks"
          value={(stats?.totalTasks ?? 0).toLocaleString()}
          subtitle={`${stats?.completedTasks ?? 0} completed, ${stats?.failedTasks ?? 0} failed`}
          icon={Activity}
          loading={isLoading}
          sparkData={callsSpark}
        />
        <StatCard
          title="Cache Savings"
          value={`${(data?.cacheStats?.creditsSaved ?? 0).toFixed(1)} cr`}
          subtitle={data?.cacheStats ? `${(data.cacheStats.hitRate * 100).toFixed(0)}% hit rate` : 'No cache data yet'}
          icon={Database}
          loading={isLoading}
        />
      </div>

      {/* Cache gauge + Recent tasks */}
      <div className="grid gap-6 lg:grid-cols-2">
        <CacheGauge loading={isLoading} />
        <RecentTasks />
      </div>
    </div>
  );
}
