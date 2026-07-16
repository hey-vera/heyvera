import { useCallback, useEffect, useRef, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { ArrowLeft, MessageCircle, Search, Send } from 'lucide-react';
import type { Conversation, Message } from '../api/types';
import { getConversations, getMessages } from '../api/social';
import { LoadingState, EmptyState } from '../components/shared/AsyncStates';
import { useAuth } from '../hooks/useAuth';

/* ─── API helper for sending a message ──────────────────────────────────────── */

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/v1/social`
  : '/v1/social';

async function sendMessage(
  token: string,
  conversationId: string,
  content: string,
): Promise<Message> {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<Message>;
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getOtherParticipant(conversation: Conversation, currentUserId: string | null) {
  const other = conversation.participants.find((p) => p.id !== currentUserId);
  return other ?? conversation.participants[0];
}

/* ─── Main Component ────────────────────────────────────────────────────────── */

export function MessagesPage() {
  const { authEnabled, isSignedIn, getToken, userId } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [composeText, setComposeText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  /* Load conversations */
  const loadConversations = useCallback(async () => {
    if (!isSignedIn) return;
    setLoadingConversations(true);
    setConversationsError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const result = await getConversations(token);
      setConversations(result);
      setFilteredConversations(result);
    } catch (err) {
      setConversationsError(err instanceof Error ? err.message : 'Failed to load conversations');
      setConversations([]);
      setFilteredConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, [getToken, isSignedIn]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  /* Filter conversations by search */
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      setFilteredConversations(conversations);
      return;
    }
    setFilteredConversations(
      conversations.filter((c) => {
        const other = getOtherParticipant(c, userId);
        if (!other) return false;
        return (
          other.display_name.toLowerCase().includes(q) ||
          other.handle.toLowerCase().includes(q) ||
          c.last_message?.content?.toLowerCase().includes(q)
        );
      }),
    );
  }, [searchQuery, conversations, userId]);

  /* Load messages for selected conversation */
  useEffect(() => {
    if (!selectedId || !isSignedIn) {
      setMessages([]);
      return;
    }
    let cancelled = false;

    async function load() {
      setLoadingMessages(true);
      setMessagesError(null);
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const result = await getMessages(selectedId!, token);
        if (!cancelled) setMessages(result);
      } catch (err) {
        if (!cancelled) {
          setMessagesError(err instanceof Error ? err.message : 'Failed to load messages');
          setMessages([]);
        }
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedId, getToken, isSignedIn]);

  /* Scroll to bottom when messages change */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* Send message */
  const handleSend = async () => {
    if (!composeText.trim() || !selectedId || sending) return;
    setSending(true);
    try {
      const token = await getToken();
      if (!token) return;
      const newMsg = await sendMessage(token, selectedId, composeText.trim());
      setMessages((current) => [...current, newMsg]);
      setComposeText('');
    } catch {
      // Silently handle — the user can retry
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  /* Not signed in */
  if (authEnabled && !isSignedIn) {
    return (
      <div
        className="relative z-20 flex min-h-screen w-full"
        style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
      >
        <div className="flex w-full flex-col">
          <div
            className="sticky top-[var(--top-bar-height)] z-10 border-b sticky-header-bg px-4 py-3 backdrop-blur-md"
            style={{ borderColor: 'var(--border-primary)' }}
          >
            <h1 className="text-[20px] font-bold">Messages</h1>
          </div>
          <div
            className="border-b px-4 py-2 text-[13px]"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
            }}
            role="status"
          >
            Messages are early access — conversations load from the real API; polish and extras are still in progress.
          </div>
          <SignedOutMessagesPrompt />
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative z-20 flex min-h-screen w-full"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      {/* ─── Left Panel: Conversation List ────────────────────────────────── */}
      <div
        className={`flex w-full flex-col border-r lg:w-[320px] lg:flex-shrink-0 ${
          selectedId ? 'hidden lg:flex' : 'flex'
        }`}
        style={{ borderColor: 'var(--border-primary)' }}
      >
        {/* Header */}
        <div
          className="sticky top-[var(--top-bar-height)] z-10 border-b sticky-header-bg px-4 py-3 backdrop-blur-md"
          style={{ borderColor: 'var(--border-primary)' }}
        >
          <h1 className="text-[20px] font-bold">Messages</h1>
        </div>

        <div
          className="border-b px-4 py-2 text-[13px]"
          style={{
            borderColor: 'var(--border-primary)',
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
          }}
          role="status"
        >
          Messages are early access — conversations load from the real API; polish and extras are still in progress.
        </div>

        {/* Search */}
        <div className="px-3 py-2">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
              style={{ color: 'var(--text-secondary)' }}
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations"
              className="w-full rounded-full border py-2 pl-9 pr-3 text-[14px] outline-none transition-colors focus:border-[var(--accent)]"
              style={{
                borderColor: 'var(--border-primary)',
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loadingConversations && <LoadingState label="Loading conversations" />}

          {!loadingConversations && conversationsError && (
            <div className="px-4 py-6 text-center">
              <p className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>
                {conversationsError}
              </p>
            </div>
          )}

          {!loadingConversations && !conversationsError && filteredConversations.length === 0 && (
            <EmptyState
              title="No conversations yet"
              detail="Start a conversation by messaging someone from their profile."
            />
          )}

          {!loadingConversations &&
            !conversationsError &&
            filteredConversations.map((convo) => {
              const other = getOtherParticipant(convo, userId);
              if (!other) return null;
              const isActive = convo.id === selectedId;
              return (
                <button
                  key={convo.id}
                  type="button"
                  onClick={() => setSelectedId(convo.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover-overlay"
                  style={{
                    backgroundColor: isActive ? 'var(--bg-elevated)' : undefined,
                  }}
                >
                  {/* Avatar */}
                  {other.avatar_url ? (
                    <img
                      src={other.avatar_url}
                      alt={other.display_name}
                      className="h-10 w-10 flex-shrink-0 rounded-full object-cover"
                      style={{ backgroundColor: 'var(--border-primary)' }}
                    />
                  ) : (
                    <div
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold"
                      style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                    >
                      {other.display_name.charAt(0).toUpperCase()}
                    </div>
                  )}

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span
                        className="truncate text-[15px] font-bold"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {other.display_name}
                      </span>
                      <span
                        className="ml-2 flex-shrink-0 text-[13px]"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {convo.last_message ? formatTimestamp(convo.last_message.created_at) : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <p
                        className="truncate text-[14px]"
                        style={{
                          color: convo.unread_count > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontWeight: convo.unread_count > 0 ? 600 : 400,
                        }}
                      >
                        {convo.last_message?.content ?? 'No messages yet'}
                      </p>
                      {convo.unread_count > 0 && (
                        <span
                          className="flex h-5 min-w-[20px] flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold"
                          style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
                        >
                          {convo.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      </div>

      {/* ─── Right Panel: Message Thread ──────────────────────────────────── */}
      <div
        className={`flex flex-1 flex-col ${
          selectedId ? 'flex' : 'hidden lg:flex'
        }`}
      >
        {!selectedConversation ? (
          /* Empty state — no conversation selected */
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <div
                className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
              >
                <MessageCircle className="h-7 w-7" aria-hidden="true" />
              </div>
              <p className="text-[20px] font-bold">Select a conversation</p>
              <p className="mt-1 text-[15px]" style={{ color: 'var(--text-secondary)' }}>
                Choose a conversation from the list to start messaging.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div
              className="sticky top-[var(--top-bar-height)] z-10 flex items-center gap-3 border-b sticky-header-bg px-4 py-3 backdrop-blur-md"
              style={{ borderColor: 'var(--border-primary)' }}
            >
              {/* Back button (mobile only) */}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded-full p-1.5 transition-colors hover-overlay lg:hidden"
                style={{ color: 'var(--text-primary)' }}
                aria-label="Back to conversations"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              {(() => {
                const other = getOtherParticipant(selectedConversation, userId);
                if (!other) return null;
                return (
                  <div className="flex items-center gap-3">
                    {other.avatar_url ? (
                      <img
                        src={other.avatar_url}
                        alt={other.display_name}
                        className="h-8 w-8 rounded-full object-cover"
                        style={{ backgroundColor: 'var(--border-primary)' }}
                      />
                    ) : (
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold"
                        style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                      >
                        {other.display_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-[15px] font-bold leading-tight">{other.display_name}</p>
                      <p className="text-[13px] leading-tight" style={{ color: 'var(--text-secondary)' }}>
                        @{other.handle}
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {loadingMessages && <LoadingState label="Loading messages" />}

              {!loadingMessages && messagesError && (
                <div className="py-6 text-center">
                  <p className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>
                    {messagesError}
                  </p>
                </div>
              )}

              {!loadingMessages && !messagesError && messages.length === 0 && (
                <div className="flex flex-1 items-center justify-center py-12 text-center">
                  <p className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>
                    No messages yet. Say hello!
                  </p>
                </div>
              )}

              {!loadingMessages &&
                !messagesError &&
                messages.map((msg) => {
                  const isSent = msg.sender.id === userId;
                  return (
                    <div
                      key={msg.id}
                      className={`mb-3 flex ${isSent ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className="max-w-[75%] rounded-2xl px-4 py-2.5"
                        style={{
                          backgroundColor: isSent ? 'var(--accent)' : 'var(--bg-elevated)',
                          color: isSent ? '#000' : 'var(--text-primary)',
                        }}
                      >
                        <p className="text-[15px] leading-relaxed">{msg.content}</p>
                        <p
                          className="mt-1 text-right text-[11px]"
                          style={{
                            color: isSent
                              ? 'rgba(0, 0, 0, 0.5)'
                              : 'var(--text-secondary)',
                          }}
                        >
                          {formatTimestamp(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              <div ref={messagesEndRef} />
            </div>

            {/* Compose bar */}
            <div
              className="border-t px-4 py-3"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
            >
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Start a new message"
                  className="flex-1 rounded-full border px-4 py-2.5 text-[15px] outline-none transition-colors focus:border-[var(--accent)]"
                  style={{
                    borderColor: 'var(--border-primary)',
                    backgroundColor: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!composeText.trim() || sending}
                  className="flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
                  aria-label="Send message"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Signed-out prompt ─────────────────────────────────────────────────────── */

function SignedOutMessagesPrompt() {
  return (
    <div className="px-4 py-8">
      <h2 className="text-[20px] font-bold">Sign in to see messages</h2>
      <p className="mt-2 text-[15px]" style={{ color: 'var(--text-secondary)' }}>
        Your conversations and replies will appear here after you sign in.
      </p>
      <SignInButton mode="modal">
        <button
          type="button"
          className="mt-5 rounded-full px-5 py-2 text-[15px] font-bold"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
        >
          Sign in
        </button>
      </SignInButton>
    </div>
  );
}

export default MessagesPage;
