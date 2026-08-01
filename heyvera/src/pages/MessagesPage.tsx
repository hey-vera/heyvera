import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { ArrowLeft, MessageCircle, Search, Send } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { Conversation, Message } from '../api/types';
import {
  getConversations,
  getConversation,
  getMessages,
  issueSocialDmWsTicket,
  markConversationRead,
  sendMessage,
  SOCIAL_DM_MAX_MESSAGE_CHARS,
} from '../api/social';
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
  unsubscribePayload,
} from '../utils/socialDmWs';
import { mergeMessageHistory } from '../utils/messageHistory';
import {
  appendConversationPage,
  mergeConversationHead,
  promoteConversation,
} from '../utils/conversationList';

/** Soft-realtime: messages while a thread is open (honest intermediate before WS). */
const MESSAGES_POLL_MS = 6_000;
/** Soft-realtime: conversation list refresh. */
const CONVERSATIONS_POLL_MS = 20_000;
/** Application-level WS ping interval (server replies with pong). */
const WS_PING_MS = 30_000;
/** When getToken is null, wait before retrying connect (avoid silent spin). */
const TOKEN_RETRY_MS = 15_000;

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

function updateUnreadLocal(
  list: Conversation[],
  conversationId: string,
  unreadCount: number,
): Conversation[] {
  return list.map((conversation) =>
    conversation.id === conversationId
      ? { ...conversation, unread_count: unreadCount }
      : conversation,
  );
}

