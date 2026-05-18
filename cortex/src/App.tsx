import { useCallback, useEffect, useState } from 'react';
import { Loader2, Settings } from 'lucide-react';
import ChatComposer from './components/chat/ChatComposer';
import ChatTimeline from './components/chat/ChatTimeline';
import Sidebar from './components/Sidebar';
import SettingsPanel from './components/SettingsPanel';
import { useChatSession } from './lib/useChatSession';
import { useAuthGate } from './lib/useAuthGate';
import { setAuthTokenGetter } from './lib/cortexApi';

export default function App() {
  const { isLoaded, isSignedIn, userId, AuthScreen, getToken } = useAuthGate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationListVersion, setConversationListVersion] = useState(0);

  useEffect(() => {
    if (getToken) setAuthTokenGetter(getToken);
  }, [getToken]);

  const {
    messages,
    draft,
    isStreaming,
    setDraft,
    sendMessage,
    updateApproval,
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

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

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
    <div className="flex h-screen bg-[var(--bg)] text-[var(--fg)]">
      {/* Sidebar */}
      <Sidebar
        userId={userId ?? 'local'}
        activeConversationId={activeConversationId}
        refreshKey={conversationListVersion}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onConversationsChanged={() => {
          setConversationListVersion((version) => version + 1);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-12 items-center justify-between border-b border-white/6 px-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">Cortex</span>
            {isStreaming && (
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
                Streaming
              </span>
            )}
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg p-2 text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95"
          >
            <Settings className="h-4 w-4" />
          </button>
        </header>

        {/* Chat panel */}
        <main className="flex min-h-0 flex-1 flex-col">
          <ChatTimeline messages={messages} onApprovalAction={updateApproval} />
          <ChatComposer
            draft={draft}
            disabled={isStreaming}
            onDraftChange={setDraft}
            onSend={sendMessage}
          />
        </main>
      </div>

      {/* Settings modal */}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
