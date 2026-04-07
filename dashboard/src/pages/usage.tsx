import { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  BarChart3,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTaskHistory, useUsageBreakdown } from '@/hooks/use-dashboard-data';

function UsageSummary() {
  const { data, isLoading } = useUsageBreakdown();

  const cards = [
    {
      title: 'Tasks Completed',
      value: data?.tasks.completed ?? 0,
      icon: CheckCircle2,
    },
    {
      title: 'Tasks Failed',
      value: data?.tasks.failed ?? 0,
      icon: XCircle,
    },
    {
      title: 'Credits Spent (Tasks)',
      value: data?.tasks.creditsSpent ?? 0,
      format: (v: number) => `${v.toFixed(1)} cr`,
      icon: Zap,
    },
    {
      title: 'Skill Purchases',
      value: data?.skills.purchases ?? 0,
      icon: BarChart3,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(({ title, value, format, icon: Icon }) => (
        <Card key={title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {title}
            </CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <p className="text-2xl font-bold">
                {format ? format(value) : value.toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TaskHistory() {
  const [limit, setLimit] = useState(25);
  const { data, isLoading } = useTaskHistory(limit);
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
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Task History
        </CardTitle>
        <CardDescription>
          All API calls made with your key.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No tasks yet. Make your first API call to see history here.
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Skill</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {t.skill_name ?? 'direct'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {statusIcon(t.status)}
                        <Badge
                          variant={
                            t.status === 'completed'
                              ? 'default'
                              : t.status === 'failed'
                                ? 'destructive'
                                : 'secondary'
                          }
                          className="text-xs"
                        >
                          {t.status}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {t.credits_cost.toFixed(2)} cr
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {t.duration_ms ? `${t.duration_ms}ms` : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {tasks.length >= limit && (
              <div className="border-t border-border px-4 py-3 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLimit((l) => l + 25)}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function UsagePage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Usage</h2>
        <p className="text-sm text-muted-foreground">
          Track your API usage and credit spending.
        </p>
      </div>

      <UsageSummary />
      <TaskHistory />
    </div>
  );
}
