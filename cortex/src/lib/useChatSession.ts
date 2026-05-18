import { useCallback, useRef, useState } from 'react';
import type { ApprovalState, ChatMessage, ChatProject } from '../types';
import { streamChat } from './cortexApi';

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

const PROJECT: ChatProject = {
  id: 'project-cortex',
  name: 'ClawNet / Cortex',
  environment: 'workspace',
  connectionStatus: 'cortex-server connected',
  environmentState: 'connected',
};

export function useChatSession() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm-init',
      role: 'assistant',
      providerLabel: 'Cortex',
      statusLabel: 'Ready',
      createdAt: new Date().toISOString(),
      content: 'Connected to Cortex. Describe what you need and I\'ll route it to the right provider.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const updateApproval = useCallback((messageId: string, nextState: ApprovalState) => {
    setMessages((cur) =>
      cur.map((m) => {
        if (m.id !== messageId || !m.approvalRequest) return m;
        return { ...m, approvalRequest: { ...m.approvalRequest, state: nextState } };
      }),
    );
  }, []);

  const sendMessage = useCallback(() => {
    const text = draft.trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = {
      id: createId('user'),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    const assistantId = createId('assistant');
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      providerLabel: 'Cortex',
      statusLabel: 'Routing...',
      isStreaming: true,
    };

    setDraft('');
    setIsStreaming(true);
    setMessages((cur) => [...cur, userMsg, assistantMsg]);

    const controller = streamChat(
      text,
      [],
      (event) => {
        switch (event.type) {
          case 'started':
            setMessages((cur) =>
              cur.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      providerLabel: `Cortex · ${event.provider}`,
                      statusLabel: `${event.model} working...`,
                    }
                  : m,
              ),
            );
            break;

          case 'output':
            setMessages((cur) =>
              cur.map((m) => {
                if (m.id !== assistantId) return m;
                const prev = m.content;
                const next = prev ? `${prev}\n\n${event.line}` : (event.line ?? '');
                return { ...m, content: next };
              }),
            );
            break;

          case 'completed':
            setMessages((cur) =>
              cur.map((m) =>
                m.id === assistantId
                  ? { ...m, isStreaming: false, statusLabel: 'Done' }
                  : m,
              ),
            );
            setIsStreaming(false);
            break;

          case 'failed':
            setMessages((cur) =>
              cur.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      isStreaming: false,
                      statusLabel: 'Failed',
                      content: m.content
                        ? `${m.content}\n\nError: ${event.error}`
                        : `Error: ${event.error}`,
                    }
                  : m,
              ),
            );
            setIsStreaming(false);
            break;
        }
      },
      () => {
        setMessages((cur) =>
          cur.map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m,
          ),
        );
        setIsStreaming(false);
      },
      (err) => {
        setMessages((cur) =>
          cur.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  isStreaming: false,
                  statusLabel: 'Connection error',
                  content: `Could not reach Cortex backend: ${err.message}`,
                }
              : m,
          ),
        );
        setIsStreaming(false);
      },
    );

    abortRef.current = controller;
  }, [draft, isStreaming]);

  return {
    project: PROJECT,
    messages,
    draft,
    isStreaming,
    setDraft,
    sendMessage,
    updateApproval,
  };
}
