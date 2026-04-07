import { useState } from 'react';
import { Key, Eye, EyeOff, RefreshCw, Copy, Shield, AlertTriangle, Plus, XCircle, Clock } from 'lucide-react';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { useDashboardMe, useRevealKey, useRegenerateKey } from '@/hooks/use-dashboard-data';
import { useDelegatedKeys, useCreateDelegatedKey, useRevokeDelegatedKey, type DelegatedKey } from '@/hooks/use-delegated-keys';
import { ConfirmDialog } from '@/components/confirm-dialog';

function CopyButton({ text }: { text: string }) {
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  }

  return (
    <Button variant="ghost" size="icon" onClick={handleCopy} className="h-8 w-8">
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

function RegenerateDialog() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const regen = useRegenerateKey();
  const [newKey, setNewKey] = useState<string | null>(null);

  async function handleRegenerate() {
    try {
      const result = await regen.mutateAsync();
      setNewKey(result.apiKey);
      setConfirm('');
      toast.success('API key regenerated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to regenerate key');
    }
  }

  function handleClose(isOpen: boolean) {
    if (!isOpen) {
      setNewKey(null);
      setConfirm('');
    }
    setOpen(isOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>
        <RefreshCw className="h-3.5 w-3.5" />
        Regenerate
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Regenerate API Key
          </DialogTitle>
          <DialogDescription>
            This will permanently invalidate your current key. All applications
            using the old key will stop working immediately.
          </DialogDescription>
        </DialogHeader>

        {newKey ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-green-500">New key generated:</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
              <code className="flex-1 text-xs font-mono break-all">{newKey}</code>
              <CopyButton text={newKey} />
            </div>
            <p className="text-xs text-muted-foreground">
              Copy this key now. It will not be shown again.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm">
                Type <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">REGENERATE</code> to confirm:
              </p>
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="REGENERATE"
                className="font-mono"
              />
            </div>
            <Button
              onClick={handleRegenerate}
              disabled={confirm !== 'REGENERATE' || regen.isPending}
              variant="destructive"
              className="w-full"
            >
              {regen.isPending ? 'Regenerating...' : 'Regenerate Key'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateDelegatedKeyDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateDelegatedKey();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: '',
    maxCredits: '',
    rateLimitRpm: '',
    expiresIn: '' as '' | '1h' | '24h' | '7d' | '30d' | 'never',
  });

  function updateField(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function getExpiresAt(): string | undefined {
    if (!form.expiresIn || form.expiresIn === 'never') return undefined;
    const now = Date.now();
    const ms: Record<string, number> = { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    return new Date(now + (ms[form.expiresIn] ?? 0)).toISOString();
  }

  async function handleCreate() {
    try {
      const result = await create.mutateAsync({
        label: form.label || undefined,
        maxCredits: form.maxCredits ? parseFloat(form.maxCredits) : undefined,
        rateLimitRpm: form.rateLimitRpm ? parseInt(form.rateLimitRpm) : undefined,
        expiresAt: getExpiresAt(),
      });
      setNewKey(result.apiKey);
      toast.success('Delegated key created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create key');
    }
  }

  function handleClose(isOpen: boolean) {
    if (!isOpen) {
      setNewKey(null);
      setForm({ label: '', maxCredits: '', rateLimitRpm: '', expiresIn: '' });
    }
    setOpen(isOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="h-3.5 w-3.5" />
        Create Agent Key
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Delegated Key</DialogTitle>
          <DialogDescription>
            Create a scoped key for an AI agent. Child keys inherit your identity
            but can only access what you allow.
          </DialogDescription>
        </DialogHeader>

        {newKey ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-green-500">Key created:</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
              <code className="flex-1 text-xs font-mono break-all">{newKey}</code>
              <CopyButton text={newKey} />
            </div>
            <p className="text-xs text-muted-foreground">
              Copy this key now. It will not be shown again.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dk-label">Label</Label>
              <Input
                id="dk-label"
                placeholder="e.g. trading-bot, research-agent"
                value={form.label}
                onChange={(e) => updateField('label', e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dk-credits">Credit Budget</Label>
                <Input
                  id="dk-credits"
                  type="number"
                  min="1"
                  placeholder="Unlimited"
                  value={form.maxCredits}
                  onChange={(e) => updateField('maxCredits', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Max credits this key can spend</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dk-rpm">Rate Limit (req/min)</Label>
                <Input
                  id="dk-rpm"
                  type="number"
                  min="1"
                  max="10000"
                  placeholder="Default"
                  value={form.rateLimitRpm}
                  onChange={(e) => updateField('rateLimitRpm', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Expires</Label>
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { value: '1h', label: '1 hour' },
                  { value: '24h', label: '24 hrs' },
                  { value: '7d', label: '7 days' },
                  { value: '30d', label: '30 days' },
                  { value: 'never', label: 'Never' },
                ].map(opt => (
                  <Button
                    key={opt.value}
                    type="button"
                    variant={form.expiresIn === opt.value ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs"
                    onClick={() => updateField('expiresIn', opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleCreate}
              disabled={create.isPending}
              className="w-full"
            >
              {create.isPending ? 'Creating...' : 'Create Delegated Key'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DelegatedKeyRow({ dk }: { dk: DelegatedKey }) {
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const revoke = useRevokeDelegatedKey();

  const isExpired = dk.expiresAt && new Date(dk.expiresAt) < new Date();

  return (
    <>
      <TableRow className={!dk.active || isExpired ? 'opacity-50' : ''}>
        <TableCell>
          <div>
            <code className="text-xs font-mono">{dk.maskedKey}</code>
            {dk.label && (
              <p className="text-xs text-muted-foreground mt-0.5">{dk.label}</p>
            )}
          </div>
        </TableCell>
        <TableCell className="text-xs font-mono">
          {dk.maxCredits !== null ? `${dk.maxCredits.toLocaleString()} cr` : 'Unlimited'}
        </TableCell>
        <TableCell className="text-xs">
          {dk.rateLimitRpm ? `${dk.rateLimitRpm}/min` : 'Default'}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {dk.expiresAt
            ? isExpired
              ? 'Expired'
              : new Date(dk.expiresAt).toLocaleDateString()
            : 'Never'}
        </TableCell>
        <TableCell>
          <Badge
            variant={dk.active && !isExpired ? 'default' : 'secondary'}
            className="text-xs"
          >
            {dk.revokedAt ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          {dk.active && !dk.revokedAt && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setConfirmRevoke(true)}
            >
              <XCircle className="h-3 w-3" />
              Revoke
            </Button>
          )}
        </TableCell>
      </TableRow>
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revoke Delegated Key"
        description={`This will immediately revoke ${dk.maskedKey}${dk.label ? ` (${dk.label})` : ''} and all keys it has delegated. Agents using this key will lose access immediately.`}
        confirmLabel="Revoke Key"
        onConfirm={() => {
          revoke.mutate(dk.maskedKey, {
            onSuccess: (data) => toast.success(data.message),
            onError: () => toast.error('Failed to revoke'),
          });
        }}
      />
    </>
  );
}

function DelegatedKeysSection() {
  const { data, isLoading } = useDelegatedKeys();
  const children = data?.children ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4" />
              Delegated Keys
            </CardTitle>
            <CardDescription>
              Create scoped keys for your AI agents with credit budgets, rate limits, and expiry.
            </CardDescription>
          </div>
          <CreateDelegatedKeyDialog />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : children.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground space-y-2">
            <Clock className="h-8 w-8 mx-auto text-muted-foreground/40" />
            <p>No delegated keys yet.</p>
            <p className="text-xs">
              Create agent keys with budget caps and rate limits.
              Perfect for autonomous AI agents that need controlled API access.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead>Rate Limit</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {children.map((dk) => (
                <DelegatedKeyRow key={dk.maskedKey} dk={dk} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function KeysPage() {
  const { data, isLoading } = useDashboardMe();
  const reveal = useRevealKey();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  async function handleReveal() {
    try {
      const result = await reveal.mutateAsync();
      setRevealedKey(result.apiKey);
      setShowKey(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reveal key');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">API Keys</h2>
        <p className="text-sm text-muted-foreground">
          Manage your ClawNet API key for authenticating requests.
        </p>
      </div>

      {/* Key display */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-4 w-4" />
                API Key
              </CardTitle>
              <CardDescription>
                Include this in the <code className="text-xs bg-muted px-1 py-0.5 rounded">X-API-Key</code> header on all requests.
              </CardDescription>
            </div>
            {data?.hasKey && (
              <Badge variant="secondary">Active</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : !data?.hasKey ? (
            <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              No API key found. Contact the ClawNet team or add credits to get started.
            </div>
          ) : (
            <>
              {/* Key display area */}
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
                {revealedKey && showKey ? (
                  <>
                    <code className="flex-1 text-sm font-mono break-all">
                      {revealedKey}
                    </code>
                    <CopyButton text={revealedKey} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setShowKey(false)}
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <code className="flex-1 text-sm font-mono text-muted-foreground">
                      {data.maskedKey ?? 'cn-••••••••••••'}
                    </code>
                    {revealedKey ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setShowKey(true)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReveal}
                        disabled={reveal.isPending}
                        className="gap-1.5"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {reveal.isPending ? 'Revealing...' : 'Reveal'}
                      </Button>
                    )}
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <RegenerateDialog />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Delegated keys for agents */}
      <DelegatedKeysSection />

      {/* Security tips */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
            <span>Never share your API key publicly or commit it to source control.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
            <span>Use environment variables to store keys in your applications.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
            <span>Regenerate your key immediately if you suspect it has been compromised.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
            <span>Rate limit: key regeneration is limited to 3 times per hour.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
