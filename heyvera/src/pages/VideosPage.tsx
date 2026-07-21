import { useState } from 'react';
import {
  Archive,
  Clock,
  Film,
  Play,
  Radio,
  Shuffle,
  Sparkles,
  Tag,
  UserRound,
} from 'lucide-react';

type VideoItem = {
  id: string;
  title: string;
  channel: string;
  age: string;
  duration: string;
  category: string;
  tags: string[];
  state?: 'live' | 'scheduled' | 'archive';
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
  description: 'A working preview for video uploads, live rooms, channels, archives, and tag-based related browsing.',
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
    duration: 'Live slot',
    category: 'Live',
    tags: ['#live', '#comments', '#schedule'],
    state: 'scheduled',
    description: 'A future room model for live video and live comments.',
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
      {item.state === 'scheduled' && (
        <span className="absolute left-2 top-2 px-2 py-1 text-[12px] font-bold" style={{ backgroundColor: 'var(--accent)', color: '#000' }}>
          Scheduled
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

export function VideosPage() {
  const [selected, setSelected] = useState<VideoItem>(FEATURED);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Featured');

  return (
    <div className="min-h-screen px-3 pb-10 pt-4 sm:px-5" style={{ color: 'var(--text-primary)' }}>
      <header className="mb-4 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: 'var(--border-primary)' }}>
        <div>
          <div className="mb-2 inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-secondary)' }}>
            <Film className="h-4 w-4" aria-hidden="true" />
            Social / Videos
          </div>
          <h1 className="text-[28px] font-black leading-tight sm:text-[34px]">Videos</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: 'var(--text-secondary)' }}>
            Channels, uploads, archives, and tag-based discovery for the Social network.
          </p>
        </div>
        <button
          type="button"
          disabled
          title="Video upload ships after the media path is wired end-to-end"
          className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-full px-4 text-[14px] font-bold opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#000' }}
        >
          <Film className="h-4 w-4" aria-hidden="true" />
          Upload Video (Soon)
        </button>
      </header>

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
                <button type="button" className="rounded-full border px-4 py-2 text-[14px] font-bold" style={{ borderColor: 'var(--border-primary)' }}>
                  Save to shelf
                </button>
                <button type="button" className="rounded-full border px-4 py-2 text-[14px] font-bold" style={{ borderColor: 'var(--border-primary)' }}>
                  Add to playlist
                </button>
                <button type="button" className="rounded-full border px-4 py-2 text-[14px] font-bold" style={{ borderColor: 'var(--border-primary)' }}>
                  Share
                </button>
              </div>
            </div>
          </section>

          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[20px] font-black">Recently uploaded</h2>
              <span className="inline-flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                <Clock className="h-4 w-4" aria-hidden="true" />
                Chronological first
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
            {['Creator studio open room', 'Agent-assisted broadcast test', 'Community watch room'].map((item, index) => (
              <button key={item} type="button" className="flex w-full items-start gap-3 border-t py-3 text-left first:border-t-0" style={{ borderColor: 'var(--border-primary)' }}>
                <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: index === 0 ? 'var(--color-danger)' : 'var(--accent)' }} />
                <span>
                  <span className="block text-[14px] font-bold">{item}</span>
                  <span className="block text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                    {index === 0 ? 'Live room placeholder' : 'Scheduled placeholder'}
                  </span>
                </span>
              </button>
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
