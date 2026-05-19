import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

interface ChatComposerProps {
  draft: string;
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
}

export default function ChatComposer({
  draft,
  disabled = false,
  onDraftChange,
  onSend,
  onStop,
}: ChatComposerProps) {
  const canSend = draft.trim().length > 0 && !disabled;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
  }, [draft]);

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
          ref={textareaRef}
          value={draft}
          disabled={disabled}
          rows={1}
          placeholder="Ask Cortex to inspect, patch, or prepare a commit."
          className="max-h-48 min-h-[52px] w-full resize-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-[var(--muted)]"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex items-center justify-end px-1 pb-1">
          {disabled && onStop ? (
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 text-sm text-white transition hover:bg-white/12 active:scale-95"
              aria-label="Stop response"
              onClick={onStop}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
