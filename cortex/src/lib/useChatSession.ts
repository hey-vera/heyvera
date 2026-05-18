import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApprovalState, ChatMessage, ChatProject } from '../types';
import {
  addMessageToConversation,
  createConversation,
  getConversation,
  streamChat,
  updateConversationTitle,
  type ConversationMessage,
} from './cortexApi';

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

function getEmptyMessages(): ChatMessage[] {
  return [
    {
      id: 'm-init',
      role: 'assistant',
      providerLabel: 'Cortex',
      statusLabel: 'Ready',
      createdAt: new Date().toISOString(),
      content: 'Connected to Cortex. Describe what you need and I\'ll route it to the right provider.',
    },
  ];
}

function formatProviderLabel(provider?: string | null) {
  return provider ? `Cortex · ${provider}` : 'Cortex';
}

function formatStatusLabel(model?: string | null) {
  return model ? `${model}` : 'Ready';
}

function mapConversationMessage(message: ConversationMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.created_at,
    provider: message.provider ?? undefined,
    model: message.model ?? undefined,
    providerLabel: message.role === 'assistant' ? formatProviderLabel(message.provider) : undefined,
    statusLabel: message.role === 'assistant' ? formatStatusLabel(message.model) : undefined,
  };
}

function truncateTitle(text: string) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 60) return normalized;
  return `${normalized.slice(0, 57).trimEnd()}...`;
}

interface UseChatSessionOptions {
  activeConversationId: string | null;
  userId: string;
  onConversationCreated: (conversationId: string) => void;
  onConversationsChanged: () => void;
}

export function useChatSession({
  activeConversationId,
  userId,
  onConversationCreated,
  onConversationsChanged,
}: UseChatSessionOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>(getEmptyMessages);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const requestVersionRef = useRef(0);
  const skipNextConversationLoadRef = useRef<string | null>(null);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (
      activeConversationId &&
      skipNextConversationLoadRef.current === activeConversationId
    ) {
      skipNextConversationLoadRef.current = null;
      return;
    }

    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);

    const requestVersion = ++requestVersionRef.current;

    if (!activeConversationId) {
      setMessages(getEmptyMessages());
      return;
    }

    setMessages([]);

    void (async () => {
      try {
        const conversation = await getConversation(activeConversationId, userId);
        if (requestVersionRef.current !== requestVersion) return;

        setMessages(
          conversation.messages.length > 0
            ? conversation.messages.map(mapConversationMessage)
            : getEmptyMessages(),
        );
      } catch {
        if (requestVersionRef.current !== requestVersion) return;
        setMessages([
          {
            id: 'm-load-error',
            role: 'assistant',
            providerLabel: 'Cortex',
            statusLabel: 'Load failed',
            createdAt: new Date().toISOString(),
            content: 'Could not load this conversation.',
          },
        ]);
      }
    })();
  }, [activeConversationId, userId]);

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
      provider: 'cortex',
      providerLabel: 'Cortex',
      statusLabel: 'Routing...',
      isStreaming: true,
    };

    setDraft('');
    setIsStreaming(true);
    setMessages((cur) => [...cur, userMsg, assistantMsg]);

    void (async () => {
      const streamVersion = requestVersionRef.current;
      const hadPriorUserMessage = messagesRef.current.some(
        (message) => message.role === 'user',
      );
      let conversationId = activeConversationIdRef.current;
      let assistantContent = '';
      let assistantProvider: string | undefined;
      let assistantModel: string | undefined;
      let finalized = false;

      const persistAssistant = async (content: string) => {
        if (!conversationId || finalized) return;
        finalized = true;
        try {
          await addMessageToConversation(
            conversationId,
            'assistant',
            content,
            assistantProvider,
            assistantModel,
          );
          onConversationsChanged();
        } catch {
          // keep local transcript even if persistence fails
        }
      };

      const finalizeAssistant = (next: Partial<ChatMessage>, content?: string) => {
        const finalContent = content ?? assistantContent;
        setMessages((cur) =>
          cur.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  ...next,
                  content: finalContent,
                }
              : message,
          ),
        );
        setIsStreaming(false);
        void persistAssistant(finalContent);
      };

      try {
        if (!conversationId) {
          const created = await createConversation(userId);
          conversationId = created.id;
          activeConversationIdRef.current = created.id;
          skipNextConversationLoadRef.current = created.id;
          onConversationCreated(created.id);
          onConversationsChanged();
        }

        await addMessageToConversation(conversationId, 'user', text);

        if (!hadPriorUserMessage) {
          void updateConversationTitle(conversationId, truncateTitle(text), userId)
            .then(() => {
              onConversationsChanged();
            })
            .catch(() => {
              // keep chat flow moving if titling fails
            });
        }

        if (requestVersionRef.current !== streamVersion) return;

        const controller = streamChat(
          text,
          [],
          (event) => {
            if (requestVersionRef.current !== streamVersion) return;

            switch (event.type) {
              case 'started':
                assistantProvider = event.provider ?? assistantProvider;
                assistantModel = event.model ?? assistantModel;
                setMessages((cur) =>
                  cur.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          provider: assistantProvider,
                          model: assistantModel,
                          providerLabel: formatProviderLabel(assistantProvider),
                          statusLabel: assistantModel ? `${assistantModel} working...` : 'Working...',
                        }
                      : m,
                  ),
                );
                break;

              case 'output':
                assistantContent = assistantContent
                  ? `${assistantContent}\n\n${event.line ?? ''}`
                  : (event.line ?? '');
                setMessages((cur) =>
                  cur.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: assistantContent }
                      : m,
                  ),
                );
                break;

              case 'completed':
                finalizeAssistant({
                  provider: assistantProvider,
                  model: assistantModel,
                  providerLabel: formatProviderLabel(assistantProvider),
                  statusLabel: 'Done',
                  isStreaming: false,
                });
                break;

              case 'failed': {
                const failedContent = assistantContent
                  ? `${assistantContent}\n\nError: ${event.error}`
                  : `Error: ${event.error}`;
                assistantContent = failedContent;
                finalizeAssistant({
                  provider: assistantProvider,
                  model: assistantModel,
                  providerLabel: formatProviderLabel(assistantProvider),
                  statusLabel: 'Failed',
                  isStreaming: false,
                }, failedContent);
                break;
              }
            }
          },
          () => {
            if (requestVersionRef.current !== streamVersion || finalized) return;
            finalizeAssistant({
              provider: assistantProvider,
              model: assistantModel,
              providerLabel: formatProviderLabel(assistantProvider),
              statusLabel: 'Done',
              isStreaming: false,
            });
          },
          (err) => {
            if (requestVersionRef.current !== streamVersion || finalized) return;
            const errorContent = assistantContent
              ? `${assistantContent}\n\nError: Could not reach Cortex backend: ${err.message}`
              : `Could not reach Cortex backend: ${err.message}`;
            assistantContent = errorContent;
            finalizeAssistant({
              provider: assistantProvider,
              model: assistantModel,
              providerLabel: formatProviderLabel(assistantProvider),
              statusLabel: 'Connection error',
              isStreaming: false,
            }, errorContent);
          },
        );

        abortRef.current = controller;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setMessages((cur) =>
          cur.map((entry) =>
            entry.id === assistantId
              ? {
                  ...entry,
                  isStreaming: false,
                  statusLabel: 'Failed',
                  content: `Could not send message: ${message}`,
                }
              : entry,
          ),
        );
        setIsStreaming(false);
        if (conversationId) {
          void persistAssistant(`Could not send message: ${message}`);
        }
      }
    })();
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
