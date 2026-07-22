import { useCallback, useEffect, useState } from 'react';
import { Archive, Film, FileText, Library, Radio } from 'lucide-react';
import { SignInButton } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  createLongform,
  createShelf,
  fetchLongform,
  fetchMyShelves,
  type LongformEntry,
  type MediaShelf,
} from '../api/social';
import {
  SHELF_CREATE_CTA,
  SHELF_CREATE_HINT,
  SHELVES_EMPTY_DETAIL,
  SHELVES_EMPTY_TITLE,
  SHELVES_SECTION_TITLE,
  VIDEO_LIBRARY_EMPTY_DETAIL,
  VIDEO_LIBRARY_EMPTY_TITLE,
  VIDEO_PAGE_FOUNDATION_BANNER,
  VIDEO_UPLOAD_CTA_LABEL,
  VIDEO_UPLOAD_DISABLED_REASON,
  isVideoUploadProductionReady,
  shelfListSubtitle,
} from '../utils/mediaHonesty';

function formatLongformLabel(formatType: string): string {
  const map: Record<string, string> = {
    essay: 'Essay',
    broadcast: 'Broadcast',
    research_log: 'Research Log',
    journal: 'Journal',
    thread: 'Thread',
    note: 'Note',
  };
  return map[formatType] ?? formatType.replace(/_/g, ' ');
}

