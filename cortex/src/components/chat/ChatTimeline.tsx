import { useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import type { ApprovalState, ChatMessage as ChatMessageType } from '../../types';

interface ChatTimelineProps {
  messages: ChatMessageType[];
  isLoading?: boolean;
  onApprovalAction: (messageId: string, nextState: ApprovalState) => void;
}

function TimelineSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {[0, 1, 2].map((item) => (
        <div key={item} className={`flex gap-3 ${item === 1 ? 'justify-end' : 'justify-start'}`}>
          {item !== 1 && (
            <div className="mt-1 h-8 w-8 shrink-0 animate-pulse rounded-full bg-white/8" />
          )}
          <div className={`flex max-w-[78%] flex-col gap-2 ${item === 1 ? 'items-end' : 'items-start'}`}>
            <div className="h-20 w-64 max-w-[70vw] animate-pulse rounded-3xl bg-white/[0.06]" />
            <div className="h-3 w-28 animate-pulse rounded-full bg-white/[0.05]" />
          </div>
          {item === 1 && (
            <div className="mt-1 h-8 w-8 shrink-0 animate-pulse rounded-full bg-white/8" />
          )}
        </div>
      ))}
    </div>
  );
}

export default function ChatTimeline({ messages, isLoading = false, onApprovalAction }: ChatTimelineProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  return (
    <section className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
      {isLoading ? (
        <TimelineSkeleton />
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              onApprovalAction={onApprovalAction}
            />
          ))}
          <div ref={endRef} />
        </div>
      )}
    </section>
  );
}
