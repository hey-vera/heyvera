import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { PanelRight, Loader2, Menu } from 'lucide-react';
import ChatComposer from './components/chat/ChatComposer';
import ChatTimeline from './components/chat/ChatTimeline';
import SessionControls from './components/session/SessionControls';
import Sidebar from './components/Sidebar';
import { useChatSession } from './lib/useChatSession';
import { useAuthGate } from './lib/useAuthGate';
import { setAuthTokenGetter } from './lib/cortexApi';
import type { ChatSessionControls, RunProfile } from './types';

const DEFAULT_SESSION_CONTROLS: ChatSessionControls = {
  speed: 'balanced',
  intelligence: 'balanced',
  autonomy: 'guided',
};

const SESSION_CONTROLS_STORAGE_KEY = 'cortex:session-controls';
const RUN_PROFILE_STORAGE_KEY = 'cortex:run-profile';

function isSessionControls(value: unknown): value is ChatSessionControls {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ChatSessionControls>;
  return (
    (candidate.speed === 'steady' || candidate.speed === 'balanced' || candidate.speed === 'rapid')
    && (candidate.intelligence === 'focused'
      || candidate.intelligence === 'balanced'
      || candidate.intelligence === 'deep')
    && (candidate.autonomy === 'manual'
      || candidate.autonomy === 'guided'
      || candidate.autonomy === 'smart_auto'
      || candidate.autonomy === 'full_auto'
      || candidate.autonomy === 'custom')
  );
}

function readSessionControls(): ChatSessionControls {
  try {
    const raw = window.localStorage.getItem(SESSION_CONTROLS_STORAGE_KEY);
    if (!raw) return DEFAULT_SESSION_CONTROLS;
    const parsed = JSON.parse(raw);
    return isSessionControls(parsed) ? parsed : DEFAULT_SESSION_CONTROLS;
  } catch {
    return DEFAULT_SESSION_CONTROLS;
  }
}

function isRunProfile(value: unknown): value is RunProfile {
  return value === 'auto'
    || value === 'balanced'
    || value === 'cost_saver'
    || value === 'quality_first';
}

