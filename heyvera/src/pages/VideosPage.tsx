import { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  Clock,
  Film,
  FileText,
  Play,
  Radio,
  Shuffle,
  Sparkles,
  Tag,
  UserRound,
} from 'lucide-react';
import { SignInButton } from '@clerk/clerk-react';
import { useAuth } from '../hooks/useAuth';
import { createLongform, fetchLongform } from '../api/social';
import type { LongformEntry } from '../api/social';

type VideoItem = {
  id: string;
  title: string;
  channel: string;
  age: string;
  duration: string;
  category: string;
  tags: string[];
  /** Preview shells only — never claim live stream until ingest exists. */
  state?: 'preview' | 'scheduled' | 'archive';
  description: string;
};

const FEATURED: VideoItem = {
  id: 'featured',
  title: 'Building a better video web without the retention machine',
  channel: 'HeyVera Founding Channel',
  age: 'Today',
  duration: '12:48',
  category: 'Platform',
  tags: ['#heyvera', '#video', '#sovereign-discovery'],
  description:
    'UI shell preview — not live uploads yet. Real video pipeline ships after image media v1 (presign → finalize → process).',
};

const VIDEOS: VideoItem[] = [
  {
    id: 'v1',
    title: 'Desk cam notes: why related videos should feel like a map',
    channel: 'Josh / Studio Log',
    age: 'Preview',
    duration: '08:16',
    category: 'Studio Logs',
    tags: ['#discovery', '#channels', '#deepcuts'],
    description: 'A channel-style upload slot for future HeyVera videos.',
  },
  {
    id: 'v2',
    title: 'Agent co-host test: clipping a livestream into chapters',
    channel: 'Vera Agents',
    age: 'Preview',
    duration: '15:04',
    category: 'Agents',
    tags: ['#agents', '#chapters', '#live'],
    description: 'Future AI agents can help summarize, chapter, and contextualize broadcasts.',
  },
  {
    id: 'v3',
    title: 'How public channels should work without subscriber vanity',
    channel: 'Product Notes',
    age: 'Preview',
    duration: '06:39',
    category: 'Channels',
    tags: ['#channels', '#identity', '#profiles'],
    description: 'Channels map to Clerk-backed HeyVera profiles, with private follows and public archives.',
  },
  {
    id: 'v4',
    title: 'Deep cuts shelf: obscure uploads by tag, not by manipulation',
    channel: 'Discovery Lab',
    age: 'Preview',
    duration: '10:22',
    category: 'Discovery',
    tags: ['#deepcuts', '#tags', '#archive'],
    description: 'A shelf for low-exposure videos that match a chosen topic path.',
  },
  {
    id: 'v5',
    title: 'Live room layout test with comments beside the player',
    channel: 'Live Systems',
    age: 'Preview',
    duration: 'Soon',
    category: 'Live',
    tags: ['#live', '#comments', '#schedule'],
    state: 'preview',
    description: 'A future room model for live video and live comments. Not broadcasting.',
  },
  {
    id: 'v6',
    title: 'Archive browsing: uploads, playlists, and saved shelves',
    channel: 'Archive Desk',
    age: 'Preview',
    duration: '09:51',
    category: 'Archive',
    tags: ['#playlists', '#favorites', '#archive'],
    description: 'Old-school library browsing without public like wars.',
  },
];

const CATEGORIES = ['Featured', 'Latest', 'Deep Cuts', 'Channels', 'Archive', 'Related by Tags'] as const;

