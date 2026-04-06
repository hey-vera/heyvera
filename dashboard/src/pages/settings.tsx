import { useState } from 'react';
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useProvider } from '@/contexts/provider-context';
import { useSetPayoutWallet } from '@/hooks/use-provider-data';

const TIER_INFO: Record<string, { label: string; color: string; benefits: string[] }> = {
  founding: {
    label: 'T1 Active',
    color: 'default',
    benefits: [
      '100% of live call revenue (founding era)',
      '90% of cache revenue',
      'Soma Check included',
      'Real-time analytics',
    ],
  },
  verified: {
    label: 'T2 Verified',
    color: 'default',
    benefits: [
      'Everything in T1',
      'Verified badge on marketplace',
      'Priority support',
      'Extended analytics (90 days)',
    ],
  },
  champion: {
    label: 'T3 Champion',
    color: 'default',
    benefits: [
      'Everything in T2',
      '95% of cache revenue',
      'Featured placement',
      'Dedicated account manager',
    ],
  },
};

export function SettingsPage() {
  const { provider } = useProvider();
  const setWallet = useSetPayoutWallet();
  const [walletAddress, setWalletAddress] = useState(
    provider?.solanaWallet ?? '',
  );

  const tier = provider?.tier ?? 'founding';
  const tierInfo = TIER_INFO[tier] ?? TIER_INFO.founding;

  async function handleSaveWallet() {
    if (!walletAddress.trim()) return;
    try {
      await setWallet.mutateAsync(walletAddress.trim());
      toast.success('Payout wallet updated');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update wallet',
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>
            Your provider account information.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-muted-foreground">Provider Name</Label>
              <p className="text-sm font-medium">{provider?.name ?? '-'}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Slug</Label>
              <p className="text-sm font-mono">{provider?.slug ?? '-'}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Email</Label>
              <p className="text-sm">{provider?.email ?? '-'}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Provider ID</Label>
              <p className="text-sm font-mono text-xs">
                {provider?.id ?? '-'}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Status</Label>
              <Badge variant="secondary">{provider?.status ?? '-'}</Badge>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Joined</Label>
              <p className="text-sm">
                {provider?.createdAt
                  ? new Date(provider.createdAt).toLocaleDateString()
                  : '-'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payout Wallet */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payout Wallet</CardTitle>
          <CardDescription>
            Solana wallet address for USDC payouts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <Input
              placeholder="Solana wallet address"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={handleSaveWallet}
              disabled={
                setWallet.isPending ||
                !walletAddress.trim() ||
                walletAddress === provider?.solanaWallet
              }
            >
              {setWallet.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
          {provider?.solanaWallet && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {provider.payoutWalletVerified ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Circle className="h-3.5 w-3.5" />
              )}
              <span>
                {provider.payoutWalletVerified ? 'Verified' : 'Pending verification'}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Soma Heart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Soma Heart</CardTitle>
          <CardDescription>
            Cryptographic provenance signing for your API responses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            {provider?.somaPublicKey ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm">
              {provider?.somaPublicKey
                ? 'Soma Heart configured'
                : 'Not configured'}
            </span>
          </div>
          {provider?.somaPublicKey && (
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">
                Public Key
              </Label>
              <code className="block text-xs font-mono bg-muted rounded px-2 py-1 break-all">
                {provider.somaPublicKey}
              </code>
            </div>
          )}
          {provider?.somaDiscoveryUrl && (
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">
                Discovery URL
              </Label>
              <a
                href={provider.somaDiscoveryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                {provider.somaDiscoveryUrl}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tier */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider Tier</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Badge>{tierInfo.label}</Badge>
            <span className="text-sm text-muted-foreground">
              Soma Check Tier: T{provider?.somaCheckTier ?? 1}
            </span>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">Benefits</p>
            {tierInfo.benefits.map((b) => (
              <div key={b} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                {b}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
