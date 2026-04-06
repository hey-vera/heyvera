import { Key, Copy, Shield } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useProvider } from '@/contexts/provider-context';

export function ApiKeysPage() {
  const { apiKey } = useProvider();

  // Mask the key for display
  const masked = apiKey
    ? `${apiKey.slice(0, 6)}${'*'.repeat(20)}${apiKey.slice(-4)}`
    : '';

  function copyKey() {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      toast.success('API key copied to clipboard');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">API Keys</h2>
        <p className="text-sm text-muted-foreground">
          Manage your provider API keys for authentication.
        </p>
      </div>

      {/* Current key */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4" />
            Active Key
          </CardTitle>
          <CardDescription>
            This is the key currently used to authenticate with the portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <code className="flex-1 rounded-lg bg-muted px-3 py-2 text-sm font-mono">
              {masked}
            </code>
            <Button variant="outline" size="icon" onClick={copyKey} title="Copy key">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield className="h-3.5 w-3.5" />
            <span>Key is stored locally in your browser. Never share it publicly.</span>
          </div>
        </CardContent>
      </Card>

      {/* Info card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Key Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Provider API keys are created during registration and give access to
            your provider endpoints, analytics, and payout management.
          </p>
          <p>
            To rotate your key or create additional keys, contact the ClawNet
            team.
          </p>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Scope</Badge>
            <span>Provider-level: endpoints, analytics, withdrawals</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