function readRunProfile(): RunProfile {
  try {
    const raw = window.localStorage.getItem(RUN_PROFILE_STORAGE_KEY);
    return isRunProfile(raw) ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

function looksLikeRunGoal(value: string) {
  const text = value.trim().toLowerCase();
  if (text.length < 28) return false;
  const connectiveMatches = text.match(/\b(and|then|after|also|plus)\b/g)?.length ?? 0;
  const actionMatches = text.match(/\b(fix|add|update|refactor|test|review|commit|deploy|wire|build|implement)\b/g)?.length ?? 0;
  return connectiveMatches > 0 && actionMatches >= 2;
}

const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
const WorkSurface = lazy(() => import('./components/work-surface/WorkSurface'));

export default function App() {
  const { isLoaded, isSignedIn, userId, AuthScreen, getToken } = useAuthGate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workSurfaceOpen, setWorkSurfaceOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [conversationListVersion, setConversationListVersion] = useState(0);
  const [sessionControls, setSessionControls] = useState<ChatSessionControls>(
    readSessionControls,
  );
  const [runProfile, setRunProfile] = useState<RunProfile>(readRunProfile);
  const [runBridgeGoal, setRunBridgeGoal] = useState<string | null>(null);
  const [runBridgeNonce, setRunBridgeNonce] = useState(0);

  const handleConversationCreated = useCallback((conversationId: string) => {
    setActiveConversationId(conversationId);
  }, []);

  const handleConversationsChanged = useCallback(() => {
    setConversationListVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (getToken) setAuthTokenGetter(getToken);
  }, [getToken]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SESSION_CONTROLS_STORAGE_KEY,
        JSON.stringify(sessionControls),
      );
    } catch {
      // ignore local preference persistence failures
    }
  }, [sessionControls]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RUN_PROFILE_STORAGE_KEY, runProfile);
    } catch {
      // ignore local preference persistence failures
    }
  }, [runProfile]);

  const {
    messages,
    draft,
    isStreaming,
    isLoadingConversation,
    activeConversationTitle,
    workEvents,
    setDraft,
    sendMessage,
    stopStreaming,
    updateApproval,
    renameConversation,
  } = useChatSession({
    activeConversationId,
    userId: userId ?? 'local',
    onConversationCreated: handleConversationCreated,
    onConversationsChanged: handleConversationsChanged,
  });

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const skipTitleBlurSaveRef = useRef(false);

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setSidebarOpen(false);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    setSidebarOpen(false);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
    setSidebarOpen(false);
  }, []);

  const handleSelectStarter = useCallback((prompt: string) => {
    setDraft(prompt);
  }, [setDraft]);

  const bridgeDraftToRun = useCallback(() => {
    const nextGoal = draft.trim();
    if (!nextGoal) return;
    setRunBridgeGoal(nextGoal);
    setRunBridgeNonce((nonce) => nonce + 1);
    setWorkSurfaceOpen(true);
  }, [draft]);

  const clearRunBridgeGoal = useCallback(() => {
    setRunBridgeGoal(null);
  }, []);

  const headerTitle = activeConversationTitle?.trim() || 'New chat';
  const approvalCount = messages.filter((message) => message.approvalRequest?.state === 'pending').length;
  const showWorkBadge = isStreaming || approvalCount > 0;
  const showRunBridge = looksLikeRunGoal(draft) && !isStreaming;

  useEffect(() => {
    if (!renamingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [renamingTitle]);

  const startTitleRename = useCallback(() => {
    if (!activeConversationId) return;
    setTitleDraft(headerTitle);
    setRenamingTitle(true);
  }, [activeConversationId, headerTitle]);

  const cancelTitleRename = useCallback(() => {
    skipTitleBlurSaveRef.current = true;
    setRenamingTitle(false);
    setTitleDraft('');
  }, []);

  const saveTitleRename = useCallback(() => {
    const nextTitle = titleDraft.trim();
    skipTitleBlurSaveRef.current = false;
    if (!nextTitle) {
      cancelTitleRename();
      return;
    }

    setRenamingTitle(false);
    setTitleDraft('');
    void renameConversation(nextTitle);
  }, [cancelTitleRename, renameConversation, titleDraft]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInput = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;

      if (event.key === 'Escape') {
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (workSurfaceOpen) {
          setWorkSurfaceOpen(false);
          return;
        }
        if (sidebarOpen) {
          setSidebarOpen(false);
          return;
        }
        if (isStreaming) {
          stopStreaming();
        }
        return;
      }

      if (isTextInput) return;

      const hasModifier = event.metaKey || event.ctrlKey;
      if (!hasModifier) return;

      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        handleNewChat();
      } else if (key === 'b') {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      } else if (key === 'j') {
        event.preventDefault();
        setWorkSurfaceOpen((open) => !open);
      } else if (key === ',') {
        event.preventDefault();
        handleOpenSettings();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleNewChat,
    handleOpenSettings,
    isStreaming,
    settingsOpen,
    sidebarOpen,
    stopStreaming,
    workSurfaceOpen,
  ]);

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  if (!isSignedIn && AuthScreen) {
    return <AuthScreen />;
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <aside className="hidden h-full shrink-0 lg:block">
        <Sidebar
          userId={userId ?? 'local'}
          activeConversationId={activeConversationId}
          refreshKey={conversationListVersion}
          onNewChat={handleNewChat}
          onSelectConversation={handleSelectConversation}
          onConversationsChanged={() => {
            setConversationListVersion((version) => version + 1);
          }}
          onOpenSettings={handleOpenSettings}
        />
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close conversations"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative h-full w-[min(20rem,calc(100vw-3rem))] translate-x-0 border-r border-white/8 bg-[var(--bg)] shadow-2xl">
            <Sidebar
              userId={userId ?? 'local'}
              activeConversationId={activeConversationId}
              refreshKey={conversationListVersion}
              onNewChat={handleNewChat}
              onSelectConversation={handleSelectConversation}
              onConversationsChanged={() => {
                setConversationListVersion((version) => version + 1);
              }}
              onOpenSettings={handleOpenSettings}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/6 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95 lg:hidden"
              aria-label="Open conversations"
              title="Open conversations (Ctrl+B)"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              {renamingTitle ? (
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={() => {
                    if (skipTitleBlurSaveRef.current) {
                      skipTitleBlurSaveRef.current = false;
                      return;
                    }
                    saveTitleRename();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      saveTitleRename();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelTitleRename();
                    }
                  }}
                  className="block max-w-[60vw] rounded-md border border-white/10 bg-white/8 px-2 py-1 text-sm font-medium text-white outline-none transition focus:border-white/16"
                />
              ) : (
                <button
                  type="button"
                  className="block max-w-[60vw] truncate text-left text-sm font-medium text-white transition hover:text-[var(--accent)] disabled:hover:text-white"
                  title={activeConversationId ? 'Rename conversation' : 'Start a chat to rename it'}
                  disabled={!activeConversationId}
                  onClick={startTitleRename}
                >
                  {headerTitle}
                </button>
              )}
              <div className="hidden text-[11px] text-[var(--muted)] sm:block">
                Workspace connected
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isStreaming && (
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
                Streaming
              </span>
            )}
            <button
              type="button"
              className="relative inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95 xl:hidden"
              aria-label="Open work surface"
              title="Open work surface (Ctrl+J)"
              onClick={() => setWorkSurfaceOpen(true)}
            >
              <PanelRight className="h-4 w-4" />
              <span className="hidden sm:inline">Work</span>
              {showWorkBadge && (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--accent)]" />
              )}
            </button>
          </div>
        </header>

        <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <ChatTimeline
            messages={messages}
            isLoading={isLoadingConversation}
            showStarters={!activeConversationId && !isStreaming}
            onSelectStarter={handleSelectStarter}
            onApprovalAction={updateApproval}
          />
          <SessionControls
            value={sessionControls}
            runProfile={runProfile}
            onChange={setSessionControls}
            onRunProfileChange={setRunProfile}
          />
          {showRunBridge && (
            <div className="border-t border-white/6 px-3 py-2 sm:px-4">
              <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-3 py-2">
                <p className="min-w-0 truncate text-xs text-[var(--muted-strong)]">
                  This looks like a multi-step coding goal.
                </p>
                <button
                  type="button"
                  onClick={bridgeDraftToRun}
                  className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-black transition hover:brightness-110 active:scale-95"
                >
                  Create run
                </button>
              </div>
            </div>
          )}
          <ChatComposer
            draft={draft}
            disabled={isStreaming}
            onDraftChange={setDraft}
            onSend={sendMessage}
            onStop={stopStreaming}
          />
        </main>
      </div>

      <Suspense fallback={null}>
        <WorkSurface
          messages={messages}
          workEvents={workEvents}
          isStreaming={isStreaming}
          runProfile={runProfile}
          runBridgeGoal={runBridgeGoal}
          runBridgeNonce={runBridgeNonce}
          open={workSurfaceOpen}
          onClose={() => setWorkSurfaceOpen(false)}
          onRunBridgeConsumed={clearRunBridgeGoal}
          onApprovalAction={updateApproval}
        />
      </Suspense>

      {/* Settings modal */}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
