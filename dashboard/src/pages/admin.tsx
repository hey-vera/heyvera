import { useState } from 'react';
import {
  Activity,
  DollarSign,
  Users,
  Zap,
  Database,
  TrendingUp,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAdminStats, useAdminLogs } from '@/hooks/use-admin-data';

function PeriodToggle({
  period,
  onChange,
}: {
  period: 'week' | 'month';
  onChange: (p: 'week' | 'month') => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-border p-0.5">
      {(['week', 'month'] as const).map((p) => (
        <Button
          key={p}
          variant={period === p ? 'default' : 'ghost'}
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={() => onChange(p)}
        >
          {p === 'week' ? '7 Days' : '30 Days'}
        </Button>
      ))}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  loading,
}: {
  title: string;
  value: string;
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
          <p className="text-2xl font-bold">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

function CallsChart({ period }: { period: 'week' | 'month' }) {
  const { data, isLoading } = useAdminStats(period);
  const chartData = data?.chart ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">API Calls</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : chartData.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            No call data yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="fillCalls" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-muted-foreground)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-muted-foreground)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-popover)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  color: 'var(--color-popover-foreground)',
                }}
              />
              <Area
                type="monotone"
                dataKey="calls"
                stroke="var(--color-primary)"
                fill="url(#fillCalls)"
                name="Calls"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function CacheStatsCard({ period }: { period: 'week' | 'month' }) {
  const { data, isLoading } = useAdminStats(period);
  const cache = data?.cacheStats;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4" />
          Cache Analytics
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : cache ? (
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Hit Rate</p>
              <p className="text-lg font-bold">
                {(cache.hitRate * 100).toFixed(1)}%
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Total Hits</p>
              <p className="text-lg font-bold">
                {cache.totalHits.toLocaleString()}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Credits Saved</p>
              <p className="text-lg font-bold">
                {cache.creditsSaved.toFixed(1)} cr
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No cache data</p>
        )}
      </CardContent>
    </Card>
  );
}

function RevenueCard({ period }: { period: 'week' | 'month' }) {
  const { data, isLoading } = useAdminStats(period);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Revenue Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : data?.revenue ? (
          <div className="space-y-2">
            {Object.entries(data.revenue).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground capitalize">
                  {key.replace(/_/g, ' ')}
                </span>
                <span className="font-mono">{(value as number).toFixed(2)} cr</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No revenue data</p>
        )}
      </CardContent>
    </Card>
  );
}

function CallLogs({ period }: { period: 'week' | 'month' }) {
  const { data, isLoading } = useAdminLogs(period);
  const logs = data?.callLogs ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent API Calls</CardTitle>
        <CardDescription>
          {logs.length} calls in the last {period === 'week' ? '7' : '30'} days
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No call logs.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Query</TableHead>
                <TableHead>Skill</TableHead>
                <TableHead>Key</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.slice(0, 50).map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">
                    {log.query}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {log.skillName ?? '-'}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {log.maskedKey}
                  </TableCell>
                  <TableCell className="text-right text-xs font-mono">
                    {log.creditsCost.toFixed(2)} cr
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={log.status === 'completed' ? 'default' : 'destructive'}
                      className="text-xs"
                    >
                      {log.status}
                    </Badge>
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

function SkillLogs({ period }: { period: 'week' | 'month' }) {
  const { data, isLoading } = useAdminLogs(period);
  const skills = data?.skillLogs ?? [];

  if (!isLoading && skills.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Skill Usage</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead className="text-right">Invocations</TableHead>
                <TableHead className="text-right">Credits Earned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.map((s) => (
                <TableRow key={s.skillName}>
                  <TableCell className="text-sm font-mono">
                    {s.skillName}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {s.invocations.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {s.creditsEarned.toFixed(2)} cr
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

export function AdminPage() {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const { data: statsData, isLoading: statsLoading } = useAdminStats(period);
  const stats = statsData?.stats;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Admin Dashboard</h2>
          <p className="text-sm text-muted-foreground">Platform-wide analytics and logs.</p>
        </div>
        <PeriodToggle period={period} onChange={setPeriod} />
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Calls"
          value={(stats?.totalCalls ?? 0).toLocaleString()}
          icon={Activity}
          loading={statsLoading}
        />
        <StatCard
          title="Revenue"
          value={`${(stats?.totalRevenue ?? 0).toFixed(2)} cr`}
          icon={DollarSign}
          loading={statsLoading}
        />
        <StatCard
          title="Active Users"
          value={(stats?.activeUsers ?? 0).toLocaleString()}
          icon={Users}
          loading={statsLoading}
        />
        <StatCard
          title="Platform Profit"
          value={`${(stats?.profit ?? 0).toFixed(2)} cr`}
          icon={Zap}
          loading={statsLoading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CallsChart period={period} />
        <CacheStatsCard period={period} />
      </div>

      <RevenueCard period={period} />
      <CallLogs period={period} />
      <SkillLogs period={period} />
    </div>
  );
}