/** Minimal longform create form — API is live (POST /v1/social/longform). */
function LongformCreateForm({
  getToken,
  onCreated,
}: {
  getToken: () => Promise<string | null>;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [formatType, setFormatType] = useState('essay');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-[14px] font-bold"
        style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
      >
        <FileText className="h-4 w-4" aria-hidden="true" />
        Write longform
      </button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError('Sign in required');
        return;
      }
      await createLongform(token, {
        title: title.trim(),
        summary: summary.trim() || undefined,
        body: body.trim(),
        formatType,
      });
      setTitle('');
      setSummary('');
      setBody('');
      setFormatType('essay');
      setOpen(false);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to publish longform');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-3 rounded-2xl border p-4"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
    >
      <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        Longform essays ship now. Video upload / transcode remains not production.
      </p>
      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        required
        disabled={submitting}
        className="rounded-xl border px-3 py-2 text-[14px]"
        style={{
          borderColor: 'var(--border-primary)',
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      />
      <input
        type="text"
        placeholder="Summary (optional)"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        maxLength={500}
        disabled={submitting}
        className="rounded-xl border px-3 py-2 text-[14px]"
        style={{
          borderColor: 'var(--border-primary)',
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      />
      <textarea
        placeholder="Write your essay, broadcast, or journal entry…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        maxLength={50000}
        required
        disabled={submitting}
        className="rounded-xl border px-3 py-2 text-[14px]"
        style={{
          borderColor: 'var(--border-primary)',
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={formatType}
          onChange={(e) => setFormatType(e.target.value)}
          disabled={submitting}
          className="rounded-full border px-3 py-1.5 text-[13px] font-semibold"
          style={{
            borderColor: 'var(--border-primary)',
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--text-primary)',
          }}
        >
          <option value="essay">Essay</option>
          <option value="broadcast">Broadcast</option>
          <option value="research_log">Research Log</option>
          <option value="journal">Journal</option>
          <option value="thread">Thread</option>
          <option value="note">Note</option>
        </select>
        <button
          type="submit"
          disabled={!title.trim() || !body.trim() || submitting}
          className="rounded-full px-4 py-1.5 text-[13px] font-bold disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#000' }}
        >
          {submitting ? 'Publishing…' : 'Publish'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={submitting}
          className="rounded-full border px-4 py-1.5 text-[13px] font-bold"
          style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="text-[13px]" style={{ color: 'var(--color-danger)' }} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** Create empty shelf — POST /v1/social/shelves (no items). */
function ShelfCreateForm({
  getToken,
  onCreated,
}: {
  getToken: () => Promise<string | null>;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-[14px] font-bold"
        style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
      >
        <Library className="h-4 w-4" aria-hidden="true" />
        {SHELF_CREATE_CTA}
      </button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError('Sign in required');
        return;
      }
      await createShelf(token, {
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setTitle('');
      setDescription('');
      setOpen(false);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create shelf');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-3 rounded-2xl border p-4"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
    >
      <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        {SHELF_CREATE_HINT}
      </p>
      <input
        type="text"
        placeholder="Shelf title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        required
        disabled={submitting}
        className="rounded-xl border px-3 py-2 text-[14px]"
        style={{
          borderColor: 'var(--border-primary)',
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      />
      <input
        type="text"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        disabled={submitting}
        className="rounded-xl border px-3 py-2 text-[14px]"
        style={{
          borderColor: 'var(--border-primary)',
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!title.trim() || submitting}
          className="rounded-full px-4 py-1.5 text-[13px] font-bold disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#000' }}
        >
          {submitting ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={submitting}
          className="rounded-full border px-4 py-1.5 text-[13px] font-bold"
          style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="text-[13px]" style={{ color: 'var(--color-danger)' }} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function VideosPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const uploadReady = isVideoUploadProductionReady();

  const [longform, setLongform] = useState<LongformEntry[] | null>(null);
  const [longformStatus, setLongformStatus] = useState<'loading' | 'live' | 'error'>('loading');
  const [longformRefresh, setLongformRefresh] = useState(0);

  const [shelves, setShelves] = useState<MediaShelf[] | null>(null);
  const [shelvesStatus, setShelvesStatus] = useState<'idle' | 'loading' | 'live' | 'error' | 'signed_out'>(
    'idle',
  );
  const [shelvesRefresh, setShelvesRefresh] = useState(0);

  const reloadLongform = useCallback(() => {
    setLongformRefresh((n) => n + 1);
  }, []);

  const reloadShelves = useCallback(() => {
    setShelvesRefresh((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLongformStatus('loading');
    fetchLongform(12)
      .then((result) => {
        if (!cancelled) {
          setLongform(result.longform);
          setLongformStatus('live');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLongform(null);
          setLongformStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [longformRefresh]);

  useEffect(() => {
    if (!authEnabled || !isSignedIn) {
      setShelves(null);
      setShelvesStatus(authEnabled ? 'signed_out' : 'idle');
      return;
    }
    let cancelled = false;
    setShelvesStatus('loading');
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) {
            setShelves(null);
            setShelvesStatus('signed_out');
          }
          return;
        }
        const result = await fetchMyShelves(token, 50);
        if (!cancelled) {
          setShelves(result.shelves ?? []);
          setShelvesStatus('live');
        }
      } catch {
        if (!cancelled) {
          setShelves(null);
          setShelvesStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authEnabled, isSignedIn, getToken, shelvesRefresh]);

  return (
    <div className="min-h-screen px-3 pb-10 pt-4 sm:px-5" style={{ color: 'var(--text-primary)' }}>
      <header
        className="mb-4 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between"
        style={{ borderColor: 'var(--border-primary)' }}
      >
        <div>
          <div
            className="mb-2 inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Film className="h-4 w-4" aria-hidden="true" />
            Social / Videos
          </div>
          <h1 className="text-[28px] font-black leading-tight sm:text-[34px]">Watch</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: 'var(--text-secondary)' }}>
            Media under the active Page (person profile today). Longform text is live; video upload and
            live ingest are not production.
          </p>
        </div>
        <button
          type="button"
          disabled={!uploadReady}
          title={VIDEO_UPLOAD_DISABLED_REASON}
          className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-full px-4 text-[14px] font-bold opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#000' }}
        >
          <Film className="h-4 w-4" aria-hidden="true" />
          {VIDEO_UPLOAD_CTA_LABEL}
        </button>
      </header>

      <div
        className="mb-4 rounded-2xl border px-4 py-3"
        style={{
          borderColor: 'var(--accent)',
          backgroundColor: 'color-mix(in srgb, var(--accent) 10%, var(--bg-elevated))',
        }}
        role="status"
      >
        <p className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
          Page-owned media foundation
        </p>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {VIDEO_PAGE_FOUNDATION_BANNER} Image attach on posts is the live media path (
          <code className="text-[12px]">mediaType: image</code>).{' '}
          <code className="text-[12px]">mediaType: video</code> is accepted by upload-url but processing
          is not production — UI stays disabled with reason.
        </p>
      </div>

      {/* 11a — Video library honesty (no fake cards) */}
      <section
        className="mb-6 border p-5"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
        aria-label="Video library"
      >
        <h2 className="mb-2 flex items-center gap-2 text-[18px] font-black">
          <Film className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
          Video library
        </h2>
        <p className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>
          {VIDEO_LIBRARY_EMPTY_TITLE}
        </p>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {VIDEO_LIBRARY_EMPTY_DETAIL}
        </p>
        <p className="mt-3 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          {VIDEO_UPLOAD_DISABLED_REASON}
        </p>
      </section>

      {/* Real longform from API */}
      <section className="mb-6" aria-label="Page longform">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[18px] font-black">
            <FileText className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            Longform on this surface
          </h2>
          {authEnabled && isSignedIn ? (
            <LongformCreateForm getToken={getToken} onCreated={reloadLongform} />
          ) : authEnabled ? (
            <SignInButton mode="modal">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-[14px] font-bold"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
              >
                Sign in to write
              </button>
            </SignInButton>
          ) : (
            <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Auth not configured — create form unavailable
            </span>
          )}
        </div>

        {longformStatus === 'loading' && (
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            Loading longform…
          </p>
        )}
        {longformStatus === 'error' && (
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            Longform API unreachable — list hidden. No fake entries invented.
          </p>
        )}
        {longformStatus === 'live' && longform && longform.length === 0 && (
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            No longform entries yet. Publish one when signed in — this list is real API data, not preview
            shells.
          </p>
        )}
        {longformStatus === 'live' && longform && longform.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {longform.map((entry) => (
              <article
                key={entry.id}
                className="border p-4"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
              >
                <div
                  className="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-bold uppercase tracking-wide"
                  style={{ color: 'var(--accent)' }}
                >
                  <span>{formatLongformLabel(entry.formatType)}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>·</span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    @{entry.author?.handle ?? 'unknown'}
                  </span>
                </div>
                <h3 className="text-[16px] font-black leading-snug">{entry.title}</h3>
                {entry.summary ? (
                  <p className="mt-2 line-clamp-3 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                    {entry.summary}
                  </p>
                ) : (
                  <p className="mt-2 line-clamp-3 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                    {entry.body}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 11b — Shelves foundation (real list/create empty) */}
      <section className="mb-6" aria-label="Page media shelves">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[18px] font-black">
            <Library className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            {SHELVES_SECTION_TITLE}
          </h2>
          {authEnabled && isSignedIn ? (
            <ShelfCreateForm getToken={getToken} onCreated={reloadShelves} />
          ) : authEnabled ? (
            <SignInButton mode="modal">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-[14px] font-bold"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
              >
                Sign in for shelves
              </button>
            </SignInButton>
          ) : null}
        </div>

        {shelvesStatus === 'signed_out' && (
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            Sign in to list and create empty shelves for your steward Page.
          </p>
        )}
        {shelvesStatus === 'loading' && (
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            Loading shelves…
          </p>
        )}
        {shelvesStatus === 'error' && (
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            Shelves API unreachable — list hidden. No fake shelves invented.
          </p>
        )}
        {shelvesStatus === 'idle' && !authEnabled && (
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            Auth not configured — shelves unavailable.
          </p>
        )}
        {shelvesStatus === 'live' && shelves && shelves.length === 0 && (
          <div
            className="border p-4"
            style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
          >
            <p className="text-[15px] font-bold">{SHELVES_EMPTY_TITLE}</p>
            <p className="mt-1 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
              {SHELVES_EMPTY_DETAIL}
            </p>
          </div>
        )}
        {shelvesStatus === 'live' && shelves && shelves.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {shelves.map((shelf) => (
              <li
                key={shelf.id}
                className="border p-4"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
              >
                <h3 className="text-[16px] font-black leading-snug">{shelf.title}</h3>
                {shelf.description ? (
                  <p className="mt-1 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                    {shelf.description}
                  </p>
                ) : null}
                <p className="mt-2 text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  {shelfListSubtitle(shelf.itemCount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section
          className="border p-4"
          style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
        >
          <h2 className="mb-2 flex items-center gap-2 text-[17px] font-black">
            <Radio className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            Live
          </h2>
          <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            No streams are live. Live stays Preview / Soon only — see{' '}
            <Link to="/live" className="font-bold underline" style={{ color: 'var(--accent)' }}>
              /live
            </Link>{' '}
            for encoder foundation notes.
          </p>
        </section>
        <section
          className="border p-4"
          style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
        >
          <h2 className="mb-2 flex items-center gap-2 text-[17px] font-black">
            <Archive className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            Channel archive
          </h2>
          <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Uploads and stream archives will attach to Page identity when video processing is production.
            No invented archive cards here.
          </p>
        </section>
      </div>
    </div>
  );
}
