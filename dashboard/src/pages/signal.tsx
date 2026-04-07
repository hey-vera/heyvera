import { useState } from 'react';
import {
  Flame,
  Lock,
  Unlock,
  Trophy,
  Clock,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { useSignalDetail, useVaultLock, useVaultUnlock } from '@/hooks/use-signal-data';
import { useDashboardMe } from '@/hooks/use-dashboard-data';

const LOCK_TIERS = [
  { days: 30 as const, multiplier: '1.2x', label: '30 Days' },
  { days: 90 as const, multiplier: '1.5x', label: '90 Days' },
  { days: 180 as const, multiplier: '2.0x', label: '180 Days' },
];

function LockDialog() {
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState('');
  const [lockDays, setLockDays] = useState<30 | 90 | 180>(30);
  const lock = useVaultLock();
  const { data: me } = useDashboardMe();

  async function handleLock() {
    const amt = parseFloat(credits);
    if (!amt || amt <= 0) {
      toast.error('Enter a valid credit amount');
      return;
    }
    try {
      const result = await lock.mutateAsync({ credits: amt, lockDays });
      toast.success(result.message);
      setOpen(false);
      setCredits('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lock failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Lock className="h-3.5 w-3.5" />
        Lock Credits
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lock Credits in Founding Vault</DialogTitle>
          <DialogDescription>
            Lock credits now to earn a multiplier bonus when $CLAWNET token launches.
            Longer locks earn higher multipliers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Amount (credits)</Label>
            <Input
              type="number"
              min="1"
              placeholder="100"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Available: {(me?.credits ?? 0).toLocaleString()} cr
            </p>
          </div>

          <div className="space-y-2">
            <Label>Lock Duration</Label>
            <div className="grid grid-cols-3 gap-2">
              {LOCK_TIERS.map((tier) => (
                <Button
                  key={tier.days}
                  variant={lockDays === tier.days ? 'default' : 'outline'}
                  size="sm"
                  className="flex-col h-auto py-2"
                  onClick={() => setLockDays(tier.days)}
                >
                  <span className="text-sm font-bold">{tier.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {tier.multiplier} bonus
                  </span>
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Credits to lock</span>
              <span className="font-mono">{credits || '0'} cr</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Duration</span>
              <span>{lockDays} days</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Multiplier</span>
              <span className="font-bold">
                {LOCK_TIERS.find((t) => t.days === lockDays)?.multiplier}
              </span>
            </div>
          </div>

          <Button
            onClick={handleLock}
            disabled={lock.isPending || !credits}
            className="w-full"
          >
            {lock.isPending ? 'Locking...' : 'Confirm Lock'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VaultTable() {
  const { data, isLoading } = useSignalDetail();
  const unlock = useVaultUnlock();
  const locks = data?.vault.locks ?? [];

  async function handleUnlock(id: string) {
    if (!confirm('Early unlock forfeits your multiplier bonus. Continue?')) return;
    try {
      await unlock.mutateAsync(id);
      toast.success('Unlock requested (7-day cooldown)');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unlock failed');
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Founding Vault
            </CardTitle>
            <CardDescription>
              Locked credits earn multiplier bonuses at token launch.
            </CardDescription>
          </div>
          <LockDialog />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : locks.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No vault locks. Lock credits to earn multiplier bonuses.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Amount</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Multiplier</TableHead>
                <TableHead>Unlocks At</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locks.map((lock) => (
                <TableRow key={lock.id}>
                  <TableCell className="font-mono text-sm">
                    {lock.creditsLocked.toLocaleString()} cr
                  </TableCell>
                  <TableCell className="text-sm">
                    {lock.lockDays} days
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{lock.multiplier}x</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(lock.unlocksAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={lock.status === 'locked' ? 'default' : 'secondary'}
                    >
                      {lock.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {lock.status === 'locked' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUnlock(lock.id)}
                        disabled={unlock.isPending}
                        className="gap-1 text-xs"
                      >
                        <Unlock className="h-3 w-3" />
                        Unlock
                      </Button>
                    )}
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

function Leaderboard() {
  const { data, isLoading } = useSignalDetail();
  const entries = data?.leaderboard ?? [];

  if (!isLoading && entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4" />
          Signal Leaderboard
        </CardTitle>
        <CardDescription>Top 10 participants by Signal score.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Participant</TableHead>
                <TableHead className="text-right">Signal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.rank} className={e.isYou ? 'bg-sidebar-accent/50' : ''}>
                  <TableCell className="text-sm font-bold">
                    {e.rank}
                  </TableCell>
                  <TableCell className="text-sm font-mono">
                    {e.keyHint}
                    {e.isYou && (
                      <Badge variant="default" className="ml-2 text-xs">
                        You
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono">
                    {e.totalSignal.toLocaleString()}
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

function ActivityLog() {
  const { data, isLoading } = useSignalDetail();
  const activity = data?.recentActivity ?? [];

  if (!isLoading && activity.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Recent Signal Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          activity.slice(0, 15).map((a, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{a.action}</span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs">
                  +{a.amount.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(a.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function SignalPage() {
  const { data, isLoading } = useSignalDetail();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Founding Protocol</h2>
        <p className="text-sm text-muted-foreground">
          Earn Signal points toward the $CLAWNET token launch. Lock credits for multiplier bonuses.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Signal Balance
            </CardTitle>
            <Flame className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <p className="text-2xl font-bold">
                {(data?.signal ?? 0).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Leaderboard Rank
            </CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <p className="text-2xl font-bold">
                {data?.rank ? `#${data.rank}` : 'Unranked'}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Credits Locked
            </CardTitle>
            <Lock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <>
                <p className="text-2xl font-bold">
                  {(data?.vault.totalLocked ?? 0).toLocaleString()} cr
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {data?.network.participants ?? 0} participants network-wide
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <VaultTable />

      <div className="grid gap-6 lg:grid-cols-2">
        <Leaderboard />
        <ActivityLog />
      </div>
    </div>
  );
}
