import { useState } from 'react';
import {
  Card,
  CardContent,
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
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  useProviderRevenue,
  useProviderAnalytics,
  useSomaCheckEarnings,
} from '@/hooks/use-provider-data';
import { useProvider } from '@/contexts/provider-context';
import { ProviderPendingBanner } from '@/components/provider-pending-banner';

type Window = 'day' | 'week' | 'month';

function SummaryCard({
  title,
  value,
  subtitle,
  loading,
}: {
  title: string;
  value: string;
  subtitle?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-20" />
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

export function EarningsPage() {
  const { provider } = useProvider();
  const [window, setWindow] = useState<Window>('week');
  const { data: revenue, isLoading: revLoading } = useProviderRevenue();
  const { data: analytics, isLoading: chartLoading } = useProviderAnalytics(30);
  const { data: somaEarnings, isLoading: somaLoading } = useSomaCheckEarnings(window);

  const lifetime = revenue?.lifetime;
  const chartData = analytics?.analytics ?? [];

  return (
    <div className="space-y-6">
      {provider && <ProviderPendingBanner status={provider.status} />}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Lifetime Earnings"
          value={`${(lifetime?.totalCredits ?? 0).toFixed(2)} cr`}
          subtitle={`~$${((lifetime?.totalCredits ?? 0) * 0.001).toFixed(4)}`}
          loading={revLoading}
        />
        <SummaryCard
          title="Live Call Revenue"
          value={`${(lifetime?.liveCredits ?? 0).toFixed(2)} cr`}
          subtitle="100% (founding era)"
          loading={revLoading}
        />
        <SummaryCard
          title="Cache Revenue"
          value={`${(lifetime?.cacheCredits ?? 0).toFixed(2)} cr`}
          subtitle="Your 90% share"
          loading={revLoading}
        />
        <SummaryCard
          title="Agent Savings"
          value={`${(somaEarnings?.savings?.agentCreditsSaved ?? 0).toFixed(2)} cr`}
          subtitle="Credits saved by Soma Check"
          loading={somaLoading}
        />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Earnings Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          {chartLoading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : chartData.length === 0 ? (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
              Earnings will appear here once your endpoints receive calls.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="fillEarnings" x1="0" y1="0" x2="0" y2="1">
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
                <YAxis
                  tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
                  tickFormatter={(v: number) => `${v}cr`}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-popover)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    color: 'var(--color-popover-foreground)',
                  }}
                  labelStyle={{ color: 'var(--color-muted-foreground)' }}
                />
                <Area
                  type="monotone"
                  dataKey="revenueCredits"
                  stroke="var(--color-primary)"
                  fill="url(#fillEarnings)"
                  name="Credits Earned"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-endpoint breakdown */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Per-Endpoint Breakdown</CardTitle>
          <div className="flex gap-1">
            {(['day', 'week', 'month'] as Window[]).map((w) => (
              <Badge
                key={w}
                variant={window === w ? 'default' : 'secondary'}
                className="cursor-pointer text-xs"
                onClick={() => setWindow(w)}
              >
                {w === 'day' ? 'Today' : w === 'week' ? '7 days' : '30 days'}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {somaLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !somaEarnings?.endpoints?.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No endpoint data for this period.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Cache Hits</TableHead>
                  <TableHead className="text-right">Hit Rate</TableHead>
                  <TableHead className="text-right">Cache Earned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {somaEarnings.endpoints.map((ep) => (
                  <TableRow key={ep.endpointId}>
                    <TableCell className="font-medium text-sm">
                      {ep.name || ep.endpointId}
                    </TableCell>
                    <TableCell className="text-right">
                      {ep.calls.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {ep.cacheHits.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {(ep.hitRate * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {ep.cacheCreditsEarned.toFixed(2)} cr
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
