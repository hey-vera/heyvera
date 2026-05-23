import { ArrowRight, ArrowUp, Square, Brain } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import MemorySuggestions from './MemorySuggestions';

interface ChatComposerProps {
  draft: string;
  disabled?: boolean;
  locked?: boolean;
  placeholder?: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  onSubscribe?: () => void;
  showMemoryIndicator?: boolean;
  currentFiles?: string[];
  recentMessages?: string[];
}

export default function ChatComposer({
  draft,
  disabled = false,
  locked = false,
  placeholder = "Ask Cortex to inspect, patch, or prepare a commit.",
  onDraftChange,
  onSend,
  onStop,
  onSubscribe,
  showMemoryIndicator = true,
  currentFiles = [],
  recentMessages = [],
}: ChatComposerProps) {
  const canSend = draft.trim().length > 0 && !disabled && !locked;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showMemorySuggestions, setShowMemorySuggestions] = useState(false);

  // Check if the current draft looks like a memory command
  const isMemoryCommand = /\b(remember|recall|forget|store|save|what did|list memories)\b/.test(draft.toLowerCase());

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
  }, [draft]);

  useEffect(() => {
    // Show memory suggestions when user types memory-related keywords
    const shouldShow = isMemoryCommand && draft.trim().length > 3 && !disabled && !locked;
    setShowMemorySuggestions(shouldShow);
  }, [draft, isMemoryCommand, disabled, locked]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked && onSubscribe) {
      onSubscribe();
      return;
    }
    if (canSend) onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      setShowMemorySuggestions(false);
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (showMemorySuggestions) {
        // Let suggestions handle the enter key
        return;
      }
      if (locked && onSubscribe) {
        onSubscribe();
        return;
      }
      if (canSend) onSend();
    }
  }

  function handleMemorySuggestionSelect(command: string) {
    onDraftChange(command);
    setShowMemorySuggestions(false);
    // Auto-send memory commands
    setTimeout(() => {
      if (canSend) onSend();
    }, 0);
  }

  if (locked) {
    return (
      <div className="border-t border-white/6 p-3 sm:p-4">
        <div className="rounded-[24px] border border-white/8 bg-[var(--composer)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <div className="flex min-h-[52px] items-center px-3 py-2">
            <p className="flex-1 text-sm text-[var(--muted)]">
              Start your free trial to chat with Cortex.
            </p>
            <button
              type="button"
              onClick={onSubscribe}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-black transition hover:brightness-110 active:scale-95"
            >
              Start free trial
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form className="border-t border-white/6 p-3 sm:p-4 relative" onSubmit={handleSubmit}>
      {/* Memory Suggestions */}
      <MemorySuggestions
        currentInput={draft}
        context={{
          files: currentFiles,
          recentMessages,
        }}
        onSelect={handleMemorySuggestionSelect}
        visible={showMemorySuggestions}
      />

      <div className="rounded-[24px] border border-white/8 bg-[var(--composer)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <textarea
          ref={textareaRef}
          value={draft}
          disabled={disabled}
          rows={1}
          placeholder={placeholder}
          className="max-h-48 min-h-[52px] w-full resize-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-[var(--muted)]"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex items-center justify-between px-1 pb-1">
          {/* Memory Indicator */}
          {showMemoryIndicator && (
            <div className="flex items-center gap-2">
              {isMemoryCommand ? (
                <div className="flex items-center gap-1 text-xs text-[var(--accent)]">
                  <Brain className="h-3 w-3 animate-pulse" />
                  <span>Memory command detected</span>
                </div>
              ) : (
                <div className="text-xs text-[var(--muted)]">
                  Type "remember" or "recall" for memory commands
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
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
      </div>
    </form>
  );
}
