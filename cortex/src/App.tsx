import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CreditCard, ExternalLink, PanelRight, Loader2, Menu, Search } from 'lucide-react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import TrialBanner from './components/billing/TrialBanner';
import GroupSidebar from './components/groups/GroupSidebar';
import CommandPalette from './components/shell/CommandPalette';
import StatusBar from './components/shell/StatusBar';
import TaskManagerChat from './components/tasks/TaskManagerChat';
import HomePage from './components/marketing/HomePage';
import { useChatSession } from './lib/useChatSession';
import { useAuthGate } from './lib/useAuthGate';
import { useSomaSession } from './lib/useSomaSession';
import { useBilling } from './lib/useBilling';
import {
  CortexApiError,
  getAdminStats,
  getUserRouting,
  listConversations,
  setAuthTokenGetter,
  type BillingAccessState,
  type ConversationSummary,
} from './lib/cortexApi';
import {
  createTeamGroup,
  DEFAULT_GROUPS,
  readGroupConversationMap,
  readGroups,
  writeGroupConversationMap,
  writeGroups,
  type CortexGroup,
} from './lib/groups';
import type { ChatSessionControls, RunProfile } from './types';
import type { TaskManagerState } from './types';
import { openDetachedPanel } from './lib/shell/windowManager';
import { readTaskManagerState, TASK_MANAGER_CHANNEL_NAME } from './lib/taskManager';

const DEFAULT_SESSION_CONTROLS: ChatSessionControls = {
  speed: 'balanced',
  intelligence: 'balanced',
  autonomy: 'guided',
};

const SESSION_CONTROLS_STORAGE_KEY = 'cortex:session-controls';
const RUN_PROFILE_STORAGE_KEY = 'cortex:run-profile';
const FREE_TIER_ACCESS_STATES = new Set<BillingAccessState>(['needs_checkout', 'needs_phone', 'cancelled']);
type SettingsTab = 'providers' | 'integrations' | 'spend' | 'billing';

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

