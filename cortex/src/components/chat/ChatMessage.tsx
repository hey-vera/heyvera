import { Bot, Sparkles, User } from 'lucide-react';
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

export default function ChatMessage({ message, onApprovalAction }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
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
          {message.approvalRequest ? (
            <ApprovalCard request={message.approvalRequest} onAction={onApprovalAction} />
          ) : null}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-[var(--muted)]">
          {isUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
          {message.role === 'assistant' ? message.providerLabel : 'You'}
          <span>·</span>
          {formatTime(message.createdAt)}
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