function Thumbnail({ item, large = false }: { item: VideoItem; large?: boolean }) {
  return (
    <div
      className="relative overflow-hidden border"
      style={{
        aspectRatio: '16 / 9',
        borderColor: 'var(--border-primary)',
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, transparent), transparent 38%), color-mix(in srgb, var(--text-primary) 8%, var(--bg-elevated))',
      }}
    >
      <div className="absolute inset-0 grid grid-cols-6 grid-rows-4 opacity-30">
        {Array.from({ length: 24 }).map((_, index) => (
          <span key={index} style={{ borderRight: '1px solid var(--border-primary)', borderBottom: '1px solid var(--border-primary)' }} />
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={large ? 'flex h-16 w-16 items-center justify-center rounded-full' : 'flex h-11 w-11 items-center justify-center rounded-full'}
          style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 84%, transparent)', color: 'var(--text-primary)' }}
        >
          <Play className={large ? 'h-8 w-8 translate-x-0.5' : 'h-5 w-5 translate-x-0.5'} fill="currentColor" aria-hidden="true" />
        </span>
      </div>
      <span
        className="absolute bottom-2 right-2 px-1.5 py-0.5 text-[12px] font-bold"
        style={{ backgroundColor: 'rgba(0,0,0,0.78)', color: '#fff' }}
      >
        {item.duration}
      </span>
      {(item.state === 'scheduled' || item.state === 'preview') && (
        <span
          className="absolute left-2 top-2 px-2 py-1 text-[12px] font-bold"
          style={{
            backgroundColor: 'var(--border-primary)',
            color: 'var(--text-secondary)',
          }}
        >
          {item.state === 'scheduled' ? 'Soon' : 'Preview'}
        </span>
      )}
    </div>
  );
}

function VideoCard({ item, onSelect }: { item: VideoItem; onSelect: (item: VideoItem) => void }) {
  return (
    <button type="button" className="group block min-w-0 text-left" onClick={() => onSelect(item)}>
      <Thumbnail item={item} />
      <h3 className="mt-2 line-clamp-2 text-[15px] font-bold leading-snug group-hover:underline" style={{ color: 'var(--text-primary)' }}>
        {item.title}
      </h3>
      <div className="mt-1 flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="truncate">{item.channel}</span>
      </div>
      <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        {item.age} · {item.category}
      </p>
    </button>
  );
}

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
        Longform essays ship now. Video upload / transcode remains Soon.
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