const AdminPanel = lazy(() => import('./components/admin/AdminPanel'));
const PricingCards = lazy(() => import('./components/billing/PricingCards'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
const WorkSurface = lazy(() => import('./components/work-surface/WorkSurface'));

function isFreeTierAccessState(accessState: BillingAccessState | undefined) {
  return Boolean(accessState && FREE_TIER_ACCESS_STATES.has(accessState));
}

function FreeTierBanner({
  accessState,
  onOpenBilling,
}: {
  accessState: BillingAccessState;
  onOpenBilling: () => void;
}) {
  const isCancelled = accessState === 'cancelled';
  return (
    <div className="border-b border-[var(--accent)]/15 bg-[var(--accent)]/10 px-3 py-2 sm:px-4">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 sm:gap-3">
        <span className="rounded-full border border-[var(--accent)]/25 bg-black/15 px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
          Free tier
        </span>
        <p className="min-w-[12rem] flex-1 text-xs text-[var(--muted-strong)]">
          {isCancelled
            ? 'Your subscription is cancelled. Core Task Manager and routing previews remain available with free-tier limits.'
            : 'Explore Task Manager, groups, routing previews, and sovereignty controls before upgrading.'}
        </p>
        <button
          type="button"
          onClick={onOpenBilling}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/10 bg-white/8 px-2.5 text-xs text-white transition hover:bg-white/12 active:scale-95"
        >
          <CreditCard className="h-3.5 w-3.5" />
          Upgrade
        </button>
      </div>
    </div>
  );
}

function PaymentIssueBanner({
  onOpenBilling,
}: {
  onOpenBilling: () => void;
}) {
  return (
    <div className="border-b border-red-400/20 bg-red-400/10 px-3 py-2 sm:px-4">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 sm:gap-3">
        <CreditCard className="h-4 w-4 shrink-0 text-red-200" />
        <p className="min-w-[12rem] flex-1 text-xs text-red-100">
          Payment failed. Your workspace is visible, but paid Cortex runtime actions need an updated payment method.
        </p>
        <button
          type="button"
          onClick={onOpenBilling}
          className="inline-flex h-7 items-center rounded-lg border border-red-200/20 bg-red-100/10 px-2.5 text-xs text-red-50 transition hover:bg-red-100/15 active:scale-95"
        >
          Fix billing
        </button>
      </div>
    </div>
  );
}

function useGroupState() {
  const [groups, setGroups] = useState<CortexGroup[]>(readGroups);
  const [conversationByGroup, setConversationByGroup] = useState<Record<string, string | null>>(
    readGroupConversationMap,
  );

  const addTeamGroup = useCallback((group: CortexGroup) => {
    setGroups((current) => {
      if (current.some((existingGroup) => existingGroup.id === group.id)) return current;
      const nextGroups = [...current, group];
      writeGroups(nextGroups);
      return nextGroups;
    });
  }, []);

  const setGroupConversation = useCallback((groupId: string, conversationId: string | null) => {
    setConversationByGroup((current) => {
      const next = { ...current, [groupId]: conversationId };
      writeGroupConversationMap(next);
      return next;
    });
  }, []);

  return {
    groups,
    addTeamGroup,
    conversationByGroup,
    setGroupConversation,
  };
}

function CortexShell() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const {
    groups,
    addTeamGroup,
    conversationByGroup,
    setGroupConversation,
  } = useGroupState();
  const activeGroup = useMemo(
    () => groups.find((group) => group.id === groupId) ?? DEFAULT_GROUPS[0],
    [groupId, groups],
  );
  const activeGroupId = activeGroup.id;
  const { isLoaded, isSignedIn, userId, AuthScreen, getToken, clerkEnabled } = useAuthGate();
  // Auto-creates user's Soma identity + session-scoped delegation on sign-in
  useSomaSession(userId ?? 'anonymous', isSignedIn);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('providers');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workSurfaceOpen, setWorkSurfaceOpen] = useState(false);
  const activeConversationId = conversationByGroup[activeGroupId] ?? null;
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [conversationListVersion, setConversationListVersion] = useState(0);
  const sessionControls = readSessionControls();
  const [runProfile, setRunProfile] = useState<RunProfile>(readRunProfile);
  const runBridgeGoal = null;
  const runBridgeNonce = 0;
  const [adminOpen, setAdminOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteConversations, setPaletteConversations] = useState<ConversationSummary[]>([]);
  const [taskState, setTaskState] = useState<TaskManagerState | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const billingEnabled = clerkEnabled && isSignedIn;
  const isDetachedWindow = useMemo(() => new URLSearchParams(window.location.search).has('detached'), []);

  const handleConversationCreated = useCallback((conversationId: string) => {
    setGroupConversation(activeGroupId, conversationId);
  }, [activeGroupId, setGroupConversation]);

  const handleConversationsChanged = useCallback(() => {
    setConversationListVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (getToken) setAuthTokenGetter(getToken);
  }, [getToken]);

  useEffect(() => {
    setTaskState(readTaskManagerState(activeGroup, userId ?? 'local'));
  }, [activeGroup, userId]);

  useEffect(() => {
    const refreshConversations = () => {
      void listConversations(userId ?? 'local')
        .then(setPaletteConversations)
        .catch(() => setPaletteConversations([]));
    };
    refreshConversations();
    const interval = window.setInterval(refreshConversations, 8000);
    return () => window.clearInterval(interval);
  }, [conversationListVersion, userId]);

  useEffect(() => {
    const channel = typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(TASK_MANAGER_CHANNEL_NAME);
    const onMessage = (event: MessageEvent<{ groupId?: string }>) => {
      if (event.data?.groupId === activeGroup.id) {
        setTaskState(readTaskManagerState(activeGroup, userId ?? 'local'));
      }
    };
    channel?.addEventListener('message', onMessage);
    const onStorage = (event: StorageEvent) => {
      if (event.key?.includes(`cortex:task-manager:${activeGroup.id}`)) {
        setTaskState(readTaskManagerState(activeGroup, userId ?? 'local'));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      window.removeEventListener('storage', onStorage);
    };
  }, [activeGroup, userId]);

  useEffect(() => {
    if (!groupId || groups.some((group) => group.id === groupId)) return;
    navigate(`/app/groups/${DEFAULT_GROUPS[0].id}/tasks`, { replace: true });
  }, [groupId, groups, navigate]);

  const billing = useBilling(billingEnabled);

  useEffect(() => {
    if (!isSignedIn) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    async function checkAdmin() {
      try {
        await getAdminStats();
        if (!cancelled) setIsAdmin(true);
      } catch (err) {
        if (!cancelled) setIsAdmin(err instanceof CortexApiError ? false : false);
      }
    }
    void checkAdmin();
    return () => { cancelled = true; };
  }, [isSignedIn]);


  useEffect(() => {
    try {
      window.localStorage.setItem(RUN_PROFILE_STORAGE_KEY, runProfile);
    } catch {
      // ignore local preference persistence failures
    }
  }, [runProfile]);

  useEffect(() => {
    let cancelled = false;

    async function loadRoutingProfile() {
      try {
        const routing = await getUserRouting();
        if (!cancelled && isRunProfile(routing.profile)) {
          setRunProfile(routing.profile);
        }
      } catch {
        // keep local profile preference when backend routing settings are unavailable
      }
    }

    void loadRoutingProfile();
    return () => {
      cancelled = true;
    };
  }, []);

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
    isSignedIn: Boolean(isSignedIn),
    group: activeGroup,
    sessionControls,
    runProfile,
    onConversationCreated: handleConversationCreated,
    onConversationsChanged: handleConversationsChanged,
  });

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const skipTitleBlurSaveRef = useRef(false);

  const handleNewChat = useCallback(() => {
    setGroupConversation(activeGroupId, null);
    setSidebarOpen(false);
  }, [activeGroupId, setGroupConversation]);

  const handleSelectConversation = useCallback((id: string) => {
    setGroupConversation(activeGroupId, id);
    setSidebarOpen(false);
  }, [activeGroupId, setGroupConversation]);

  const handleCreateGroup = useCallback(() => {
    const nextGroup = createTeamGroup(groups);
    addTeamGroup(nextGroup);
    navigate(`/app/groups/${nextGroup.id}/tasks`);
    setSidebarOpen(false);
  }, [addTeamGroup, groups, navigate]);

  const handleOpenSettings = useCallback((tab: SettingsTab = 'providers') => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
    setSidebarOpen(false);
  }, []);

  const handleOpenAdmin = useCallback(() => {
    setAdminOpen(true);
    setSidebarOpen(false);
  }, []);

  const handleCreateTaskFromPalette = useCallback(() => {
    setDraft((currentDraft) => currentDraft.trim() ? currentDraft : 'Create task: ');
    setSidebarOpen(false);
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    }, 0);
  }, [setDraft]);

  const handlePopOutTaskManager = useCallback(() => {
    openDetachedPanel('task-manager', activeGroup);
  }, [activeGroup]);


  const clearRunBridgeGoal = useCallback(() => {
    // Task Manager Chat does not currently bridge chat drafts into runs.
  }, []);

  const headerTitle = activeConversationTitle?.trim() || 'New chat';
  const approvalCount = messages.filter((message) => message.approvalRequest?.state === 'pending').length;
  const showWorkBadge = isStreaming || approvalCount > 0;
  const accessState = billing.status?.access_state;
  const isFreeTier = billingEnabled && isFreeTierAccessState(accessState);
  const runtimeLocked = billingEnabled && accessState === 'payment_failed';
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
      const hasModifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (hasModifier && key === 'k') {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }

      if (event.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
          return;
        }
        if (checkoutOpen) {
          setCheckoutOpen(false);
          return;
        }
        if (adminOpen) {
          setAdminOpen(false);
          return;
        }
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

      if (!hasModifier) return;

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
      } else if (key === 'o' && event.shiftKey) {
        event.preventDefault();
        handlePopOutTaskManager();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    adminOpen,
    checkoutOpen,
    commandPaletteOpen,
    handleNewChat,
    handleOpenSettings,
    handlePopOutTaskManager,
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
        <GroupSidebar
          groups={groups}
          activeGroupId={activeGroupId}
          userId={userId ?? 'local'}
          isSignedIn={Boolean(isSignedIn)}
          activeConversationId={activeConversationId}
          refreshKey={conversationListVersion}
          onCreateGroup={handleCreateGroup}
          onNewChat={handleNewChat}
          onSelectConversation={handleSelectConversation}
          onConversationsChanged={() => {
            setConversationListVersion((version) => version + 1);
          }}
          onOpenSettings={handleOpenSettings}
          onOpenAdmin={handleOpenAdmin}
          isAdmin={isAdmin}
          billing={billing.status}
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
            <GroupSidebar
              groups={groups}
              activeGroupId={activeGroupId}
              userId={userId ?? 'local'}
              isSignedIn={Boolean(isSignedIn)}
              activeConversationId={activeConversationId}
              refreshKey={conversationListVersion}
              onCreateGroup={handleCreateGroup}
              onNewChat={handleNewChat}
              onSelectConversation={handleSelectConversation}
              onConversationsChanged={() => {
                setConversationListVersion((version) => version + 1);
              }}
              onOpenSettings={handleOpenSettings}
              onOpenAdmin={handleOpenAdmin}
              isAdmin={isAdmin}
              billing={billing.status}
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
                {activeGroup.name} task manager
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
              className="hidden h-9 items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-2.5 text-xs text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95 sm:inline-flex"
              aria-label="Open command palette"
              title="Open command palette (Cmd/Ctrl+K)"
              onClick={() => setCommandPaletteOpen(true)}
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search</span>
              <kbd className="rounded border border-white/10 bg-black/20 px-1 text-[10px]">K</kbd>
            </button>
            <button
              type="button"
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-white/6 hover:text-white active:scale-95 lg:inline-flex"
              aria-label="Pop out task manager"
              title="Pop out Task Manager (Cmd/Ctrl+Shift+O)"
              onClick={handlePopOutTaskManager}
            >
              <ExternalLink className="h-4 w-4" />
            </button>
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
        <TrialBanner billing={billing.status} onOpenBilling={() => handleOpenSettings('billing')} />
        {isFreeTier && accessState && (
          <FreeTierBanner
            accessState={accessState}
            onOpenBilling={() => handleOpenSettings('billing')}
          />
        )}
        {runtimeLocked && (
          <PaymentIssueBanner onOpenBilling={() => handleOpenSettings('billing')} />
        )}

        <TaskManagerChat
          group={activeGroup}
          userId={userId ?? 'local'}
          activeConversationId={activeConversationId}
          messages={messages}
          draft={draft}
          isStreaming={isStreaming}
          isLoadingConversation={isLoadingConversation}
          needsSubscription={false}
          onDraftChange={setDraft}
          onSend={sendMessage}
          onStop={isStreaming ? stopStreaming : undefined}
          onSubscribe={() => setCheckoutOpen(true)}
          onApprovalAction={updateApproval}
          onTaskStateChange={setTaskState}
        />
        <StatusBar
          groupName={activeGroup.name}
          activeConversationTitle={headerTitle}
          isStreaming={isStreaming}
          isLoadingConversation={isLoadingConversation}
          runProfile={runProfile}
          taskState={taskState}
          detached={isDetachedWindow}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onOpenWorkSurface={() => setWorkSurfaceOpen(true)}
        />
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
          <SettingsPanel
            onClose={() => setSettingsOpen(false)}
            initialTab={settingsInitialTab}
            billing={billing.status}
          />
        </Suspense>
      )}

      {/* Admin panel */}
      {adminOpen && (
        <Suspense fallback={null}>
          <AdminPanel onClose={() => setAdminOpen(false)} />
        </Suspense>
      )}

      {/* Checkout modal (fallback for in-app subscribe links) */}
      {checkoutOpen && (
        <Suspense fallback={null}>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md sm:p-6">
            <div className="relative w-full max-w-lg">
              <button
                type="button"
                onClick={() => setCheckoutOpen(false)}
                className="absolute -top-10 right-0 rounded-lg p-1.5 text-[var(--muted)] transition hover:text-white"
                aria-label="Close"
              >
                <span className="text-sm">ESC</span>
              </button>
              <PricingCards compact />
            </div>
          </div>
        </Suspense>
      )}

      <CommandPalette
        open={commandPaletteOpen}
        groups={groups}
        activeGroupId={activeGroupId}
        conversations={paletteConversations}
        taskState={taskState}
        onClose={() => setCommandPaletteOpen(false)}
        onCreateTask={handleCreateTaskFromPalette}
        onCreateGroup={handleCreateGroup}
        onNewChat={handleNewChat}
        onSelectGroup={(nextGroupId) => navigate(`/app/groups/${nextGroupId}/tasks`)}
        onSelectConversation={handleSelectConversation}
        onOpenSettings={() => handleOpenSettings()}
        onOpenWorkSurface={() => setWorkSurfaceOpen(true)}
        onPopOutTaskManager={handlePopOutTaskManager}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/app" element={<Navigate to={`/app/groups/${DEFAULT_GROUPS[0].id}/tasks`} replace />} />
        <Route path="/app/groups/:groupId/tasks" element={<CortexShell />} />
        {/* Legacy redirects */}
        <Route path="/groups/:groupId/tasks" element={<Navigate to={`/app/groups/${DEFAULT_GROUPS[0].id}/tasks`} replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
