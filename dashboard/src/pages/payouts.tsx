import { useState } from 'react';
import { Wallet, ExternalLink } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { useProvider } from '@/contexts/provider-context';
import {
  useProviderWithdrawals,
  useRequestWithdrawal,
  useSetPayoutWallet,
} from '@/hooks/use-provider-data';

const STATUS_COLORS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  pending: 'secondary',
  approved: 'default',
  completed: 'default',
  rejected: 'destructive',
  failed: 'destructive',
};

function WithdrawDialog({
  balance,
  wallet,
}: {
  balance: number;
  wallet: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const withdraw = useRequestWithdrawal();

  const canWithdraw = balance >= 100 && !!wallet;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const credits = parseFloat(amount);
    if (!credits || credits < 100) {
      toast.error('Minimum withdrawal is 100 credits');
      return;
    }
    if (credits > balance) {
      toast.error('Insufficient balance');
      return;
    }
    try {
      await withdraw.mutateAsync(credits);
      toast.success('Withdrawal requested. 7-day processing hold applies.');
      setOpen(false);
      setAmount('');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Withdrawal failed',
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button disabled={!canWithdraw} size="sm" />}>
        <Wallet className="mr-1.5 h-3.5 w-3.5" />
        Withdraw
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Withdrawal</DialogTitle>
          <DialogDescription>
            Credits will be converted to USDC and sent to your Solana wallet.
            7-day processing hold applies.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Amount (credits)</Label>
            <Input
              type="number"
              min="100"
              max={balance}
              step="1"
              placeholder="100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Available: {balance.toFixed(2)} cr. Min 100 cr.
            </p>
          </div>
          <div className="rounded-lg border border-border p-3 text-sm space-y-1">
            <p>
              <span className="text-muted-foreground">Wallet:</span>{' '}
              <code className="text-xs">{wallet}</code>
            </p>
            <p>
              <span className="text-muted-foreground">Est. USD:</span>{' '}
              ~${((parseFloat(amount) || 0) * 0.001).toFixed(4)}
            </p>
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={withdraw.isPending}
          >
            {withdraw.isPending ? 'Requesting...' : 'Confirm Withdrawal'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WalletSetup() {
  const { provider } = useProvider();
  const setWallet = useSetPayoutWallet();
  const [address, setAddress] = useState(provider?.solanaWallet ?? '');

  async function handleSave() {
    if (!address.trim()) return;
    try {
      await setWallet.mutateAsync(address.trim());
      toast.success('Payout wallet saved');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save wallet',
      );
    }
  }

  if (provider?.solanaWallet) return null;

  return (
    <Card className="border-yellow-500/20 bg-yellow-500/5">
      <CardHeader>
        <CardTitle className="text-base">Set Payout Wallet</CardTitle>
        <CardDescription>
          Enter your Solana wallet address to receive USDC payouts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          placeholder="Solana wallet address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={setWallet.isPending || !address.trim()}
        >
          {setWallet.isPending ? 'Saving...' : 'Save Wallet'}
        </Button>
      </CardContent>
    </Card>
  );
}

export function PayoutsPage() {
  const { provider } = useProvider();
  const { data, isLoading } = useProviderWithdrawals();

  const balance = data?.withdrawableCredits ?? 0;
  const wallet = data?.payoutWallet ?? provider?.solanaWallet ?? null;
  const withdrawals = data?.withdrawals ?? [];
  const minProgress = Math.min(100, (balance / 100) * 100);

  return (
    <div className="space-y-6">
      <WalletSetup />

      {/* Balance card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Balance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-10 w-32" />
          ) : (
            <>
              <div>
                <p className="text-3xl font-bold">{balance.toFixed(2)} cr</p>
                <p className="text-sm text-muted-foreground">
                  ~${(balance * 0.001).toFixed(4)} USD
                </p>
              </div>

              {balance < 100 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{balance.toFixed(0)} / 100 cr minimum</span>
                    <span>{minProgress.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${minProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <WithdrawDialog balance={balance} wallet={wallet} />

              {wallet && (
                <p className="text-xs text-muted-foreground">
                  Payouts to: <code>{wallet.slice(0, 8)}...{wallet.slice(-4)}</code>
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Withdrawal history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payout History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : withdrawals.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No payouts yet. Withdrawals appear here once requested.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawals.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="text-sm">
                      {new Date(w.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {w.amountCredits.toFixed(2)} cr
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_COLORS[w.status] ?? 'secondary'}>
                        {w.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {w.txHash ? (
                        <a
                          href={`https://solscan.io/tx/${w.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        >
                          {w.txHash.slice(0, 8)}...
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
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