function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function bumpUnreadLocal(
  list: Conversation[],
  conversationId: string,
  message: Message,
): Conversation[] {
  return promoteConversation(list, conversationId, (conversation) => ({
    ...conversation,
    unread_count: (conversation.unread_count ?? 0) + 1,
    last_message: message,
  }));
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
  const [nextConversationCursor, setNextConversationCursor] = useState<string | null>(null);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [moreConversationsError, setMoreConversationsError] = useState<string | null>(null);
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextMessagesCursor, setNextMessagesCursor] = useState<string | null>(null);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [olderMessagesError, setOlderMessagesError] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [composeText, setComposeText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [selectedConversationError, setSelectedConversationError] = useState<string | null>(null);
  /** True only after the socket subscription is acknowledged and durable catch-up completes. */
  const [wsConnected, setWsConnected] = useState(false);
  /** Wave 9b: browser offline (navigator.onLine). */
  const [navigatorOnline, setNavigatorOnline] = useState(readNavigatorOnline);
  /** Wave 9b: WS closed / connecting with backoff. */
  const [reconnecting, setReconnecting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesScrollerRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const wsRef = useRef<WebSocket | null>(null);
  const viewerProfileIdRef = useRef<string | null>(viewerProfileId);
  viewerProfileIdRef.current = viewerProfileId;
  const loadMessagesForRef = useRef<
    ((conversationId: string, opts?: { quiet?: boolean }) => Promise<void>) | null
  >(null);

  const recoverMessagesForRef = useRef<
    ((conversationId: string) => Promise<void>) | null
  >(null);
  const messageSyncCursorsRef = useRef(new Map<string, string>());
  const readAckRef = useRef<string | null>(null);
  const pendingSendRef = useRef<
    { conversationId: string; content: string; clientMessageId: string } | null
  >(null);
  const subscribedConversationRef = useRef<string | null>(null);
  const loadedOlderConversationsRef = useRef(false);
  const deepLinkHydrationRef = useRef<string | null>(null);
  const shouldScrollToEndRef = useRef(true);

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

  /* Load conversations (quiet = background head refresh without discarding older pages). */
  const loadConversations = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!isSignedIn) return;
    const quiet = opts?.quiet ?? false;
    if (!quiet) {
      loadedOlderConversationsRef.current = false;
      setLoadingConversations(true);
      setConversationsError(null);
      setMoreConversationsError(null);
    }
    try {
      const token = await getToken();
      if (!token) return;
      const page = await getConversations(token);
      setConversations((current) =>
        quiet ? mergeConversationHead(current, page.conversations) : page.conversations,
      );
      if (!quiet || !loadedOlderConversationsRef.current) {
        setNextConversationCursor(page.next_cursor);
      }
      setLastUpdatedAt(Date.now());
    } catch (err) {
      if (quiet) return;
      setConversationsError(err instanceof Error ? err.message : 'Failed to load conversations');
      setConversations([]);
      setFilteredConversations([]);
      setNextConversationCursor(null);
    } finally {
      if (!quiet) setLoadingConversations(false);
    }
  }, [getToken, isSignedIn]);
  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const loadMoreConversations = useCallback(async () => {
    const cursor = nextConversationCursor;
    if (!cursor || loadingMoreConversations) return;
    setLoadingMoreConversations(true);
    setMoreConversationsError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const page = await getConversations(token, { cursor });
      setConversations((current) => appendConversationPage(current, page.conversations));
      setNextConversationCursor(page.next_cursor);
      loadedOlderConversationsRef.current = true;
      setLastUpdatedAt(Date.now());
    } catch (err) {
      setMoreConversationsError(
        err instanceof Error ? err.message : 'Failed to load more conversations',
      );
    } finally {
      setLoadingMoreConversations(false);
    }
  }, [getToken, loadingMoreConversations, nextConversationCursor]);

  useEffect(() => {
    const conversationId = selectedId;
    if (
      !isSignedIn ||
      !conversationId ||
      conversations.some((conversation) => conversation.id === conversationId) ||
      deepLinkHydrationRef.current === conversationId
    ) {
      return;
    }
    let cancelled = false;
    deepLinkHydrationRef.current = conversationId;
    setSelectedConversationError(null);
    void (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const conversation = await getConversation(token, conversationId);
        if (!cancelled && selectedIdRef.current === conversationId) {
          setConversations((current) => mergeConversationHead(current, [conversation]));
        }
      } catch (err) {
        if (!cancelled && selectedIdRef.current === conversationId) {
          setSelectedConversationError(
            err instanceof Error ? err.message : 'Conversation is unavailable',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversations, getToken, isSignedIn, selectedId]);
  // Deep link from Profile "Message" → /messages?c=<conversationId>
  useEffect(() => {
    if (!deepLinkConversationId) return;
    deepLinkHydrationRef.current = null;
    setSelectedConversationError(null);
    setSelectedId(deepLinkConversationId);
  }, [deepLinkConversationId]);

  const selectConversation = (id: string | null) => {
    deepLinkHydrationRef.current = null;
    setSelectedConversationError(null);
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

  const acknowledgeVisibleMessages = useCallback(
    async (conversationId: string, history: Message[]) => {
      if (
        selectedIdRef.current !== conversationId ||
        document.visibilityState !== 'visible' ||
        history.length === 0
      ) {
        return;
      }
      const throughMessageId = history[history.length - 1]!.id;
      const acknowledgementKey = `${conversationId}:${throughMessageId}`;
      if (readAckRef.current === acknowledgementKey) return;
      readAckRef.current = acknowledgementKey;
      try {
        const token = await getToken();
        if (
          !token ||
          selectedIdRef.current !== conversationId ||
          document.visibilityState !== 'visible'
        ) {
          readAckRef.current = null;
          return;
        }
        const result = await markConversationRead(token, conversationId, throughMessageId);
        if (selectedIdRef.current === conversationId) {
          setConversations((current) =>
            updateUnreadLocal(current, conversationId, result.unread_count),
          );
        }
      } catch {
        if (readAckRef.current === acknowledgementKey) readAckRef.current = null;
      }
    },
    [getToken],
  );
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
        const page = await getMessages(conversationId, token);
        if (selectedIdRef.current !== conversationId) return;
        if (page.sync_cursor) messageSyncCursorsRef.current.set(conversationId, page.sync_cursor);
        // Avoid re-render/scroll churn when nothing changed.
        const scroller = messagesScrollerRef.current;
        shouldScrollToEndRef.current = Boolean(
          scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80,
        );
        setMessages((current) => mergeMessageHistory(current, page.messages));
        void acknowledgeVisibleMessages(conversationId, page.messages);
        setMessagesError(null);
        setLastUpdatedAt(Date.now());
      } catch (err) {
        if (quiet || selectedIdRef.current !== conversationId) return;
        setMessagesError(err instanceof Error ? err.message : 'Failed to load messages');
      } finally {
        if (!quiet && selectedIdRef.current === conversationId) setLoadingMessages(false);
      }
    },
    [acknowledgeVisibleMessages, getToken],
  );
  loadMessagesForRef.current = loadMessagesFor;

  const recoverMessagesFor = useCallback(
    async (conversationId: string) => {
      const token = await getToken();
      if (!token || selectedIdRef.current !== conversationId) return;

      let syncCursor = messageSyncCursorsRef.current.get(conversationId) ?? null;
      let newestRecovered: Message[] = [];

      if (!syncCursor) {
        const page = await getMessages(conversationId, token, { limit: 100 });
        if (selectedIdRef.current !== conversationId) return;
        setMessages((current) => mergeMessageHistory(current, page.messages));
        newestRecovered = page.messages;
        syncCursor = page.sync_cursor;
        if (syncCursor) messageSyncCursorsRef.current.set(conversationId, syncCursor);
      } else {
        for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
          const page = await getMessages(conversationId, token, {
            limit: 100,
            afterCursor: syncCursor,
          });
          if (selectedIdRef.current !== conversationId) return;
          if (page.messages.length > 0) {
            newestRecovered = page.messages;
            setMessages((current) => mergeMessageHistory(current, page.messages));
          }

          const nextSyncCursor = page.sync_cursor;
          if (nextSyncCursor) messageSyncCursorsRef.current.set(conversationId, nextSyncCursor);
          if (!page.has_more) break;
          if (!nextSyncCursor || nextSyncCursor === syncCursor) {
            throw new Error('Message recovery cursor did not advance');
          }
          syncCursor = nextSyncCursor;

          if (pageNumber === 999) throw new Error('Message recovery exceeded its safety limit');
        }
      }

      if (selectedIdRef.current !== conversationId) return;
      setMessagesError(null);
      setLastUpdatedAt(Date.now());
      if (newestRecovered.length > 0) {
        void acknowledgeVisibleMessages(conversationId, newestRecovered);
      }
    },
    [acknowledgeVisibleMessages, getToken],
  );
  recoverMessagesForRef.current = recoverMessagesFor;

  useEffect(() => {
    setMessages([]);
    setNextMessagesCursor(null);
    setOlderMessagesError(null);
    readAckRef.current = null;
    shouldScrollToEndRef.current = true;
    if (!selectedId || !isSignedIn) return;
    const conversationId = selectedId;
    let cancelled = false;

    async function load() {
      setLoadingMessages(true);
      setMessagesError(null);
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const page = await getMessages(conversationId, token);
        if (!cancelled && selectedIdRef.current === conversationId) {
          if (page.sync_cursor) messageSyncCursorsRef.current.set(conversationId, page.sync_cursor);
          setMessages((current) => mergeMessageHistory(current, page.messages));
          setNextMessagesCursor(page.next_cursor);
          setLastUpdatedAt(Date.now());
          void acknowledgeVisibleMessages(conversationId, page.messages);
        }
      } catch (err) {
        if (!cancelled && selectedIdRef.current === conversationId) {
          setMessagesError(err instanceof Error ? err.message : 'Failed to load messages');
        }
      } finally {
        if (!cancelled && selectedIdRef.current === conversationId) setLoadingMessages(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [acknowledgeVisibleMessages, selectedId, getToken, isSignedIn]);

  // Soft-realtime fallback: quiet message poll when WS is down (Wave 8b/9b).

  const loadOlderMessages = useCallback(async () => {
    const conversationId = selectedIdRef.current;
    const cursor = nextMessagesCursor;
    if (!conversationId || !cursor || loadingOlderMessages) return;

    setLoadingOlderMessages(true);
    setOlderMessagesError(null);
    const scroller = messagesScrollerRef.current;
    const previousHeight = scroller?.scrollHeight ?? 0;
    try {
      const token = await getToken();
      if (!token) return;
      const page = await getMessages(conversationId, token, { cursor });
      if (selectedIdRef.current !== conversationId) return;
      shouldScrollToEndRef.current = false;
      setMessages((current) => mergeMessageHistory(current, page.messages));
      setNextMessagesCursor(page.next_cursor);
      setLastUpdatedAt(Date.now());
      requestAnimationFrame(() => {
        const activeScroller = messagesScrollerRef.current;
        if (activeScroller && selectedIdRef.current === conversationId) {
          activeScroller.scrollTop += activeScroller.scrollHeight - previousHeight;
        }
      });
    } catch (err) {
      if (selectedIdRef.current === conversationId) {
        setOlderMessagesError(
          err instanceof Error ? err.message : 'Failed to load earlier messages',
        );
      }
    } finally {
      if (selectedIdRef.current === conversationId) setLoadingOlderMessages(false);
    }
  }, [getToken, loadingOlderMessages, nextMessagesCursor]);
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

  // Social DM WebSocket — exchange a fresh bearer token for a one-use handshake ticket.
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

        const ticket = await issueSocialDmWsTicket(token);
        if (cancelled) return;
        const url = socialDmWsUrl(ticket);
        socket = new WebSocket(url);
        wsRef.current = socket;

        socket.onopen = () => {
          if (cancelled) {
            detachSocket(socket);
            return;
          }
          attempt = 0;
          setWsConnected(false);
          setReconnecting(Boolean(selectedIdRef.current));

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
            subscribedConversationRef.current = id;
          } else {
            setWsConnected(true);
            setReconnecting(false);
          }
        };

        socket.onmessage = (ev) => {
          if (typeof ev.data !== 'string') return;
          const event = parseSocialDmWsMessage(ev.data);
          if (!event) return;
          if (event.type === 'subscribed') {
            const activeId = selectedIdRef.current;
            if (event.conversationId !== activeId) return;
            void recoverMessagesForRef.current?.(event.conversationId).then(
              () => {
                if (
                  !cancelled &&
                  wsRef.current === socket &&
                  socket?.readyState === WebSocket.OPEN &&
                  selectedIdRef.current === event.conversationId
                ) {
                  setWsConnected(true);
                  setReconnecting(false);
                }
              },
              () => {
                setWsConnected(false);
                setReconnecting(true);
                if (socket?.readyState === WebSocket.OPEN) socket.close();
              },
            );
            return;
          }
          if (event.type === 'gap') {
            if (event.conversationId !== selectedIdRef.current) return;
            setWsConnected(false);
            setReconnecting(true);
            if (socket?.readyState === WebSocket.OPEN) socket.close();
            return;
          }
          if (event.type === 'message') {
            const activeId = selectedIdRef.current;
            setConversations((current) =>
              event.message.sender.id === viewerProfileIdRef.current
                ? promoteConversation(current, event.conversationId, (conversation) => ({
                    ...conversation,
                    last_message: event.message,
                  }))
                : bumpUnreadLocal(current, event.conversationId, event.message),
            );
            if (event.conversationId === activeId) {
              const scroller = messagesScrollerRef.current;
              shouldScrollToEndRef.current = Boolean(
                scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80,
              );
              setMessages((current) => mergeMessageHistory(current, [event.message]));
              void acknowledgeVisibleMessages(event.conversationId, [event.message]);
            }
            setLastUpdatedAt(Date.now());
            return;
          }
          if (event.type === 'read' && event.conversationId === selectedIdRef.current) {
            setMessages((current) => {
              const through = current.find((message) => message.id === event.throughMessageId);
              if (!through) return current;
              return current.map((message) => {
                if (
                  message.sequence > through.sequence ||
                  message.sender.id === event.profileId ||
                  message.read_by_profile_ids.includes(event.profileId)
                ) {
                  return message;
                }
                return {
                  ...message,
                  read_by_profile_ids: [...message.read_by_profile_ids, event.profileId],
                };
              });
            });
          }
        };

        socket.onerror = () => {
          // onclose will flip status + soft-poll resumes
        };

        socket.onclose = () => {
          if (wsRef.current === socket) wsRef.current = null;
          subscribedConversationRef.current = null;
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
      subscribedConversationRef.current = null;
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') return;
      const selectedConversationId = selectedIdRef.current;
      if (selectedConversationId) {
        void loadMessagesForRef.current?.(selectedConversationId, { quiet: true });
      }
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
      subscribedConversationRef.current = null;
      setReconnecting(false);
    };
  }, [acknowledgeVisibleMessages, getToken, isSignedIn]);

  // Resubscribe when the selected conversation changes on an open socket.
  useEffect(() => {
    const s = wsRef.current;
    if (s && s.readyState === WebSocket.OPEN) {
      const previousId = subscribedConversationRef.current;
      if (previousId && previousId !== selectedId) {
        s.send(unsubscribePayload(previousId));
      }
      if (selectedId && previousId !== selectedId) {
        setWsConnected(false);
        setReconnecting(true);
        s.send(subscribePayload(selectedId));
      } else if (!selectedId) {
        setWsConnected(true);
        setReconnecting(false);
      }
      subscribedConversationRef.current = selectedId;
    }
  }, [selectedId]);

  /* Scroll to bottom when messages change */
  useEffect(() => {
    if (shouldScrollToEndRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    shouldScrollToEndRef.current = false;
  }, [messages]);

  /* Send message */
  const handleSend = async () => {
    const content = composeText.trim();
    if (!content || !selectedId || sending) return;
    const conversationId = selectedId;
    let pending = pendingSendRef.current;
    if (!pending || pending.conversationId !== conversationId || pending.content !== content) {
      pending = { conversationId, content, clientMessageId: newClientMessageId() };
      pendingSendRef.current = pending;
    }
    setSending(true);
    setSendError(null);
    try {
      const token = await getToken();
      if (!token) {
        setSendError('Sign in again to send.');
        return;
      }
      const newMsg = await sendMessage(token, conversationId, content, pending.clientMessageId);
      pendingSendRef.current = null;
      if (selectedIdRef.current !== conversationId) return;
      shouldScrollToEndRef.current = true;
      setMessages((current) => mergeMessageHistory(current, [newMsg]));
      setComposeText((current) => (current.trim() === content ? '' : current));
      setLastUpdatedAt(Date.now());
      // Keep list preview fresh for the open thread.
      setConversations((current) =>
        promoteConversation(current, conversationId, (conversation) => ({
          ...conversation,
          last_message: newMsg,
          unread_count: 0,
        })),
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

  const newestSentMessageId = useMemo(
    () =>
      [...messages].reverse().find((message) => message.sender.id === viewerProfileId)?.id ?? null,
    [messages, viewerProfileId],
  );

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
          {!loadingConversations && !conversationsError && nextConversationCursor && (
            <div className="border-t px-4 py-3 text-center" style={{ borderColor: 'var(--border-primary)' }}>
              {searchQuery.trim() && (
                <p className="mb-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  Search currently covers loaded conversations.
                </p>
              )}
              <button
                type="button"
                onClick={() => void loadMoreConversations()}
                disabled={loadingMoreConversations}
                className="rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors hover-overlay disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-ring"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
              >
                {loadingMoreConversations ? 'Loading...' : 'Load more conversations'}
              </button>
            </div>
          )}
          {moreConversationsError && (
            <div className="px-4 pb-3 text-center" role="status" aria-live="polite">
              <p className="text-[12px]" style={{ color: 'var(--danger, #dc2626)' }}>
                {moreConversationsError}
              </p>
              <button
                type="button"
                onClick={() => void loadMoreConversations()}
                className="mt-1 text-[12px] font-semibold underline focus-visible:outline-none focus-ring"
              >
                Retry
              </button>
            </div>
          )}
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
              <p className="text-[20px] font-bold">
                {selectedConversationError
                  ? 'Conversation unavailable'
                  : selectedId
                    ? 'Loading conversation...'
                    : 'Select a conversation'}
              </p>
              <p className="mt-1 text-[15px]" style={{ color: 'var(--text-secondary)' }}>
                {selectedConversationError ??
                  (selectedId
                    ? 'Fetching this conversation securely.'
                    : 'Choose a conversation from the list to start messaging.')}
              </p>
              {selectedConversationError && (
                <button type="button" onClick={() => selectConversation(null)} className="mt-4 rounded-full border px-4 py-2 text-[13px] font-semibold focus-visible:outline-none focus-ring" style={{ borderColor: 'var(--border-primary)' }}>
                  Back to inbox
                </button>
              )}
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
            <div ref={messagesScrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
              {loadingMessages && <LoadingState label="Loading messages" />}

              {!loadingMessages && nextMessagesCursor && (
                <div className="mb-4 text-center">
                  <button
                    type="button"
                    onClick={() => void loadOlderMessages()}
                    disabled={loadingOlderMessages}
                    className="rounded-full border px-4 py-1.5 text-[13px] font-semibold disabled:opacity-50"
                    style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                  >
                    {loadingOlderMessages ? 'Loading earlier messages...' : 'Load earlier messages'}
                  </button>
                </div>
              )}

              {olderMessagesError && (
                <p className="mb-4 text-center text-[13px]" style={{ color: 'var(--color-danger)' }}>
                  {olderMessagesError}
                </p>
              )}

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
                          {isSent && msg.id === newestSentMessageId && msg.read_by_profile_ids.length > 0
                            ? ' \u00B7 Seen' : ''}
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
                  maxLength={SOCIAL_DM_MAX_MESSAGE_CHARS}
                  value={composeText}
                  onChange={(e) => {
                    setComposeText(e.target.value);
                    if (sendError) setSendError(null);
                    if (pendingSendRef.current?.content !== e.target.value.trim()) {
                      pendingSendRef.current = null;
                    }
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
              <p
                className="mt-1 pr-14 text-right text-[11px]"
                style={{ color: 'var(--text-secondary)' }}
              >
                {composeText.length.toLocaleString()} /{' '}
                {SOCIAL_DM_MAX_MESSAGE_CHARS.toLocaleString()}
              </p>
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
