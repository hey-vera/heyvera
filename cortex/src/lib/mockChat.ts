import { useCallback, useMemo, useRef, useState } from 'react';
import {
  createMockAssistantReply,
  getInitialMessages,
  getMockProject,
} from './mockChatApi';
import type { ApprovalState, ChatMessage } from '../types';

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function useMockChatSession() {
  const project = useMemo(() => getMockProject(), []);
  const [messages, setMessages] = useState<ChatMessage[]>(() => getInitialMessages());
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const streamTokenRef = useRef(0);

  const updateApproval = useCallback((messageId: string, nextState: ApprovalState) => {
    setMessages((currentMessages) =>
      currentMessages.map((message) => {
        if (!message.approvalRequest || message.id !== messageId) return message;

        return {
          ...message,
          approvalRequest: {
            ...message.approvalRequest,
            state: nextState,
          },
        };
      }),
    );
  }, []);

  const sendMessage = useCallback(() => {
    const text = draft.trim();
    if (!text || isStreaming) return;

    const userMessage: ChatMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    const assistantId = createMessageId('assistant');
    const reply = createMockAssistantReply(text, assistantId);
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      providerLabel: reply.providerLabel,
      statusLabel: reply.statusLabel,
      isStreaming: true,
    };

    streamTokenRef.current += 1;
    const streamToken = streamTokenRef.current;

    setDraft('');
    setIsStreaming(true);
    setMessages((currentMessages) => [...currentMessages, userMessage, assistantMessage]);

    reply.steps.forEach((step, index) => {
      window.setTimeout(() => {
        if (streamTokenRef.current !== streamToken) return;

        const isLastStep = index === reply.steps.length - 1;
        setMessages((currentMessages) =>
          currentMessages.map((message) => {
            if (message.id !== assistantId) return message;

            return {
              ...message,
              content: message.content ? `${message.content}\n\n${step.content}` : step.content,
              isStreaming: !isLastStep,
              approvalRequest: isLastStep ? reply.approvalRequest : undefined,
            };
          }),
        );

        if (isLastStep) {
          setIsStreaming(false);
        }
      }, step.delayMs);
    });
  }, [draft, isStreaming]);

  return {
    project,
    messages,
    draft,
    isStreaming,
    setDraft,
    sendMessage,
    updateApproval,
  };
}
