import { useState } from 'react';
import { CreditCard, ExternalLink, Receipt, Loader2, ChevronDown, ShieldCheck, Link2, Hash, Copy, Check } from 'lucide-react';
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function HashDisplay({ label, hash }: { label: string; hash: string }) {
  const short = hash.length > 20 ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : hash;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
      <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{short}</code>
      <CopyButton text={hash} />
    </div>
  );
}

function ReceiptsTable() {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pageSize = 10;
  const { data, isLoading } = useReceipts(page * pageSize, pageSize);
  const receipts = data?.receipts ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          Soma Receipts
        </CardTitle>
        <CardDescription>
          Every API call produces a cryptographically signed receipt. Click a row to view verification details.
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
            No receipts yet. Make API calls to see your Soma receipts.
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Signature</TableHead>
                  <TableHead>On-Chain</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((r) => {
                  const isOpen = expanded.has(r.id);
                  return (
                    <>
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleExpand(r.id)}
                      >
                        <TableCell className="w-8 px-2">
                          <ChevronDown
                            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          />
                        </TableCell>
                        <TableCell className="text-sm">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-sm capitalize">
                          {r.paymentMethod}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {r.creditsCost.toFixed(1)} cr
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={r.algorithm.includes('ML-DSA') ? 'default' : 'secondary'}
                            className="text-[10px] font-mono gap-1"
                          >
                            <ShieldCheck className="h-3 w-3" />
                            {r.algorithm}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {r.easScanUrl ? (
                            <a
                              href={r.easScanUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Link2 className="h-3 w-3" />
                              EAS
                            </a>
                          ) : r.anchored ? (
                            <Badge variant="secondary" className="text-[10px]">
                              Anchored
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pending</span>
                          )}
                        </TableCell>
                      </TableRow>

                      {/* Expandable detail row */}
                      {isOpen && (
                        <TableRow key={`${r.id}-detail`} className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={6} className="p-4">
                            <div className="space-y-3">
                              {/* Hashes */}
                              <div className="space-y-1.5">
                                <HashDisplay label="Receipt ID" hash={r.id} />
                                <HashDisplay label="Request Hash" hash={r.requestHash} />
                                <HashDisplay label="Response Hash" hash={r.responseHash} />
                                {r.easUid && <HashDisplay label="EAS UID" hash={r.easUid} />}
                              </div>

                              {/* Status badges */}
                              <div className="flex flex-wrap gap-2">
                                {r.hasProvenance && (
                                  <Badge variant="default" className="text-xs gap-1">
                                    <Hash className="h-3 w-3" />
                                    Soma Provenance
                                  </Badge>
                                )}
                                {r.anchored && (
                                  <Badge variant="secondary" className="text-xs gap-1">
                                    <ShieldCheck className="h-3 w-3" />
                                    Merkle Anchored
                                  </Badge>
                                )}
                              </div>

                              {/* Links */}
                              {r.easScanUrl && (
                                <a
                                  href={r.easScanUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  View on EAS Scan (Base)
                                </a>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages} ({total} receipts)
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
