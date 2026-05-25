import { useEffect, useMemo, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { ArrowLeft, MessageCircle, Search } from 'lucide-react';
import { getConversations, getMessages } from '../api/client';
import type { Conversation, Message, UserSummary } from '../api/types';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/AsyncStates';
import { useAuth } from '../hooks/useAuth';

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();

  if (Number.isNaN(date.getTime()) || diffMs < 0) return '';

  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getConversationPeer(conversation: Conversation): UserSummary | undefined {
  return conversation.participants[1] ?? conversation.participants[0];
}

function getConversationTitle(conversation: Conversation): string {
  const peer = getConversationPeer(conversation);
  return peer?.display_name ?? 'Conversation';
}

function getConversationHandle(conversation: Conversation): string {
  const peer = getConversationPeer(conversation);
  return peer ? `@${peer.handle}` : '';
}

export function MessagesPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [conversationsReloadKey, setConversationsReloadKey] = useState(0);
  const [messagesReloadKey, setMessagesReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadConversations() {
      setConversationsLoading(true);
      setConversationsError(null);

      try {
        if (authEnabled && !isSignedIn) {
          if (!cancelled) {
            setConversations([]);
            setSelectedId(null);
          }
          return;
        }

        const token = authEnabled ? await getToken() : null;
        const items = await getConversations(token ?? undefined);
        if (!cancelled) {
          setConversations(items);
          setSelectedId((current) => current ?? items[0]?.id ?? null);
        }
      } catch (err) {
        if (!cancelled) setConversationsError(err instanceof Error ? err.message : 'Unable to load conversations');
      } finally {
        if (!cancelled) setConversationsLoading(false);
      }
    }

    void loadConversations();
    return () => {
      cancelled = true;
    };
  }, [authEnabled, isSignedIn, conversationsReloadKey]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setMessagesError(null);
      setMessagesLoading(false);
      return;
    }

    let cancelled = false;
    const conversationId = selectedId;

    async function loadMessages() {
      setMessagesLoading(true);
      setMessagesError(null);

      try {
        const token = authEnabled ? await getToken() : null;
        const items = await getMessages(conversationId, token ?? undefined);
        if (!cancelled) setMessages(items);
      } catch (err) {
        if (!cancelled) setMessagesError(err instanceof Error ? err.message : 'Unable to load messages');
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    }

    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [authEnabled, selectedId, messagesReloadKey]);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return conversations;

    return conversations.filter((conversation) => {
      const title = getConversationTitle(conversation).toLowerCase();
      const handle = getConversationHandle(conversation).toLowerCase();
      const lastMessage = conversation.last_message.content.toLowerCase();
      return title.includes(query) || handle.includes(query) || lastMessage.includes(query);
    });
  }, [conversations, search]);

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const selectedPeer = selectedConversation ? getConversationPeer(selectedConversation) : undefined;
  const viewerId = selectedConversation?.participants[0]?.id;
  const showChatOnMobile = selectedConversation !== null;

  return (
    <div
      className="relative z-20 flex min-h-screen w-full"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <div
        className={`${showChatOnMobile ? 'hidden md:flex' : 'flex'} w-full flex-col border-r md:w-[360px] md:flex-shrink-0 xl:w-[380px]`}
        style={{ borderColor: 'var(--border-primary)' }}
      >
        <div className="sticky top-[var(--top-bar-height)] z-10 border-b bg-black/80 px-4 py-3 backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)' }}>
          <h1 className="text-[20px] font-bold">Messages</h1>
        </div>

        <div className="px-4 py-3">
          <div className="relative">
            <Search
              className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
              style={{ color: 'var(--text-secondary)' }}
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Search Messages"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-full border py-2.5 pl-10 pr-4 text-[15px] outline-none transition-colors"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversationsLoading && <LoadingState label="Loading conversations" />}
          {!conversationsLoading && authEnabled && !isSignedIn && <SignedOutMessagesPrompt />}
          {!conversationsLoading && conversationsError && (
            <ErrorState detail={conversationsError} onRetry={() => setConversationsReloadKey((key) => key + 1)} />
          )}
          {!conversationsLoading && !(authEnabled && !isSignedIn) && !conversationsError && conversations.length === 0 && (
            <EmptyState title="No messages yet" detail="Conversations will appear here when someone messages you." />
          )}
          {!conversationsLoading && !(authEnabled && !isSignedIn) && !conversationsError && conversations.length > 0 && filteredConversations.length === 0 && (
            <EmptyState title="No results" detail="Try searching for a different name, handle, or message." />
          )}
          {!conversationsLoading && !(authEnabled && !isSignedIn) && !conversationsError && filteredConversations.map((conversation) => {
            const peer = getConversationPeer(conversation);
            const selected = selectedId === conversation.id;
            const unread = conversation.unread_count > 0;

            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => setSelectedId(conversation.id)}
                className="flex w-full gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-white/5"
                style={{
                  backgroundColor: selected ? 'var(--bg-hover)' : 'transparent',
                  borderColor: 'var(--border-primary)',
                }}
              >
                {peer?.avatar_url ? (
                  <img
                    src={peer.avatar_url}
                    alt={peer.display_name}
                    className="h-10 w-10 flex-shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 flex-shrink-0 rounded-full" style={{ backgroundColor: 'var(--border-primary)' }} />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-bold">{getConversationTitle(conversation)}</span>
                    <span className="flex-shrink-0 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                      {formatRelativeTime(conversation.last_message.created_at)}
                    </span>
                  </div>
                  <p className="truncate text-[14px]" style={{ color: unread ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {conversation.last_message.content}
                  </p>
                  <p className="truncate text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                    {getConversationHandle(conversation)}
                  </p>
                </div>

                {unread && (
                  <div
                    className="h-2.5 w-2.5 flex-shrink-0 self-center rounded-full"
                    style={{ backgroundColor: 'var(--accent)' }}
                    aria-label={`${conversation.unread_count} unread`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`${showChatOnMobile ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {selectedConversation ? (
          <>
            <div className="sticky top-[var(--top-bar-height)] z-10 flex items-center gap-3 border-b bg-black/80 px-4 py-3 backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)' }}>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded-full p-2 transition-colors hover:bg-white/5 md:hidden"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              {selectedPeer?.avatar_url && (
                <img
                  src={selectedPeer.avatar_url}
                  alt={selectedPeer.display_name}
                  className="h-9 w-9 rounded-full object-cover"
                />
              )}
              <div className="min-w-0">
                <h2 className="truncate text-[20px] font-bold">{getConversationTitle(selectedConversation)}</h2>
                <p className="truncate text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                  {getConversationHandle(selectedConversation)}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {messagesLoading && <LoadingState label="Loading messages" />}
              {!messagesLoading && messagesError && (
                <ErrorState detail={messagesError} onRetry={() => setMessagesReloadKey((key) => key + 1)} />
              )}
              {!messagesLoading && !messagesError && messages.length === 0 && (
                <EmptyState title="No messages" detail="This conversation does not have any messages yet." />
              )}
              {!messagesLoading && !messagesError && messages.length > 0 && (
                <div className="flex flex-col gap-4">
                  {messages.map((message) => {
                    const isViewer = Boolean(viewerId && message.sender.id === viewerId);

                    return (
                      <article key={message.id} className={`flex gap-3 ${isViewer ? 'justify-end' : 'justify-start'}`}>
                        {!isViewer && (
                          <img
                            src={message.sender.avatar_url}
                            alt={message.sender.display_name}
                            className="mt-auto h-8 w-8 flex-shrink-0 rounded-full object-cover"
                          />
                        )}
                        <div className={`max-w-[78%] ${isViewer ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                          <div
                            className="rounded-3xl px-4 py-2 text-[15px] leading-normal"
                            style={{
                              backgroundColor: isViewer ? 'var(--accent)' : 'var(--bg-elevated)',
                              color: isViewer ? 'var(--bg-primary)' : 'var(--text-primary)',
                            }}
                          >
                            {message.content}
                          </div>
                          <span className="px-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                            {message.sender.display_name} · {formatRelativeTime(message.created_at)}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
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
                Choose from your existing conversations to view messages.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
