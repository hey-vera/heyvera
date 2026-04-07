import { useState } from 'react';
import { CreditCard, ExternalLink, Receipt, Loader2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { toast } from 'sonner';
import {
  useDashboardMe,
  useCreateCheckout,
  useBillingPortal,
  useReceipts,
} from '@/hooks/use-dashboard-data';

const TOP_UP_AMOUNTS = [
  { usd: 5, credits: '5,000' },
  { usd: 10, credits: '10,000' },
  { usd: 25, credits: '25,000' },
  { usd: 50, credits: '50,000' },
];

function TopUpCard() {
  const checkout = useCreateCheckout();
  const [custom, setCustom] = useState('');
  const [loading, setLoading] = useState<number | null>(null);

  async function handleCheckout(amountUsd: number) {
    setLoading(amountUsd);
    try {
      const result = await checkout.mutateAsync(amountUsd);
      window.location.href = result.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Checkout failed');
      setLoading(null);
    }
  }

  async function handleCustom() {
    const amt = parseFloat(custom);
    if (!amt || amt < 1) {
      toast.error('Minimum $1.00');
      return;
    }
    await handleCheckout(amt);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Add Credits
        </CardTitle>
        <CardDescription>
          1 credit = $0.001 USD. Powered by Stripe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TOP_UP_AMOUNTS.map(({ usd, credits }) => (
            <Button
              key={usd}
              variant="outline"
              className="h-auto flex-col py-3"
              disabled={loading !== null}
              onClick={() => handleCheckout(usd)}
            >
              {loading === usd ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <span className="text-lg font-bold">${usd}</span>
                  <span className="text-xs text-muted-foreground">
                    {credits} cr
                  </span>
                </>
              )}
            </Button>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <Input
              type="number"
              min="1"
              step="1"
              placeholder="Custom amount"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="pl-7"
            />
          </div>
          <Button
            onClick={handleCustom}
            disabled={loading !== null || !custom}
            variant="outline"
          >
            {loading && custom ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Top Up'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BillingPortalCard() {
  const portal = useBillingPortal();

  async function handleOpen() {
    try {
      const result = await portal.mutateAsync();
      window.location.href = result.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open portal');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Payment Methods</CardTitle>
        <CardDescription>
          Manage cards, view invoices, and update billing info via Stripe.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpen}
          disabled={portal.isPending}
          className="gap-1.5"
        >
          {portal.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ExternalLink className="h-3.5 w-3.5" />
          )}
          Open Billing Portal
        </Button>
      </CardContent>
    </Card>
  );
}

function ReceiptsTable() {
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const { data, isLoading } = useReceipts(page * pageSize, pageSize);
  const receipts = data?.receipts ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          Receipts
        </CardTitle>
        <CardDescription>
          Credit purchase history. Soma-verified receipts are anchored on-chain.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : receipts.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No receipts yet. Purchase credits to see your history.
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead>Verified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {r.paymentMethod}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {r.creditsPurchased.toLocaleString()} cr
                    </TableCell>
                    <TableCell>
                      {r.somaVerified ? (
                        <Badge variant="default" className="text-xs">
                          Soma
                        </Badge>
                      ) : r.anchored ? (
                        <Badge variant="secondary" className="text-xs">
                          Anchored
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function BillingPage() {
  const { data, isLoading } = useDashboardMe();
  const credits = data?.credits ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Billing</h2>
        <p className="text-sm text-muted-foreground">
          Add credits and manage your payment methods.
        </p>
      </div>

      {/* Balance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current Balance</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-10 w-32" />
          ) : (
            <div>
              <p className="text-3xl font-bold">{credits.toLocaleString()} cr</p>
              <p className="text-sm text-muted-foreground mt-1">
                ~${(credits * 0.001).toFixed(2)} USD
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <TopUpCard />
      <BillingPortalCard />
      <ReceiptsTable />
    </div>
  );
}
