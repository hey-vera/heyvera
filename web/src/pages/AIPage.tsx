import { Sparkles } from 'lucide-react';

export function AIPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b sticky-header-bg px-4 py-3 backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)' }}>
        <h1 className="text-[20px] font-bold">AI Assistant</h1>
      </div>

      {/* Centered content */}
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] px-8 text-center">
        {/* Sparkle icon */}
        <Sparkles className="mb-6 h-16 w-16" style={{ color: 'var(--accent)' }} aria-hidden="true" />

        <h2 className="mb-3 text-[28px] font-bold leading-tight">
          AI Assistant
        </h2>

        <p className="mb-8 max-w-sm text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Coming soon — your personal AI powered by the Vera Network. Intelligent, private, and
          built on a protocol that outlives any company.
        </p>

        <button
          type="button"
          className="text-[15px] underline underline-offset-2 transition-opacity hover:opacity-80"
          style={{ color: 'var(--accent)' }}
        >
          Learn more about the Vera Network
        </button>
      </div>
    </div>
  );
}

export default AIPage;
