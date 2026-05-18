import { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, Loader2, ShieldCheck } from 'lucide-react';
import ChatComposer from './components/chat/ChatComposer';
import ChatHeader from './components/chat/ChatHeader';
import ChatTimeline from './components/chat/ChatTimeline';
import OnboardingFlow from './components/onboarding/OnboardingFlow';
import { useChatSession } from './lib/useChatSession';
import { isOnboarded, markOnboarded } from './lib/onboarding';
import { useAuthGate } from './lib/useAuthGate';
import { setAuthTokenGetter } from './lib/cortexApi';

export default function App() {
  const { isLoaded, isSignedIn, userId, AuthScreen, getToken } = useAuthGate();

  useEffect(() => {
    if (getToken) setAuthTokenGetter(getToken);
  }, [getToken]);

  const [onboarded, setOnboarded] = useState(() =>
    userId ? isOnboarded(userId) : false,
  );

  const handleOnboardingComplete = useCallback(() => {
    if (userId) markOnboarded(userId);
    setOnboarded(true);
  }, [userId]);

  const {
    project,
    messages,
    draft,
    isStreaming,
    setDraft,
    sendMessage,
    updateApproval,
  } = useChatSession();

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

  if (!onboarded) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-4 pt-3 sm:px-6 sm:pb-6">
        <ChatHeader project={project} />

        <main className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/8 bg-[var(--panel)] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="border-b border-white/6 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-2.5 py-1">
                <BrainCircuit className="h-3.5 w-3.5" />
                Provider blend active
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-2.5 py-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                Agent: cortex-heart
              </span>
              {isStreaming ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
                  Streaming response
                </span>
              ) : null}
            </div>
          </div>

          <ChatTimeline messages={messages} onApprovalAction={updateApproval} />
          <ChatComposer
            draft={draft}
            disabled={isStreaming}
            onDraftChange={setDraft}
            onSend={sendMessage}
          />
        </main>
      </div>
    </div>
  );
}
