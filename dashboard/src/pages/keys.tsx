import { useState } from 'react';
import { Key, Eye, EyeOff, RefreshCw, Copy, Shield, AlertTriangle } from 'lucide-react';
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
import { toast } from 'sonner';
import { useDashboardMe, useRevealKey, useRegenerateKey } from '@/hooks/use-dashboard-data';

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
