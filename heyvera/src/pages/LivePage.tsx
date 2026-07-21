import { CalendarClock, MessageSquare, Radio, Settings, ShieldCheck, Video } from 'lucide-react';

const LIVE_ROOMS = [
  {
    title: 'Creator studio open room',
    channel: 'HeyVera Founding Channel',
    state: 'Ready for first broadcast',
    time: 'Live setup placeholder',
  },
  {
    title: 'Community watch room',
    channel: 'Social / Communities',
    state: 'Scheduled',
    time: 'Tonight',
  },
  {
    title: 'Agent-assisted broadcast',
    channel: 'Vera Agents',
    state: 'Planned',
    time: 'Later',
  },
];

const SETUP_STEPS = [
  'Verify Clerk account and HeyVera profile',
  'Create channel identity and stream title',
  'Choose webcam/browser or encoder ingest',
  'Open live room with comments and moderation',
];

export function LivePage() {
  return (
    <div className="min-h-screen px-3 pb-10 pt-4 sm:px-5" style={{ color: 'var(--text-primary)' }}>
      <header className="mb-5 border-b pb-4" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="mb-2 inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-secondary)' }}>
          <Radio className="h-4 w-4" aria-hidden="true" />
          Social / Live
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[28px] font-black leading-tight sm:text-[34px]">Live</h1>
            <p className="mt-1 max-w-2xl text-[15px]" style={{ color: 'var(--text-secondary)' }}>
              Channel-based live rooms, scheduled broadcasts, and future stream archives.
            </p>
          </div>
          <button
            type="button"
            disabled
            title="Live scheduling ships after stream ingest is real"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[14px] font-bold opacity-50 cursor-not-allowed"
            style={{ backgroundColor: 'var(--accent)', color: '#000' }}
          >
            <Video className="h-4 w-4" aria-hidden="true" />
            Schedule Stream (Soon)
          </button>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0">
          <section className="border" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
            <div className="relative flex min-h-[320px] items-center justify-center border-b" style={{ borderColor: 'var(--border-primary)', backgroundColor: '#050505' }}>
              <div className="text-center">
                <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff' }}>
                  <Radio className="h-8 w-8" aria-hidden="true" />
                </span>
                <h2 className="text-[24px] font-black text-white">Live room preview</h2>
                <p className="mt-2 max-w-md text-[14px] text-white/70">
                  Playback will attach here once stream ingest and live sessions are wired to HeyVera profiles.
                </p>
              </div>
              <span
                className="absolute left-3 top-3 rounded-full px-3 py-1 text-[13px] font-black"
                style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
              >
                Preview
              </span>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-[1fr_280px]">
              <div>
                <h2 className="text-[22px] font-black">Creator studio open room</h2>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  A broadcast room should belong to the creator channel, not a detached stream object. Clerk signs the user in, HeyVera profile owns the channel, and the live room becomes an archive when it ends.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {['#live', '#channels', '#comments', '#archives'].map((tag) => (
                    <span key={tag} className="rounded-full border px-3 py-1.5 text-[13px] font-semibold" style={{ borderColor: 'var(--border-primary)', color: 'var(--accent)' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="border p-3" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
                <h3 className="mb-2 flex items-center gap-2 text-[15px] font-black">
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Live comments
                </h3>
                {['Welcome to the room.', 'Comments should be live, moderated, and archivable.', 'Agent summaries can happen later.'].map((message) => (
                  <p key={message} className="border-t py-2 text-[13px] first:border-t-0" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}>
                    {message}
                  </p>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="mb-3 text-[20px] font-black">Broadcast schedule</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {LIVE_ROOMS.map((room) => (
                <article key={room.title} className="border p-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
                  <span className="mb-3 inline-flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--accent)' }}>
                    <CalendarClock className="h-4 w-4" aria-hidden="true" />
                    {room.time}
                  </span>
                  <h3 className="text-[16px] font-black leading-snug">{room.title}</h3>
                  <p className="mt-1 text-[14px]" style={{ color: 'var(--text-secondary)' }}>{room.channel}</p>
                  <p className="mt-3 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{room.state}</p>
                </article>
              ))}
            </div>
          </section>
        </main>

        <aside className="grid content-start gap-4">
          <section className="border p-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
            <h2 className="mb-3 flex items-center gap-2 text-[17px] font-black">
              <Settings className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              Creator setup
            </h2>
            <ol className="grid gap-3">
              {SETUP_STEPS.map((step, index) => (
                <li key={step} className="flex gap-3 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-black" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--text-primary)' }}>
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </section>

          <section className="border p-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
            <h2 className="mb-2 flex items-center gap-2 text-[17px] font-black">
              <ShieldCheck className="h-5 w-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              Account routing
            </h2>
            <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Live creation should require a signed-in Clerk user with a HeyVera profile. Public viewers can watch; creators manage streams through their channel identity.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
