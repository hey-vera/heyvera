import { useState, useCallback } from 'react';
import { Globe, Plus, Trash2, RefreshCw } from 'lucide-react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  useProviderEndpoints,
  useSubmitEndpoint,
  useDeleteEndpoint,
  useInvalidateCache,
} from '@/hooks/use-provider-data';

const CATEGORIES = [
  'solana', 'social', 'utility', 'defi', 'intelligence', 'oracle',
  'scraping', 'discovery', 'infrastructure', 'search', 'media',
  'enrichment', 'weather', 'ai-ml', 'security',
];

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function AddEndpointDialog() {
  const [open, setOpen] = useState(false);
  const submit = useSubmitEndpoint();

  const [form, setForm] = useState({
    name: '',
    description: '',
    category: 'utility',
    baseUrl: '',
    path: '',
    httpMethod: 'GET',
    creditCost: '1',
    cacheTtl: '300',
  });

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await submit.mutateAsync({
        name: form.name,
        description: form.description || undefined,
        category: form.category,
        baseUrl: form.baseUrl,
        path: form.path,
        httpMethod: form.httpMethod,
        creditCost: parseFloat(form.creditCost) || 1,
        cacheTtl: parseInt(form.cacheTtl) || undefined,
      });
      toast.success(`${form.name} is live on ClawNet`);
      setOpen(false);
      setForm({
        name: '', description: '', category: 'utility', baseUrl: '',
        path: '', httpMethod: 'GET', creditCost: '1', cacheTtl: '300',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add endpoint');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add Endpoint
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Endpoint</DialogTitle>
          <DialogDescription>
            Register an API endpoint to list it on ClawNet.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ep-name">Name</Label>
              <Input
                id="ep-name"
                placeholder="Weather API"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ep-category">Category</Label>
              <Select value={form.category} onValueChange={(v) => v && updateField('category', v)}>
                <SelectTrigger id="ep-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ep-base-url">Origin URL</Label>
            <Input
              id="ep-base-url"
              placeholder="https://api.myservice.com"
              value={form.baseUrl}
              onChange={(e) => updateField('baseUrl', e.target.value)}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ep-path">Path</Label>
              <Input
                id="ep-path"
                placeholder="/v1/weather"
                value={form.path}
                onChange={(e) => updateField('path', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ep-method">Method</Label>
              <Select value={form.httpMethod} onValueChange={(v) => v && updateField('httpMethod', v)}>
                <SelectTrigger id="ep-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HTTP_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ep-desc">Description</Label>
            <Textarea
              id="ep-desc"
              placeholder="What does this endpoint do?"
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ep-cost">Credit Cost</Label>
              <Input
                id="ep-cost"
                type="number"
                min="0.001"
                step="0.001"
                placeholder="1.0"
                value={form.creditCost}
                onChange={(e) => updateField('creditCost', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">1 credit = ~$0.001</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ep-ttl">Cache TTL (seconds)</Label>
              <Input
                id="ep-ttl"
                type="number"
                min="0"
                step="1"
                placeholder="300"
                value={form.cacheTtl}
                onChange={(e) => updateField('cacheTtl', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">0 = never cache</p>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={submit.isPending}>
            {submit.isPending ? 'Adding...' : 'Add Endpoint'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EndpointRow({ ep }: { ep: { id: string; name: string; description?: string; category: string; httpMethod: string; creditCost: number; enabled: boolean } }) {
  const deleteEp = useDeleteEndpoint();
  const invalidate = useInvalidateCache();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = useCallback(() => {
    deleteEp.mutate(ep.id, {
      onSuccess: () => toast.success('Endpoint removed'),
      onError: () => toast.error('Failed to delete'),
    });
  }, [deleteEp, ep.id]);

  return (
    <>
      <TableRow>
        <TableCell>
          <div>
            <p className="font-medium text-sm">{ep.name}</p>
            {ep.description && (
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                {ep.description}
              </p>
            )}
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="secondary" className="text-xs">
            {ep.category}
          </Badge>
        </TableCell>
        <TableCell className="text-xs font-mono">{ep.httpMethod}</TableCell>
        <TableCell className="text-right">{ep.creditCost} cr</TableCell>
        <TableCell>
          <Badge variant={ep.enabled ? 'default' : 'secondary'}>
            {ep.enabled ? 'Active' : 'Paused'}
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              title="Invalidate cache"
              onClick={() => {
                invalidate.mutate(ep.id, {
                  onSuccess: () => toast.success('Cache invalidated'),
                  onError: () => toast.error('Failed to invalidate'),
                });
              }}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              title="Delete"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${ep.name}?`}
        description="This will permanently remove this endpoint from ClawNet. Any agents calling it will get errors. This cannot be undone."
        confirmLabel="Delete Endpoint"
        onConfirm={handleDelete}
      />
    </>
  );
}

export function EndpointsPage() {
  const { data: endpoints, isLoading } = useProviderEndpoints();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Your Endpoints</h2>
          <p className="text-sm text-muted-foreground">
            {endpoints?.length ?? 0} endpoint{(endpoints?.length ?? 0) !== 1 ? 's' : ''} registered
          </p>
        </div>
        <AddEndpointDialog />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !endpoints?.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Globe className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">No endpoints yet</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                Add your first API endpoint to start earning on ClawNet.
              </p>
              <AddEndpointDialog />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((ep) => (
                  <EndpointRow key={ep.id} ep={ep} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