export function VideosPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [selected, setSelected] = useState<VideoItem>(FEATURED);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Featured');
  const [longform, setLongform] = useState<LongformEntry[] | null>(null);
  const [longformStatus, setLongformStatus] = useState<'loading' | 'live' | 'error'>('loading');
  const [longformRefresh, setLongformRefresh] = useState(0);

  const reloadLongform = useCallback(() => {
    setLongformRefresh((n) => n + 1);
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

  return (
    <div className="min-h-screen px-3 pb-10 pt-4 sm:px-5" style={{ color: 'var(--text-primary)' }}>
      <header className="mb-4 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: 'var(--border-primary)' }}>
        <div>
          <div className="mb-2 inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-secondary)' }}>
            <Film className="h-4 w-4" aria-hidden="true" />
            Social / Videos
          </div>
          <h1 className="text-[28px] font-black leading-tight sm:text-[34px]">Watch</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: 'var(--text-secondary)' }}>
            Media foundation for the active Page (person profile today). Video upload and live ingest are not shipping yet;
            longform text is available via the social API.
          </p>
        </div>
        <button
          type="button"
          disabled
          title="Video upload after image media pipeline is production-ready"
          className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-full px-4 text-[14px] font-bold opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#000' }}
        >
          <Film className="h-4 w-4" aria-hidden="true" />
          Upload video (Soon)
        </button>
      </header>

      {/* Wave 8f — honest page-owned media foundation banner */}
      <div
        className="mb-4 rounded-2xl border px-4 py-3"
        style={{ borderColor: 'var(--accent)', backgroundColor: 'color-mix(in srgb, var(--accent) 10%, var(--bg-elevated))' }}
        role="status"
      >
        <p className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
          Page-owned media foundation
        </p>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Wave 8f lays out the surface only: shelves, archives, and longform attach to the active Page.
          Image attach on posts is the live media path today; <code className="text-[12px]">mediaType: video</code> is
          accepted by the API but video upload UI and transcode are not production. Live encoder ingest is separate
          (see Live — Preview only, no fake LIVE).
        </p>
      </div>

      <p
        className="mb-4 rounded-2xl border px-4 py-3 text-[14px]"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
        role="status"
      >
        Preview video cards below are illustrative layout shells — not real uploads.
      </p>

      {/* Real longform from API when available */}
      <section className="mb-6" aria-label="Page longform and media">
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
            No longform entries yet. Publish one when signed in — this list is real API data, not preview shells.
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
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-bold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
                  <span>{formatLongformLabel(entry.formatType)}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>·</span>
                  <span style={{ color: 'var(--text-secondary)' }}>@{entry.author?.handle ?? 'unknown'}</span>
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

      <section className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Video shelves">
        {CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            className="shrink-0 rounded-full border px-4 py-2 text-[14px] font-semibold"
            style={{
              borderColor: item === category ? 'var(--accent)' : 'var(--border-primary)',
              backgroundColor: item === category ? 'color-mix(in srgb, var(--accent) 13%, transparent)' : 'transparent',
              color: item === category ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {item}
          </button>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0">
          <section className="border" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
            <Thumbnail item={selected} large />
            <div className="p-4">
              <div className="mb-2 flex flex-wrap gap-2">
                {selected.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 text-[13px]" style={{ color: 'var(--accent)' }}>
                    <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                    {tag}
                  </span>
                ))}
              </div>
              <h2 className="text-[23px] font-black leading-tight">{selected.title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{selected.channel}</span>
                <span>{selected.age}</span>
                <span>{selected.category}</span>
              </div>
              <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{selected.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled className="cursor-not-allowed rounded-full border px-4 py-2 text-[14px] font-bold opacity-50" style={{ borderColor: 'var(--border-primary)' }}>
                  Save to shelf (Soon)
                </button>
                <button type="button" disabled className="cursor-not-allowed rounded-full border px-4 py-2 text-[14px] font-bold opacity-50" style={{ borderColor: 'var(--border-primary)' }}>
                  Add to playlist (Soon)
                </button>
                <button type="button" disabled className="cursor-not-allowed rounded-full border px-4 py-2 text-[14px] font-bold opacity-50" style={{ borderColor: 'var(--border-primary)' }}>
                  Share (Soon)
                </button>
              </div>
            </div>
          </section>

          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[20px] font-black">Layout preview — not real uploads</h2>
              <span className="inline-flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                <Clock className="h-4 w-4" aria-hidden="true" />
                Chronological first (when live)
              </span>
            </div>
            <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
              {VIDEOS.map((item) => (
                <VideoCard key={item.id} item={item} onSelect={setSelected} />
              ))}
            </div>
          </section>
        </main>

        <aside className="grid content-start gap-4">
          <section className="border p-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
            <h2 className="mb-3 flex items-center gap-2 text-[17px] font-black">
              <Radio className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              Live next
            </h2>
            <p className="mb-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Placeholders only — no stream is live. See /live for encoder foundation notes.
            </p>
            {['Creator studio open room', 'Agent-assisted broadcast test', 'Community watch room'].map((item) => (
              <div key={item} className="flex w-full items-start gap-3 border-t py-3 first:border-t-0" style={{ borderColor: 'var(--border-primary)' }}>
                <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--border-primary)' }} />
                <span>
                  <span className="block text-[14px] font-bold">{item}</span>
                  <span className="block text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                    Preview · not scheduled
                  </span>
                </span>
              </div>
            ))}
          </section>

          <section className="border p-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
            <h2 className="mb-3 flex items-center gap-2 text-[17px] font-black">
              <Shuffle className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              Related by tags
            </h2>
            {selected.tags.map((tag) => (
              <button key={tag} type="button" className="mb-2 mr-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
                {tag}
              </button>
            ))}
            <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              This rail should become the old-school rabbit-hole path: stable, explainable, and based on video metadata instead of hidden engagement pressure.
            </p>
          </section>

          <section className="border p-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
            <h2 className="mb-3 flex items-center gap-2 text-[17px] font-black">
              <Archive className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              Channel archive
            </h2>
            <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Uploads, playlists, saved shelves, and stream archives will attach to HeyVera profiles through Clerk-backed accounts.
            </p>
          </section>

          <section className="border p-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
            <h2 className="mb-2 flex items-center gap-2 text-[17px] font-black">
              <Sparkles className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              Discovery rule
            </h2>
            <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              No public like totals, no subscriber scoreboard, no rage ranking. Show why a video appears.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
