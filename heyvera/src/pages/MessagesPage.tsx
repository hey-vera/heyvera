import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { ArrowLeft, MessageCircle, Search, Send } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { Conversation, Message } from '../api/types';
import { getConversations, getMessages } from '../api/social';
import { LoadingState, EmptyState } from '../components/shared/AsyncStates';
import { useAuth } from '../hooks/useAuth';
import { useAuthContext } from '../hooks/useAuthContext';
import { useVisibilityPoll } from '../hooks/useVisibilityPoll';
import {
  dmConnectionBanner,
  formatSoftPollAge,
  resolveSoftRealtimeMode,
  softRealtimeLabel,
  softRealtimeTooltip,
  type SoftRealtimeMode,
} from '../utils/softRealtimeLabel';
import {
  nextDmReconnectDelayMs,
  parseSocialDmWsMessage,
  pingPayload,
  socialDmWsUrl,
  subscribePayload,
} from '../utils/socialDmWs';

/* ─── API helper for sending a message ──────────────────────────────────────── */

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/v1/social`
  : '/v1/social';

/** Soft-realtime: messages while a thread is open (honest intermediate before WS). */
const MESSAGES_POLL_MS = 6_000;
/** Soft-realtime: conversation list refresh. */
const CONVERSATIONS_POLL_MS = 20_000;
/** Application-level WS ping interval (server replies with pong). */
const WS_PING_MS = 30_000;
/** When getToken is null, wait before retrying connect (avoid silent spin). */
const TOKEN_RETRY_MS = 15_000;

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

/** Prefer social profile id; fall back to first participant when identity unknown. */
function getOtherParticipant(conversation: Conversation, currentProfileId: string | null) {
  if (currentProfileId) {
    const other = conversation.participants.find((p) => p.id !== currentProfileId);
    if (other) return other;
  }
  return conversation.participants[0];
}

function sameMessageIds(a: Message[], b: Message[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.id !== b[i]?.id) return false;
  }
  return true;
}

function clearUnreadLocal(list: Conversation[], conversationId: string): Conversation[] {
  let changed = false;
  const next = list.map((c) => {
    if (c.id !== conversationId || c.unread_count === 0) return c;
    changed = true;
    return { ...c, unread_count: 0 };
  });
  return changed ? next : list;
}

function bumpUnreadLocal(
  list: Conversation[],
  conversationId: string,
  message: Message,
): Conversation[] {
  return list.map((c) => {
    if (c.id !== conversationId) return c;
    return {
      ...c,
      unread_count: (c.unread_count ?? 0) + 1,
      last_message: message,
    };
  });
}

function readNavigatorOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

/* ─── Main Component ────────────────────────────────────────────────────────── */

export function MessagesPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const { myProfile } = useAuthContext();
  /** Social profile id for isSent / other-participant (not Clerk user id). */
  const viewerProfileId = myProfile?.profile?.id ?? null;

  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkConversationId = searchParams.get('c');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [composeText, setComposeText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  /** Wave 8b/9b: true only when social DM WebSocket is open. */
  const [wsConnected, setWsConnected] = useState(false);
  /** Wave 9b: browser offline (navigator.onLine). */
  const [navigatorOnline, setNavigatorOnline] = useState(readNavigatorOnline);
  /** Wave 9b: WS closed / connecting with backoff. */
  const [reconnecting, setReconnecting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const wsRef = useRef<WebSocket | null>(null);
  const loadMessagesForRef = useRef<
    ((conversationId: string, opts?: { quiet?: boolean }) => Promise<void>) | null
  >(null);

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  /**
   * Status chip: honest about *data transport*.
   * When WS is down but online, label is poll (not Live) even while reconnect runs.
   * Banner uses reconnecting separately so degraded WS still shows connection-lost copy.
   */
  const statusMode: SoftRealtimeMode = useMemo(
    () =>
      resolveSoftRealtimeMode({
        offline: !navigatorOnline,
        wsConnected,
        // Prefer poll over reconnecting for the chip once soft-poll is the transport.
        reconnecting: false,
      }),
    [navigatorOnline, wsConnected],
  );

  const bannerMode: SoftRealtimeMode = useMemo(
    () =>
      resolveSoftRealtimeMode({
        offline: !navigatorOnline,
        wsConnected,
        reconnecting,
      }),
    [navigatorOnline, wsConnected, reconnecting],
  );

  const liveStatusLabel = softRealtimeLabel({ mode: statusMode });
  const liveStatusTooltip = softRealtimeTooltip({
    mode: statusMode,
    ageDetail: formatSoftPollAge(lastUpdatedAt) ?? undefined,
  });

  // Poll is the active message transport when not live (and signed in with a thread).
  const pollActive = Boolean(isSignedIn && selectedId && !wsConnected && navigatorOnline);
  const connectionBanner = dmConnectionBanner({
    mode: bannerMode,
    pollActive,
  });

  /* Load conversations (quiet = background poll: no LoadingState flash). */
  const loadConversations = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!isSignedIn) return;
    const quiet = opts?.quiet ?? false;
    if (!quiet) {
      setLoadingConversations(true);
      setConversationsError(null);
    }
    try {
      const token = await getToken();
      if (!token) return;
      const result = await getConversations(token);
      setConversations(result);
      setLastUpdatedAt(Date.now());
    } catch (err) {
      if (quiet) return;
      setConversationsError(err instanceof Error ? err.message : 'Failed to load conversations');
      setConversations([]);
      setFilteredConversations([]);
    } finally {
      if (!quiet) setLoadingConversations(false);
    }
  }, [getToken, isSignedIn]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // Deep link from Profile "Message" → /messages?c=<conversationId>
  useEffect(() => {
    if (!deepLinkConversationId) return;
    setSelectedId(deepLinkConversationId);
  }, [deepLinkConversationId]);

  const selectConversation = (id: string | null) => {
    setSelectedId(id);
    if (id) {
      setSearchParams({ c: id }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  // Soft-realtime: quiet conversation list poll while signed in.
  useVisibilityPoll(
    () => {
      void loadConversations({ quiet: true });
    },
    CONVERSATIONS_POLL_MS,
    Boolean(isSignedIn),
    { runOnVisible: true },
  );

  /* Filter conversations by search */
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      setFilteredConversations(conversations);
      return;
    }
    setFilteredConversations(
      conversations.filter((c) => {
        const other = getOtherParticipant(c, viewerProfileId);
        if (!other) return false;
        return (
          other.display_name.toLowerCase().includes(q) ||
          other.handle.toLowerCase().includes(q) ||
          c.last_message?.content?.toLowerCase().includes(q)
        );
      }),
    );
  }, [searchQuery, conversations, viewerProfileId]);

  /* Load messages for selected conversation (initial = full load; poll = quiet). */
  const loadMessagesFor = useCallback(
    async (conversationId: string, opts?: { quiet?: boolean }) => {
      const quiet = opts?.quiet ?? false;
      if (!quiet) {
        setLoadingMessages(true);
        setMessagesError(null);
      }
      try {
        const token = await getToken();
        if (!token) return;
        const result = await getMessages(conversationId, token);
        // Avoid re-render/scroll churn when nothing changed.
        setMessages((prev) => (sameMessageIds(prev, result) ? prev : result));
        // Server marks read on GET — clear list badge locally.
        setConversations((prev) => clearUnreadLocal(prev, conversationId));
        setMessagesError(null);
        setLastUpdatedAt(Date.now());
      } catch (err) {
        if (quiet) return;
        setMessagesError(err instanceof Error ? err.message : 'Failed to load messages');
        setMessages([]);
      } finally {
        if (!quiet) setLoadingMessages(false);
      }
    },
    [getToken],
  );
  loadMessagesForRef.current = loadMessagesFor;

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
        if (!cancelled) {
          setMessages(result);
          // Server marks read on GET — clear list badge locally.
          setConversations((prev) => clearUnreadLocal(prev, selectedId!));
          setLastUpdatedAt(Date.now());
        }
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

  // Soft-realtime fallback: quiet message poll when WS is down (Wave 8b/9b).
  useVisibilityPoll(
    () => {
      const id = selectedIdRef.current;
      if (id) void loadMessagesFor(id, { quiet: true });
    },
    MESSAGES_POLL_MS,
    Boolean(isSignedIn && selectedId && !wsConnected),
    { runOnVisible: true },
  );

  // Track browser online/offline for honest labels (never claim Live when offline).
  useEffect(() => {
    const onOnline = () => setNavigatorOnline(true);
    const onOffline = () => setNavigatorOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    setNavigatorOnline(readNavigatorOnline());
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Wave 8b/9b: social DM WebSocket — auth via ?token=, subscribe per conversation.
  // Reconnect: exponential backoff, fresh token each attempt, online + visibility kicks.
  useEffect(() => {
    if (!isSignedIn) {
      setWsConnected(false);
      setReconnecting(false);
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;

    const clearTimers = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const detachSocket = (s: WebSocket | null) => {
      if (!s) return;
      s.onopen = null;
      s.onmessage = null;
      s.onerror = null;
      s.onclose = null;
      try {
        s.close();
      } catch {
        // ignore
      }
    };

    const scheduleReconnect = (delayMs: number) => {
      if (cancelled) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setReconnecting(true);
      setWsConnected(false);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delayMs);
    };

    const connect = async () => {
      if (cancelled) return;
      if (!readNavigatorOnline()) {
        setWsConnected(false);
        setReconnecting(false);
        return;
      }

      setReconnecting(true);

      try {
        // Fresh token each connect attempt.
        const token = await getToken();
        if (cancelled) return;
        if (!token) {
          // Don't spin forever silently — stay on poll with honest label, retry later.
          setWsConnected(false);
          setReconnecting(false);
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void connect();
          }, TOKEN_RETRY_MS);
          return;
        }

        detachSocket(socket);
        if (wsRef.current && wsRef.current !== socket) {
          detachSocket(wsRef.current);
        }
        socket = null;
        wsRef.current = null;

        const url = socialDmWsUrl(token);
        socket = new WebSocket(url);
        wsRef.current = socket;

        socket.onopen = () => {
          if (cancelled) {
            detachSocket(socket);
            return;
          }
          attempt = 0;
          setWsConnected(true);
          setReconnecting(false);

          if (pingTimer) clearInterval(pingTimer);
          pingTimer = setInterval(() => {
            const s = wsRef.current;
            if (s && s.readyState === WebSocket.OPEN) {
              try {
                s.send(pingPayload());
              } catch {
                // ignore send errors; close handler will reconnect
              }
            }
          }, WS_PING_MS);

          const id = selectedIdRef.current;
          if (id && socket?.readyState === WebSocket.OPEN) {
            socket.send(subscribePayload(id));
          }
        };

        socket.onmessage = (ev) => {
          if (typeof ev.data !== 'string') return;
          const event = parseSocialDmWsMessage(ev.data);
          if (!event) return;
          if (event.type === 'message') {
            const activeId = selectedIdRef.current;
            if (event.conversationId === activeId) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === event.message.id)) return prev;
                return [...prev, event.message];
              });
              setLastUpdatedAt(Date.now());
              // Quiet re-GET marks read on server + keeps list honest.
              void loadMessagesForRef.current?.(event.conversationId, { quiet: true });
            } else {
              // Other conversation: bump local unread + last_message.
              setConversations((prev) =>
                bumpUnreadLocal(prev, event.conversationId, event.message),
              );
              setLastUpdatedAt(Date.now());
            }
          }
        };

        socket.onerror = () => {
          // onclose will flip status + soft-poll resumes
        };

        socket.onclose = () => {
          if (wsRef.current === socket) wsRef.current = null;
          if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
          }
          setWsConnected(false);
          if (!cancelled && readNavigatorOnline()) {
            const delay = nextDmReconnectDelayMs(attempt);
            attempt += 1;
            scheduleReconnect(delay);
          } else if (!cancelled) {
            setReconnecting(false);
          }
        };
      } catch {
        setWsConnected(false);
        if (!cancelled && readNavigatorOnline()) {
          const delay = nextDmReconnectDelayMs(attempt);
          attempt += 1;
          scheduleReconnect(delay);
        } else if (!cancelled) {
          setReconnecting(false);
        }
      }
    };

    const onOnline = () => {
      if (cancelled) return;
      attempt = 0;
      clearTimers();
      void connect();
    };

    const onOffline = () => {
      setWsConnected(false);
      setReconnecting(false);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      detachSocket(socket);
      socket = null;
      if (wsRef.current) {
        detachSocket(wsRef.current);
        wsRef.current = null;
      }
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      const open =
        wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING;
      if (open) return;
      attempt = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      void connect();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);

    void connect();

    return () => {
      cancelled = true;
      clearTimers();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      detachSocket(socket);
      if (wsRef.current && wsRef.current !== socket) {
        detachSocket(wsRef.current);
      }
      wsRef.current = null;
      setWsConnected(false);
      setReconnecting(false);
    };
  }, [getToken, isSignedIn]);

  // Resubscribe when the selected conversation changes while WS is live.
  useEffect(() => {
    if (!selectedId || !wsConnected) return;
    const s = wsRef.current;
    if (s && s.readyState === WebSocket.OPEN) {
      s.send(subscribePayload(selectedId));
    }
  }, [selectedId, wsConnected]);

  /* Scroll to bottom when messages change */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* Send message */
  const handleSend = async () => {
    if (!composeText.trim() || !selectedId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const token = await getToken();
      if (!token) {
        setSendError('Sign in again to send.');
        return;
      }
      const newMsg = await sendMessage(token, selectedId, composeText.trim());
      setMessages((current) => [...current, newMsg]);
      setComposeText('');
      setLastUpdatedAt(Date.now());
      // Keep list preview fresh for the open thread.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId ? { ...c, last_message: newMsg, unread_count: 0 } : c,
        ),
      );
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed. Try again.');
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

  const showStatusChrome = isSignedIn && (wsConnected || lastUpdatedAt != null || !navigatorOnline || reconnecting);

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
          className="sticky top-[var(--top-bar-height)] z-10 flex items-center justify-between gap-3 border-b sticky-header-bg px-4 py-3 backdrop-blur-md"
          style={{ borderColor: 'var(--border-primary)' }}
        >
          <h1 className="text-[20px] font-bold">Messages</h1>
          {showStatusChrome && (
            <span
              className="flex items-center gap-1.5 text-[12px] font-medium"
              style={{ color: 'var(--text-secondary)' }}
              role="status"
              title={liveStatusTooltip}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor:
                    statusMode === 'offline' ? 'var(--text-secondary)' : 'var(--accent)',
                  opacity: statusMode === 'live' ? 1 : 0.55,
                }}
                aria-hidden="true"
              />
              {liveStatusLabel}
            </span>
          )}
        </div>

        {/* Wave 9b: scoped connection honesty banner (not app-global). */}
        {connectionBanner && (
          <div
            className="border-b px-4 py-2 text-[13px]"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'color-mix(in srgb, var(--accent) 12%, var(--bg-elevated))',
              color: 'var(--text-primary)',
            }}
            role="status"
            data-testid="dm-connection-banner"
          >
            {connectionBanner}
          </div>
        )}

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
              aria-label="Search conversations"
              className="w-full rounded-full border py-2 pl-9 pr-3 text-[14px] outline-none transition-colors focus:border-[var(--accent)] focus-ring"
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
              const other = getOtherParticipant(convo, viewerProfileId);
              if (!other) return null;
              const isActive = convo.id === selectedId;
              return (
                <button
                  key={convo.id}
                  type="button"
                  onClick={() => selectConversation(convo.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover-overlay focus-visible:outline-none focus-ring"
                  style={{
                    backgroundColor: isActive ? 'var(--bg-elevated)' : undefined,
                  }}
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={
                    convo.unread_count > 0
                      ? `${other.display_name}, ${convo.unread_count} unread`
                      : other.display_name
                  }
                >
                  {/* Avatar */}
                  {other.avatar_url ? (
                    <img
                      src={other.avatar_url}
                      alt=""
                      className="h-10 w-10 flex-shrink-0 rounded-full object-cover"
                      style={{ backgroundColor: 'var(--border-primary)' }}
                      aria-hidden="true"
                    />
                  ) : (
                    <div
                      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold"
                      style={{ backgroundColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                      aria-hidden="true"
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
                        aria-hidden="true"
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
                onClick={() => selectConversation(null)}
                className="rounded-full p-1.5 transition-colors hover-overlay lg:hidden"
                style={{ color: 'var(--text-primary)' }}
                aria-label="Back to conversations"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              {(() => {
                const other = getOtherParticipant(selectedConversation, viewerProfileId);
                if (!other) return null;
                return (
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
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
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-bold leading-tight">{other.display_name}</p>
                        <p className="truncate text-[13px] leading-tight" style={{ color: 'var(--text-secondary)' }}>
                          @{other.handle}
                        </p>
                      </div>
                    </div>
                    {showStatusChrome && (
                      <span
                        className="hidden shrink-0 items-center gap-1.5 text-[12px] font-medium sm:flex"
                        style={{ color: 'var(--text-secondary)' }}
                        role="status"
                        title={liveStatusTooltip}
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{
                            backgroundColor: 'var(--accent)',
                            opacity: statusMode === 'live' ? 1 : 0.55,
                          }}
                          aria-hidden="true"
                        />
                        {liveStatusLabel}
                      </span>
                    )}
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
                  const isSent = Boolean(viewerProfileId && msg.sender.id === viewerProfileId);
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
              {sendError && (
                <p className="mb-2 text-[13px]" style={{ color: 'var(--color-danger)' }} role="alert">
                  {sendError}
                </p>
              )}
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={composeText}
                  onChange={(e) => {
                    setComposeText(e.target.value);
                    if (sendError) setSendError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Start a new message"
                  aria-label="Message composer"
                  className="flex-1 rounded-full border px-4 py-2.5 text-[15px] outline-none transition-colors focus:border-[var(--accent)] focus-ring"
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
                  className="flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-ring"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
                  aria-label="Send message"
                >
                  <Send className="h-5 w-5" aria-hidden="true" />
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
