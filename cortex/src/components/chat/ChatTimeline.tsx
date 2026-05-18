import { useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import type { ApprovalState, ChatMessage as ChatMessageType } from '../../types';

interface ChatTimelineProps {
  messages: ChatMessageType[];
  onApprovalAction: (messageId: string, nextState: ApprovalState) => void;
}

export default function ChatTimeline({ messages, onApprovalAction }: ChatTimelineProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  return (
    <section className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
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
    </section>
  );
}
