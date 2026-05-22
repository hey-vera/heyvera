import { Check, Copy, Bot, Route, ShieldCheck, Sparkles, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import ApprovalCard from './ApprovalCard';
import type { ApprovalState, ChatMessage as ChatMessageType } from '../../types';

interface ChatMessageProps {
  message: ChatMessageType;
  onApprovalAction: (messageId: string, nextState: ApprovalState) => void;
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function RoutingReceipt({ message }: { message: ChatMessageType }) {
  const sovereignty = message.sovereignty;
  if (!sovereignty) return null;

  return (
    <div className="mt-3 rounded-xl border border-white/8 bg-black/15 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-white">
          <Route className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span className="truncate">
            {sovereignty.routing.provider} / {sovereignty.routing.model}
          </span>
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          {sovereignty.routing.mode}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
        {sovereignty.routing.rationale.join(', ')}
      </p>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted)]">
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent)]" />
        <span className="truncate">
          {sovereignty.seal.boundary} · {sovereignty.seal.credentialMode.replaceAll('_', ' ')}
        </span>
      </div>
    </div>
  );
}

export default function ChatMessage({ message, onApprovalAction }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const canCopy = message.content.trim().length > 0;

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyMessage() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`group flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser ? (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-white">
          {message.isStreaming ? <Sparkles className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>
      ) : null}

      <div className={`max-w-[85%] sm:max-w-[78%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={[
            'rounded-[24px] px-4 py-3 text-sm leading-6 shadow-[0_1px_0_rgba(255,255,255,0.02)]',
            isUser
              ? 'bg-[var(--user-bubble)] text-white'
              : 'border border-white/6 bg-[var(--assistant-bubble)] text-[var(--fg)]',
          ].join(' ')}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
          <RoutingReceipt message={message} />
          {message.approvalRequest ? (
            <ApprovalCard request={message.approvalRequest} onAction={onApprovalAction} />
          ) : null}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-[var(--muted)]">
          <div className="flex min-w-0 items-center gap-1.5">
            {isUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
            <span className="truncate">{message.role === 'assistant' ? message.providerLabel : 'You'}</span>
            <span>·</span>
            <span>{formatTime(message.createdAt)}</span>
          </div>
          {canCopy && (
            <>
              <span>·</span>
              <button
                type="button"
                onClick={copyMessage}
                className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[var(--muted)] opacity-0 transition hover:bg-white/6 hover:text-white active:scale-95 group-hover:opacity-100 group-focus-within:opacity-100"
                aria-label="Copy message"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {isUser ? (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/8 text-white">
          <User className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  );
}
