import { Key, Shield } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useProvider } from '@/contexts/provider-context';

export function ApiKeysPage() {
  const { provider } = useProvider();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">API Keys</h2>
        <p className="text-sm text-muted-foreground">
          Manage your provider API keys for authentication.
        </p>
      </div>

      {/* Info card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4" />
            Provider Keys
          </CardTitle>
          <CardDescription>
            API keys authenticate programmatic access to your provider endpoints.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield className="h-3.5 w-3.5" />
            <span>Keys are shown only once at creation. Store them securely.</span>
          </div>
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground space-y-2">
            <p>
              Provider API keys are created during registration and give
              programmatic access to your endpoints, analytics, and payout
              management.
            </p>
            <p>
              To create or rotate keys, contact the ClawNet team. Self-service
              key management is coming soon.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Scope</Badge>
            <span className="text-sm text-muted-foreground">
              Provider-level: endpoints, analytics, withdrawals
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
