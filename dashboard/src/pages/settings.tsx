import { useState } from 'react';
import { CheckCircle2, Circle, ExternalLink, Shield, Moon, Sun, Globe, Trash2 } from 'lucide-react';
import { useUser, useAuth } from '@clerk/clerk-react';
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
import { useDashboardMe, useBecomeProvider } from '@/hooks/use-dashboard-data';

const TIER_INFO: Record<string, { label: string; benefits: string[] }> = {
  founding: {
    label: 'T1 Active',
    benefits: [
      '100% of live call revenue (founding era)',
      '90% of cache revenue',
      'Soma Check included',
      'Real-time analytics',
    ],
  },
  verified: {
    label: 'T2 Verified',
    benefits: [
      'Everything in T1',
      'Verified badge on marketplace',
      'Priority support',
      'Extended analytics (90 days)',
    ],
  },
  champion: {
    label: 'T3 Champion',
    benefits: [
      'Everything in T2',
      '95% of cache revenue',
      'Featured placement',
      'Dedicated account manager',
    ],
  },
};

function ThemeToggle() {
  const [dark, setDark] = useState(
    document.documentElement.classList.contains('dark'),
  );

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    setDark(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Appearance</CardTitle>
        <CardDescription>Toggle light and dark mode.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" onClick={toggle} className="gap-2">
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {dark ? 'Light Mode' : 'Dark Mode'}
        </Button>
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const { user } = useUser();
  const { data } = useDashboardMe();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account</CardTitle>
        <CardDescription>Your ClawNet account details.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-muted-foreground">Name</Label>
            <p className="text-sm font-medium">
              {user?.fullName ?? user?.firstName ?? '-'}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Email</Label>
            <p className="text-sm">
              {user?.emailAddresses?.[0]?.emailAddress ?? '-'}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Member Since</Label>
            <p className="text-sm">
              {data?.memberSince
                ? new Date(data.memberSince).toLocaleDateString()
                : '-'}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Credit Balance</Label>
            <p className="text-sm font-medium">
              {(data?.credits ?? 0).toLocaleString()} cr
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityCard() {
  const { user } = useUser();
  const hasMfa = (user?.twoFactorEnabled) ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Security
        </CardTitle>
        <CardDescription>
          Multi-factor authentication and session settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Two-Factor Authentication</p>
            <p className="text-xs text-muted-foreground">
              {hasMfa
                ? 'Enabled — your account is protected with 2FA.'
                : 'Add an extra layer of security to your account.'}
            </p>
          </div>
          <Badge variant={hasMfa ? 'default' : 'secondary'}>
            {hasMfa ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>

        {!hasMfa && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Clerk's UserProfile component handles 2FA setup
              // Open Clerk user profile modal
              const btn = document.querySelector<HTMLButtonElement>(
                '[data-clerk-component="UserButton"] button',
              );
              btn?.click();
              toast.info('Open "Security" in the profile menu to enable 2FA.');
            }}
          >
            Set Up 2FA
          </Button>
        )}

        <Separator />

        <div className="space-y-0.5">
          <p className="text-sm font-medium">Session Timeout</p>
          <p className="text-xs text-muted-foreground">
            Sessions automatically expire after 30 minutes of inactivity.
            A warning appears at 25 minutes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderProfileCard() {
  const { provider } = useProvider();
  if (!provider) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Provider Profile</CardTitle>
        <CardDescription>
          Your provider account information.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-muted-foreground">Provider Name</Label>
            <p className="text-sm font-medium">{provider.name}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Slug</Label>
            <p className="text-sm font-mono">{provider.slug}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Email</Label>
            <p className="text-sm">{provider.email}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Provider ID</Label>
            <p className="text-sm font-mono text-xs">{provider.id}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Status</Label>
            <Badge variant="secondary">{provider.status}</Badge>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Joined</Label>
            <p className="text-sm">
              {new Date(provider.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PayoutWalletCard() {
  const { provider } = useProvider();
  const setWallet = useSetPayoutWallet();
  const [walletAddress, setWalletAddress] = useState(
    provider?.solanaWallet ?? '',
  );

  if (!provider) return null;

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
              walletAddress === provider.solanaWallet
            }
          >
            {setWallet.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
        {provider.solanaWallet && (
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
  );
}

function SomaHeartCard() {
  const { provider } = useProvider();
  if (!provider) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Soma Heart</CardTitle>
        <CardDescription>
          Cryptographic provenance signing for your API responses.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {provider.somaPublicKey ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm">
            {provider.somaPublicKey ? 'Soma Heart configured' : 'Not configured'}
          </span>
        </div>
        {provider.somaPublicKey && (
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Public Key</Label>
            <code className="block text-xs font-mono bg-muted rounded px-2 py-1 break-all">
              {provider.somaPublicKey}
            </code>
          </div>
        )}
        {provider.somaDiscoveryUrl && (
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Discovery URL</Label>
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
  );
}

function ProviderTierCard() {
  const { provider } = useProvider();
  if (!provider) return null;

  const tier = provider.tier ?? 'founding';
  const tierInfo = TIER_INFO[tier] ?? TIER_INFO.founding;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Provider Tier</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge>{tierInfo.label}</Badge>
          <span className="text-sm text-muted-foreground">
            Soma Check Tier: T{provider.somaCheckTier ?? 1}
          </span>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-sm font-medium">Benefits</p>
          {tierInfo.benefits.map((b) => (
            <div
              key={b}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
              {b}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DangerZoneCard() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (confirmText !== 'DELETE') return;
    setDeleting(true);
    try {
      await user?.delete();
      await signOut({ redirectUrl: '/dashboard/' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleting(false);
    }
  }

  return (
    <Card className="border-destructive/20">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 text-destructive">
          <Trash2 className="h-4 w-4" />
          Danger Zone
        </CardTitle>
        <CardDescription>
          Permanently delete your account and all associated data. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Type <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">DELETE</code> to confirm:
          </p>
          <div className="flex gap-3">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="max-w-[200px] font-mono"
            />
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={confirmText !== 'DELETE' || deleting}
            >
              {deleting ? 'Deleting...' : 'Delete Account'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BecomeProviderCard() {
  const { user } = useUser();
  const becomeProvider = useBecomeProvider();
  const [form, setForm] = useState({
    name: '',
    email: user?.emailAddresses?.[0]?.emailAddress ?? '',
    description: '',
    websiteUrl: '',
    solanaWallet: '',
    tosAccepted: false,
  });

  function updateField(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.tosAccepted) {
      toast.error('You must accept the Terms of Service');
      return;
    }
    try {
      const result = await becomeProvider.mutateAsync({
        name: form.name,
        email: form.email,
        description: form.description || undefined,
        websiteUrl: form.websiteUrl || undefined,
        solanaWallet: form.solanaWallet || undefined,
        tosAccepted: true,
      });
      toast.success(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registration failed');
    }
  }

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Become a Provider
        </CardTitle>
        <CardDescription>
          List your API endpoints on ClawNet and earn credits when agents call them.
          You keep 100% of live call revenue during the founding era.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="prov-name">Company / Provider Name</Label>
              <Input
                id="prov-name"
                placeholder="ClawAPIs"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                required
                minLength={2}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prov-email">Contact Email</Label>
              <Input
                id="prov-email"
                type="email"
                placeholder="hello@company.com"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prov-desc">Description</Label>
            <Input
              id="prov-desc"
              placeholder="What does your service do?"
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              maxLength={500}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="prov-url">Website URL</Label>
              <Input
                id="prov-url"
                type="url"
                placeholder="https://clawapis.com"
                value={form.websiteUrl}
                onChange={(e) => updateField('websiteUrl', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prov-wallet">Solana Wallet (optional)</Label>
              <Input
                id="prov-wallet"
                placeholder="For USDC payouts"
                value={form.solanaWallet}
                onChange={(e) => updateField('solanaWallet', e.target.value)}
              />
            </div>
          </div>

          <Separator />

          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="tos-accept"
              checked={form.tosAccepted}
              onChange={(e) => updateField('tosAccepted', e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border"
            />
            <label htmlFor="tos-accept" className="text-sm text-muted-foreground leading-relaxed">
              I accept the{' '}
              <a href="https://claw-net.org/tos" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="https://claw-net.org/provider-agreement" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                Provider Agreement
              </a>.
              I understand that my endpoints will be accessible to AI agents via ClawNet's API.
            </label>
          </div>

          <Button
            type="submit"
            disabled={becomeProvider.isPending || !form.name || !form.email || !form.tosAccepted}
            className="w-full"
          >
            {becomeProvider.isPending ? 'Registering...' : 'Register as Provider'}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Registration is reviewed within 24 hours. You'll be able to add endpoints once activated.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const { provider } = useProvider();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Account, security, and preferences.
        </p>
      </div>

      {/* Customer settings — always visible */}
      <AccountCard />
      <SecurityCard />
      <ThemeToggle />

      {/* Danger zone */}
      <DangerZoneCard />

      {/* Provider settings — only rendered when provider exists */}
      {provider ? (
        <>
          <ProviderProfileCard />
          <PayoutWalletCard />
          <SomaHeartCard />
          <ProviderTierCard />
        </>
      ) : (
        <BecomeProviderCard />
      )}
    </div>
  );
}
