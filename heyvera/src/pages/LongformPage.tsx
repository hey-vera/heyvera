import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Radio, Shuffle, Sparkles } from 'lucide-react';
import { CreateLongformForm } from '../components/shared/CreateLongformForm';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { fetchLongform } from '../api/social';
import type { LongformEntry } from '../api/social';
import { useAuth } from '../hooks/useAuth';

const PAGE_SIZE = 24;

const STREAMING_PREVIEW = [
  'Live research rooms',
  'Creator journals',
  'Agent-assisted broadcasts',
  'Slow premieres',
] as const;

function estimateReadingTime(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function formatType(formatType: string): string {
  const labels: Record<string, string> = {
    essay: 'Essay',
    broadcast: 'Broadcast',
    research_log: 'Research Log',
    journal: 'Journal',
    thread: 'Thread',
    note: 'Note',
  };
  return labels[formatType] ?? formatType.replace(/_/g, ' ');
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function entryTopics(entry: LongformEntry): string[] {
  const text = `${entry.title} ${entry.summary} ${entry.body}`;
  const explicitTags = Array.from(text.matchAll(/#[a-z0-9_]+/gi))
    .map((match) => match[0].toLowerCase())
    .slice(0, 4);
  if (explicitTags.length > 0) return explicitTags;

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 5 && !['because', 'through', 'people', 'should', 'without'].includes(word));

  return Array.from(new Set(words)).slice(0, 3).map((word) => `#${word}`);
}

function authorLabel(entry: LongformEntry): string {
  if (entry.authorMode === 'agent' && entry.linkedAgent) return entry.linkedAgent.agentName;
  if (entry.authorMode === 'linked_pair' && entry.linkedAgent) {
    return `${entry.author.displayName} + ${entry.linkedAgent.agentName}`;
  }
  return entry.author.displayName;
}

export function LongformPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [entries, setEntries] = useState<LongformEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [topic, setTopic] = useState<string>('All');
  const [spotlightIndex, setSpotlightIndex] = useState(0);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchLongform(PAGE_SIZE);
      setEntries(response.longform);
      setCursor(response.pageInfo.nextCursor);
      setSelectedId(null);
      setTopic('All');
      setSpotlightIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load longform');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial, reloadKey]);

  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    entries.forEach((entry) => {
      entryTopics(entry).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
    });
    return ['All', ...Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([tag]) => tag).slice(0, 10)];
  }, [entries]);

  const visibleEntries = useMemo(() => {
    if (topic === 'All') return entries;
    return entries.filter((entry) => entryTopics(entry).includes(topic));
  }, [entries, topic]);

  const selected = selectedId ? entries.find((entry) => entry.id === selectedId) ?? null : null;
  const spotlight = visibleEntries[spotlightIndex % Math.max(visibleEntries.length, 1)] ?? null;

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetchLongform(PAGE_SIZE, cursor);
      setEntries((current) => {
        const seen = new Set(current.map((entry) => entry.id));
        return [...current, ...response.longform.filter((entry) => !seen.has(entry.id))];
      });
      setCursor(response.pageInfo.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load more longform');
    } finally {
      setLoadingMore(false);
    }
  }

  if (selected) {
    return (
      <article className="min-h-screen px-4 pb-10 pt-4" style={{ color: 'var(--text-primary)' }}>
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className="mb-5 inline-flex items-center gap-2 rounded-full px-3 py-2 text-[15px] font-semibold transition-colors hover-overlay"
          style={{ color: 'var(--text-primary)' }}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="longform-format-label">{formatType(selected.formatType)}</span>
          <span className="rounded-full border px-3 py-1 text-[13px]" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}>
            {estimateReadingTime(selected.body)} min read
          </span>
          {selected.proofState === 'verified' && <span className="longform-proof-chip">Verified</span>}
        </div>

        <h1 className="text-[32px] font-black leading-[1.08] sm:text-[42px]">{selected.title}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{authorLabel(selected)}</span>
          <span>@{selected.author.handle}</span>
          <span>{formatDate(selected.createdAt)}</span>
        </div>

        {selected.summary && (
          <p className="mt-6 border-l-4 pl-4 text-[18px] leading-relaxed" style={{ borderColor: 'var(--accent)', color: 'var(--text-secondary)' }}>
            {selected.summary}
          </p>
        )}

        <div className="mt-7 whitespace-pre-wrap text-[18px] leading-8">
          {selected.body}
        </div>
      </article>
    );
  }

  return (
    <div className="min-h-screen pb-8" style={{ color: 'var(--text-primary)' }}>
      <header className="sticky top-[var(--top-bar-height)] z-10 border-b px-4 py-4 backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'color-mix(in srgb, var(--bg-primary) 86%, transparent)' }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[23px] font-black leading-tight">Longform</h1>
            <p className="mt-1 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
              Essays, journals, broadcasts, and live-ready work.
            </p>
          </div>
          <BookOpen className="h-6 w-6 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
        </div>
      </header>

      <section className="border-b px-4 py-4" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {topics.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setTopic(item);
                setSpotlightIndex(0);
              }}
              className="shrink-0 rounded-full border px-4 py-2 text-[14px] font-semibold transition-colors"
              style={{
                borderColor: item === topic ? 'var(--accent)' : 'var(--border-primary)',
                backgroundColor: item === topic ? 'color-mix(in srgb, var(--accent) 13%, transparent)' : 'transparent',
                color: item === topic ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      {authEnabled && isSignedIn && (
        <section className="border-b px-4 py-4" style={{ borderColor: 'var(--border-primary)' }}>
          <CreateLongformForm getToken={getToken} onLongformCreated={() => setReloadKey((key) => key + 1)} />
        </section>
      )}

      {loading && <LoadingState label="Loading longform" />}
      {!loading && error && <ErrorState detail={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {!loading && !error && entries.length === 0 && <EmptyState title="No longform yet" detail="Published entries will appear here." />}

      {!loading && !error && spotlight && (
        <section className="border-b px-4 py-5" style={{ borderColor: 'var(--border-primary)' }}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-secondary)' }}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Spotlight
            </div>
            <button
              type="button"
              onClick={() => setSpotlightIndex((index) => index + 1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover-overlay"
              aria-label="Shuffle spotlight"
            >
              <Shuffle className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <button type="button" className="block w-full text-left" onClick={() => setSelectedId(spotlight.id)}>
            <span className="longform-format-label">{formatType(spotlight.formatType)}</span>
            <h2 className="mt-3 text-[26px] font-black leading-tight">{spotlight.title}</h2>
            {spotlight.summary && <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{spotlight.summary}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              <span>{authorLabel(spotlight)}</span>
              <span>@{spotlight.author.handle}</span>
              <span>{estimateReadingTime(spotlight.body)} min</span>
            </div>
          </button>
        </section>
      )}

      {!loading && !error && visibleEntries.length > 0 && (
        <section>
          {visibleEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelectedId(entry.id)}
              className="block w-full border-b px-4 py-4 text-left transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_3%,transparent)]"
              style={{ borderColor: 'var(--border-primary)' }}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="longform-format-label">{formatType(entry.formatType)}</span>
                {entryTopics(entry).slice(0, 3).map((tag) => (
                  <span key={tag} className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{tag}</span>
                ))}
              </div>
              <h3 className="text-[19px] font-bold leading-snug">{entry.title}</h3>
              {entry.summary && <p className="mt-2 line-clamp-3 text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{entry.summary}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{authorLabel(entry)}</span>
                <span>@{entry.author.handle}</span>
                <span>{formatDate(entry.createdAt)}</span>
                <span>{estimateReadingTime(entry.body)} min</span>
              </div>
            </button>
          ))}
        </section>
      )}

      {!loading && !error && cursor && (
        <div className="px-4 py-5">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="w-full rounded-full border px-4 py-3 text-[15px] font-bold transition-opacity disabled:opacity-50"
            style={{ borderColor: 'var(--border-primary)' }}
          >
            {loadingMore ? 'Loading' : 'More from the shelf'}
          </button>
        </div>
      )}

      <section className="mx-4 mt-5 border-t pt-5" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="mb-3 inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-secondary)' }}>
          <Radio className="h-4 w-4" aria-hidden="true" />
          Live Next
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {STREAMING_PREVIEW.map((item) => (
            <div key={item} className="rounded-lg border px-3 py-3 text-[14px] font-semibold" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
