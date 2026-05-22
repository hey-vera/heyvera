import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  Plus,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  CortexApiError,
  createAdminPromoCode,
  deleteAdminPromoCode,
  getAdminPromoCodes,
  getAdminRedemptions,
  updateAdminPromoCode,
  type CodeRedemption,
  type DiscountOption,
  type PromoCode,
} from '../../lib/cortexApi';

type Tab = 'codes' | 'redemptions';

const DISCOUNT_TYPE_LABELS: Record<string, string> = {
  trial_extension: 'Trial extension',
  percent_off: 'Percent off',
  free_trial: 'Free trial',
};

function formatDate(iso: string | null) {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDiscountValue(type: string, value: number) {
  if (type === 'percent_off') return `${value}%`;
  if (type === 'trial_extension') return `${value} days`;
  if (type === 'free_trial') return `${value} days`;
  return String(value);
}

export default function PromoCodeManager() {
  const [tab, setTab] = useState<Tab>('codes');
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [redemptions, setRedemptions] = useState<CodeRedemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [redemptionFilter, setRedemptionFilter] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchCodes = useCallback(async () => {
    try {
      const result = await getAdminPromoCodes();
      setCodes(result.codes);
      setError(null);
    } catch (err) {
      if (err instanceof CortexApiError && (err.status === 403 || err.status === 401)) {
        setError('Admin access required');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load promo codes');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRedemptions = useCallback(async () => {
    try {
      const result = await getAdminRedemptions(redemptionFilter || undefined);
      setRedemptions(result.redemptions);
    } catch {
      // silent
    }
  }, [redemptionFilter]);

  useEffect(() => {
    void fetchCodes();
  }, [fetchCodes]);

  useEffect(() => {
    if (tab === 'redemptions') void fetchRedemptions();
  }, [tab, fetchRedemptions]);

  const handleToggleActive = async (code: PromoCode) => {
    await updateAdminPromoCode(code.id, { active: !code.active });
    setCodes((prev) =>
      prev.map((c) => (c.id === code.id ? { ...c, active: !c.active } : c)),
    );
  };

  const handleDelete = async (id: string) => {
    await deleteAdminPromoCode(id);
    setCodes((prev) => prev.filter((c) => c.id !== id));
    setConfirmDelete(null);
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-400/15 bg-red-400/8 p-4">
        <div className="flex items-center gap-2 text-sm text-red-100">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-base font-semibold text-white">Promo Codes</h2>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-black transition hover:brightness-110 active:scale-95"
        >
          <Plus className="h-3.5 w-3.5" />
          Create code
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-white/8 bg-white/[0.03] p-1">
        {(['codes', 'redemptions'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${
              tab === t
                ? 'bg-white/10 text-white'
                : 'text-[var(--muted)] hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {showCreate && (
        <CreateCodeForm
          onCreated={(code) => {
            setCodes((prev) => [code, ...prev]);
            setShowCreate(false);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {tab === 'codes' && (
        <div className="space-y-2">
          {codes.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              No promo codes yet. Create your first one above.
            </p>
          ) : (
            codes.map((code) => (
              <div
                key={code.id}
                className={`rounded-xl border bg-white/[0.02] p-3 transition ${
                  code.active ? 'border-white/8' : 'border-white/5 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyCode(code.code)}
                        className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1 font-mono text-sm font-bold text-white transition hover:bg-white/12"
                      >
                        {code.code}
                        {copiedCode === code.code ? (
                          <Check className="h-3 w-3 text-emerald-300" />
                        ) : (
                          <Copy className="h-3 w-3 text-[var(--muted)]" />
                        )}
                      </button>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                          code.active
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-white/8 text-[var(--muted)]'
                        }`}
                      >
                        {code.active ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                      <span>{DISCOUNT_TYPE_LABELS[code.discount_type] ?? code.discount_type}</span>
                      <span className="font-medium text-[var(--muted-strong)]">
                        {formatDiscountValue(code.discount_type, code.discount_value)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {code.current_uses}/{code.max_uses} used
                      </span>
                      {code.expires_at && (
                        <span>Expires {formatDate(code.expires_at)}</span>
                      )}
                    </div>
                    {code.description && (
                      <p className="mt-1.5 text-xs text-[var(--muted)]">{code.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleToggleActive(code)}
                      title={code.active ? 'Disable' : 'Enable'}
                      className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-white/8 hover:text-white"
                    >
                      {code.active ? (
                        <ToggleRight className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </button>
                    {confirmDelete === code.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleDelete(code.id)}
                          className="rounded-lg bg-red-500/20 px-2 py-1 text-[10px] font-medium text-red-200 transition hover:bg-red-500/30"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          className="rounded-lg p-1 text-[var(--muted)] transition hover:bg-white/8"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(code.id)}
                        className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-red-500/12 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'redemptions' && (
        <div className="space-y-3">
          <input
            value={redemptionFilter}
            onChange={(e) => setRedemptionFilter(e.target.value.toUpperCase())}
            placeholder="Filter by code..."
            className="w-full rounded-lg border border-white/8 bg-[var(--composer)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--accent)]/50"
          />
          {redemptions.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              No redemptions{redemptionFilter ? ` for "${redemptionFilter}"` : ' yet'}.
            </p>
          ) : (
            <div className="divide-y divide-white/5 rounded-xl border border-white/8 bg-white/[0.02]">
              {redemptions.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <span className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-xs font-medium text-white">
                      {r.code}
                    </span>
                    <span className="ml-2 text-xs text-[var(--muted)]">
                      {r.user_id.slice(0, 16)}...
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {formatDate(r.redeemed_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface OptionDraft {
  label: string;
  discount_type: string;
  discount_value: number;
}

function CreateCodeForm({
  onCreated,
  onCancel,
}: {
  onCreated: (code: PromoCode) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState('trial_extension');
  const [discountValue, setDiscountValue] = useState(14);
  const [maxUses, setMaxUses] = useState(25);
  const [expiresAt, setExpiresAt] = useState('');
  const [description, setDescription] = useState('');
  const [multiOption, setMultiOption] = useState(false);
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addOption() {
    setOptions((prev) => [...prev, { label: '', discount_type: 'trial_extension', discount_value: 14 }]);
  }

  function removeOption(idx: number) {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateOption(idx: number, patch: Partial<OptionDraft>) {
    setOptions((prev) => prev.map((o, i) => i === idx ? { ...o, ...patch } : o));
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const discountOptions: DiscountOption[] | undefined = multiOption && options.length > 0
        ? options.map((o) => ({ label: o.label || autoLabel(o.discount_type, o.discount_value), discount_type: o.discount_type, discount_value: o.discount_value }))
        : undefined;

      const result = await createAdminPromoCode({
        code: code.trim().toUpperCase(),
        discount_type: discountType,
        discount_value: discountValue,
        max_uses: maxUses,
        expires_at: expiresAt || undefined,
        description: description.trim() || undefined,
        discount_options: discountOptions,
      });
      onCreated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create code');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="space-y-3 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/5 p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">New promo code</h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-1 text-[var(--muted)] transition hover:bg-white/8 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Code
          </label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
            placeholder="CORTEX25"
            maxLength={32}
            required
            className="w-full rounded-lg border border-white/8 bg-[var(--composer)] px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-[var(--accent)]/50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Default type
          </label>
          <select
            value={discountType}
            onChange={(e) => {
              setDiscountType(e.target.value);
              if (e.target.value === 'trial_extension') setDiscountValue(14);
              else if (e.target.value === 'percent_off') setDiscountValue(25);
              else setDiscountValue(14);
            }}
            className="w-full rounded-lg border border-white/8 bg-[var(--composer)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--accent)]/50"
          >
            <option value="trial_extension">Trial extension (days)</option>
            <option value="percent_off">Percent off</option>
            <option value="free_trial">Free trial (days)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Default value
          </label>
          <input
            type="number"
            value={discountValue}
            onChange={(e) => setDiscountValue(Number(e.target.value))}
            min={1}
            max={discountType === 'percent_off' ? 100 : 365}
            required
            className="w-full rounded-lg border border-white/8 bg-[var(--composer)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--accent)]/50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Max uses
          </label>
          <input
            type="number"
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
            min={1}
            max={10000}
            required
            className="w-full rounded-lg border border-white/8 bg-[var(--composer)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--accent)]/50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Expires (optional)
          </label>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full rounded-lg border border-white/8 bg-[var(--composer)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--accent)]/50"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Description (optional)
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Launch promo"
            className="w-full rounded-lg border border-white/8 bg-[var(--composer)] px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--accent)]/50"
          />
        </div>
      </div>

      {/* Multi-option toggle */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => {
            setMultiOption(!multiOption);
            if (!multiOption && options.length === 0) {
              setOptions([
                { label: '', discount_type: 'percent_off', discount_value: 25 },
                { label: '', discount_type: 'trial_extension', discount_value: 14 },
              ]);
            }
          }}
          className="flex items-center gap-2 text-xs text-[var(--muted-strong)] transition hover:text-white"
        >
          {multiOption ? <ToggleRight className="h-4 w-4 text-[var(--accent)]" /> : <ToggleLeft className="h-4 w-4" />}
          Multiple discount options
        </button>
        {multiOption && (
          <span className="text-[10px] text-[var(--muted)]">Customer picks one</span>
        )}
      </div>

      {multiOption && (
        <div className="space-y-2 rounded-lg border border-white/6 bg-white/[0.02] p-3">
          {options.map((opt, idx) => (
            <div key={idx} className="flex items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Label
                </label>
                <input
                  value={opt.label}
                  onChange={(e) => updateOption(idx, { label: e.target.value })}
                  placeholder={autoLabel(opt.discount_type, opt.discount_value)}
                  className="w-full rounded-lg border border-white/8 bg-[var(--composer)] px-2 py-1.5 text-xs text-white outline-none transition focus:border-[var(--accent)]/50"
                />
              </div>
              <div className="w-32">
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Type
                </label>
                <select
                  value={opt.discount_type}
                  onChange={(e) => updateOption(idx, { discount_type: e.target.value })}
                  className="w-full rounded-lg border border-white/8 bg-[var(--composer)] px-2 py-1.5 text-xs text-white outline-none transition focus:border-[var(--accent)]/50"
                >
                  <option value="trial_extension">Extra days</option>
                  <option value="percent_off">% off</option>
                  <option value="free_trial">Free trial</option>
                </select>
              </div>
              <div className="w-20">
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                  Value
                </label>
                <input
                  type="number"
                  value={opt.discount_value}
                  onChange={(e) => updateOption(idx, { discount_value: Number(e.target.value) })}
                  min={1}
                  className="w-full rounded-lg border border-white/8 bg-[var(--composer)] px-2 py-1.5 text-xs text-white outline-none transition focus:border-[var(--accent)]/50"
                />
              </div>
              <button
                type="button"
                onClick={() => removeOption(idx)}
                className="mb-0.5 rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-red-500/12 hover:text-red-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addOption}
            className="flex items-center gap-1 rounded-lg border border-dashed border-white/10 px-3 py-1.5 text-[10px] text-[var(--muted)] transition hover:border-white/20 hover:text-white"
          >
            <Plus className="h-3 w-3" /> Add option
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-400/15 bg-red-400/8 px-3 py-2 text-xs text-red-100">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-white/8 px-3 py-1.5 text-xs text-[var(--muted-strong)] transition hover:bg-white/6"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !code.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-black transition hover:brightness-110 active:scale-95 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Create
        </button>
      </div>
    </form>
  );
}

function autoLabel(type: string, value: number): string {
  if (type === 'percent_off') return `${value}% off annual`;
  if (type === 'trial_extension') return `${value} extra free days`;
  if (type === 'free_trial') return `${value}-day free trial`;
  return `${value} discount`;
}
