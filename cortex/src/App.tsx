import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { PanelRight, Loader2, Menu } from 'lucide-react';
import ChatComposer from './components/chat/ChatComposer';
import ChatTimeline from './components/chat/ChatTimeline';
import SessionControls from './components/session/SessionControls';
import Sidebar from './components/Sidebar';
import { useChatSession } from './lib/useChatSession';
import { useAuthGate } from './lib/useAuthGate';
import { setAuthTokenGetter } from './lib/cortexApi';
import type { ChatSessionControls } from './types';

const DEFAULT_SESSION_CONTROLS: ChatSessionControls = {
  speed: 'balanced',
  intelligence: 'balanced',
  autonomy: 'guided',
};

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
    DEFAULT_SESSION_CONTROLS,
  );

  useEffect(() => {
    if (getToken) setAuthTokenGetter(getToken);
  }, [getToken]);

  const {
    messages,
    draft,
    isStreaming,
    activeConversationTitle,
    setDraft,
    sendMessage,
    updateApproval,
    renameConversation,
  } = useChatSession({
    activeConversationId,
    userId: userId ?? 'local',
    onConversationCreated: (conversationId) => {
      setActiveConversationId(conversationId);
    },
    onConversationsChanged: () => {
      setConversationListVersion((version) => version + 1);
    },
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

  const headerTitle = activeConversationTitle?.trim() || 'New chat';
  const approvalCount = messages.filter((message) => message.approvalRequest?.state === 'pending').length;
  const showWorkBadge = isStreaming || approvalCount > 0;

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
          <ChatTimeline messages={messages} onApprovalAction={updateApproval} />
          <SessionControls value={sessionControls} onChange={setSessionControls} />
          <ChatComposer
            draft={draft}
            disabled={isStreaming}
            onDraftChange={setDraft}
            onSend={sendMessage}
          />
        </main>
      </div>

      <Suspense fallback={null}>
        <WorkSurface
          messages={messages}
          isStreaming={isStreaming}
          open={workSurfaceOpen}
          onClose={() => setWorkSurfaceOpen(false)}
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
