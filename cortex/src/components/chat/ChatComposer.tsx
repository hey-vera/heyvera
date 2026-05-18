import { ArrowUp } from 'lucide-react';
import type { FormEvent, KeyboardEvent } from 'react';

interface ChatComposerProps {
  draft: string;
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}

export default function ChatComposer({
  draft,
  disabled = false,
  onDraftChange,
  onSend,
}: ChatComposerProps) {
  const canSend = draft.trim().length > 0 && !disabled;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSend) onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <form className="border-t border-white/6 p-3 sm:p-4" onSubmit={handleSubmit}>
      <div className="rounded-[24px] border border-white/8 bg-[var(--composer)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <textarea
          value={draft}
          disabled={disabled}
          rows={1}
          placeholder="Ask Cortex to inspect, patch, or prepare a commit."
          className="max-h-48 min-h-[52px] w-full resize-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-[var(--muted)]"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex items-center justify-end px-1 pb-1">
          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send message"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </form>
  );
}
