import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useProvider } from '@/contexts/provider-context';

export function ConnectPage() {
  const { connect, error: contextError } = useProvider();
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await connect(key.trim());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to connect. Check your API key.',
      );
    } finally {
      setLoading(false);
    }
  }

  const displayError = error ?? contextError;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg">
            C
          </div>
          <CardTitle className="text-xl">ClawNet Provider Portal</CardTitle>
          <CardDescription>
            Enter your provider API key to access your dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {displayError && (
              <Alert variant="destructive">
                <AlertDescription>{displayError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                placeholder="cn-..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Your provider API key starts with <code>cn-</code>. Find it in
                your welcome email or contact support.
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={loading || !key.trim()}>
              {loading ? 'Connecting...' : 'Connect'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
