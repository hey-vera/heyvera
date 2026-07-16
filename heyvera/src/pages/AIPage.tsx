import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Send, Sparkles } from 'lucide-react';
import { SignInButton } from '@clerk/clerk-react';
import { useAuth } from '../hooks/useAuth';
import { listDrafts, approveDraft, rejectDraft, publishDraft, createDraft } from '../api/pulse';
import type { PulseDraft } from '../api/pulse';

type Tab = 'chat' | 'drafts' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: 'Hey Vera' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'settings', label: 'Settings' },
];

type ChatMessage = {
  id: string;
  role: 'user' | 'vera';
  content: string;
  timestamp: number;
};

const VERA_GREETING =
  "Hey — I'm Vera's draft assistant (beta). I can turn natural language into post drafts and save them for you. I'm not a full marketing AI yet — no auto-replies, analytics, or scheduled posting. Use the Drafts tab to approve, dismiss, or publish.";

export function AIPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const defaultedTab = useRef(false);

  // Prefer Drafts when signed in (once); chat remains default for signed-out / no-auth.
  useEffect(() => {
    if (defaultedTab.current) return;
    if (!authEnabled) {
      defaultedTab.current = true;
      return;
    }
    if (isSignedIn) {
      setActiveTab('drafts');
      defaultedTab.current = true;
    }
  }, [authEnabled, isSignedIn]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b sticky-header-bg backdrop-blur-md lg:top-0" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="flex items-center gap-2 px-4 py-3">
          <Sparkles className="h-5 w-5" style={{ color: 'var(--accent)' }} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-bold">Pulse</h1>
              <span
                className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
                style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
              >
                Beta — drafts
              </span>
            </div>
            <p className="text-[13px] leading-tight" style={{ color: 'var(--text-secondary)' }}>
              Draft assistant — create, review, and publish posts
            </p>
          </div>
        </div>
        <div className="flex" style={{ borderTop: '1px solid var(--border-primary)' }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 py-3 text-[14px] font-medium transition-colors hover-overlay"
              style={{ color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              <span className="relative inline-block">
                {tab.label}
                {activeTab === tab.id && (
                  <span
                    className="absolute -bottom-[13px] left-0 right-0 h-[3px] rounded-full"
                    style={{ backgroundColor: 'var(--accent)' }}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'chat' && (
        <ChatTab authEnabled={authEnabled} isSignedIn={isSignedIn} getToken={getToken} />
      )}
      {activeTab === 'drafts' && (
        <DraftsTab authEnabled={authEnabled} isSignedIn={isSignedIn} getToken={getToken} />
      )}
      {activeTab === 'settings' && (
        <SettingsTab />
      )}
    </div>
  );
}

function ChatTab({ authEnabled, isSignedIn, getToken }: { authEnabled: boolean; isSignedIn: boolean; getToken: () => Promise<string | null> }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'greeting', role: 'vera', content: VERA_GREETING, timestamp: Date.now() },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const lowerText = text.toLowerCase();
      let veraReply: string;

      if (lowerText.includes('draft') || lowerText.includes('post') || lowerText.includes('write')) {
        if (!authEnabled || !isSignedIn) {
          veraReply = "I can save drafts for you once you sign in. After that, open the Drafts tab to approve or publish.";
        } else {
          const token = await getToken();
          if (!token) {
            veraReply = "I couldn't verify your session. Try signing in again.";
          } else {
            const postContent = text
              .replace(/^(draft|write|post|create|make)\s+(a\s+)?(post|draft)?\s*(about|saying|that says)?\s*/i, '')
              .trim();
            if (postContent.length > 5) {
              await createDraft(token, { body: postContent });
              veraReply = `Draft saved: "${postContent.slice(0, 80)}${postContent.length > 80 ? '...' : ''}". Open the Drafts tab to approve, dismiss, or publish. I don't auto-post.`;
            } else {
              veraReply = "Sure — tell me what the draft should say (a full sentence works best).";
            }
          }
        }
      } else if (lowerText.includes('help') || lowerText.includes('what can')) {
        veraReply =
          "What works today:\n\n" +
          "• **Create drafts** — e.g. \"Draft a post about our product launch\"\n" +
          "• **Review & publish** — Drafts tab → approve/dismiss/publish\n\n" +
          "Not available yet: auto-replies, audience analytics, scheduled posting, or full marketing AI. Those are planned, not live.";
      } else if (lowerText.includes('hello') || lowerText.includes('hi') || lowerText.includes('hey')) {
        veraReply =
          "Hi. I'm a draft assistant — not a full social media AI. Try \"draft a post about…\", then manage it in the Drafts tab.";
      } else if (
        lowerText.includes('schedule') ||
        lowerText.includes('auto-reply') ||
        lowerText.includes('auto reply') ||
        lowerText.includes('analytics') ||
        lowerText.includes('insight') ||
        lowerText.includes('autopilot')
      ) {
        veraReply =
          "That's not available yet. Right now I only create drafts you review in the Drafts tab. Scheduling, auto-replies, and analytics are coming later.";
      } else {
        veraReply =
          "I'm a simple draft helper, not a full AI chatbot. Try \"draft a post about [topic]\" — I'll save it, and you approve/publish from the Drafts tab. Auto-replies, scheduling, and analytics aren't live yet.";
      }

      const veraMsg: ChatMessage = { id: `v-${Date.now()}`, role: 'vera', content: veraReply, timestamp: Date.now() };
      setMessages((prev) => [...prev, veraMsg]);
    } catch {
      const errMsg: ChatMessage = { id: `e-${Date.now()}`, role: 'vera', content: "Sorry, something went wrong. Try again?", timestamp: Date.now() };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 160px)' }}>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`mb-4 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'vera' && (
              <div className="mr-2 mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--accent)' }}>
                <Sparkles className="h-4 w-4" style={{ color: '#000' }} />
              </div>
            )}
            <div
              className="max-w-[80%] rounded-2xl px-4 py-2.5"
              style={{
                backgroundColor: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-elevated)',
                color: msg.role === 'user' ? '#000' : 'var(--text-primary)',
              }}
            >
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}
        {sending && (
          <div className="mb-4 flex justify-start">
            <div className="mr-2 mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--accent)' }}>
              <Sparkles className="h-4 w-4" style={{ color: '#000' }} />
            </div>
            <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
              <div className="flex gap-1">
                <div className="h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: 'var(--text-secondary)', animationDelay: '0ms' }} />
                <div className="h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: 'var(--text-secondary)', animationDelay: '150ms' }} />
                <div className="h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: 'var(--text-secondary)', animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            placeholder="Try: draft a post about…"
            className="flex-1 rounded-full border bg-transparent px-4 py-2.5 text-[15px] outline-none transition-colors focus:border-[var(--accent)]"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
            disabled={sending}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            className="flex h-10 w-10 items-center justify-center rounded-full transition-opacity disabled:opacity-30"
            style={{ backgroundColor: 'var(--accent)' }}
            aria-label="Send message"
          >
            <Send className="h-5 w-5" style={{ color: '#000' }} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DraftsTab({ authEnabled, isSignedIn, getToken }: { authEnabled: boolean; isSignedIn: boolean; getToken: () => Promise<string | null> }) {
  const [drafts, setDrafts] = useState<PulseDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('pending');

  const loadDrafts = useCallback(async () => {
    if (!isSignedIn || !authEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const result = await listDrafts(token, filter === 'all' ? undefined : filter);
      setDrafts(result.drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  }, [getToken, isSignedIn, authEnabled, filter]);

  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      const token = await getToken();
      if (!token) return;
      await approveDraft(token, id);
      await publishDraft(token, id);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDismiss = async (id: string) => {
    setActionLoading(id);
    try {
      const token = await getToken();
      if (!token) return;
      await rejectDraft(token, id, 'Dismissed');
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  if (!authEnabled || !isSignedIn) {
    return (
      <div className="flex flex-col items-center py-16 text-center px-4">
        <Sparkles className="mb-4 h-10 w-10" style={{ color: 'var(--text-secondary)' }} />
        <p className="text-[17px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Sign in to view drafts</p>
        <p className="text-[15px] mb-4" style={{ color: 'var(--text-secondary)' }}>
          Drafts you create with Vera appear here for approve, dismiss, or publish.
        </p>
        {authEnabled && <SignInButton mode="modal"><button type="button" className="rounded-full px-6 py-2.5 text-[15px] font-bold" style={{ backgroundColor: 'var(--accent)', color: '#000' }}>Sign in</button></SignInButton>}
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-2">
          {['pending', 'approved', 'rejected', 'all'].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="rounded-full border px-3 py-1 text-[13px] font-medium transition-colors"
              style={{
                borderColor: filter === f ? 'var(--accent)' : 'var(--border-secondary)',
                color: filter === f ? 'var(--accent)' : 'var(--text-secondary)',
                backgroundColor: filter === f ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void loadDrafts()}
          className="rounded-full p-2 transition-colors hover-overlay"
          style={{ color: 'var(--text-secondary)' }}
          aria-label="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {error && <p className="mb-3 text-[13px]" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-transparent" style={{ borderTopColor: 'var(--accent)' }} />
        </div>
      ) : drafts.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <p className="text-[15px] font-medium" style={{ color: 'var(--text-primary)' }}>No {filter !== 'all' ? filter : ''} drafts</p>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            Use Hey Vera to create a draft, then approve or publish it here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <div key={draft.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
              <p className="text-[15px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>{draft.body}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                  {new Date(draft.createdAt).toLocaleDateString()} · {draft.status}
                </span>
                {draft.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleApprove(draft.id)}
                      disabled={actionLoading === draft.id}
                      className="rounded-full px-3 py-1 text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: 'var(--accent)', color: '#000' }}
                    >
                      {actionLoading === draft.id ? 'Publishing...' : 'Approve & Post'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDismiss(draft.id)}
                      disabled={actionLoading === draft.id}
                      className="rounded-full border px-3 py-1 text-[13px] font-bold transition-colors hover-overlay disabled:opacity-50"
                      style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="px-4 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <div>
          <h2 className="text-[17px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Pulse</h2>
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            What works today and what is still planned.
          </p>
        </div>

        <div className="space-y-4">
          <SettingRow
            label="Draft create → review → publish"
            description="Create drafts from chat or API, then approve, dismiss, or publish in Drafts"
          />
          <SettingRow
            label="Scheduled posting"
            description="Queue posts for later publish times"
            comingSoon
          />
          <SettingRow
            label="Autopilot / auto-replies"
            description="Automated replies and hands-off posting"
            comingSoon
          />
          <SettingRow
            label="Audience insights"
            description="Engagement and growth analytics"
            comingSoon
          />
        </div>

        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
          <p className="text-[14px] font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Available now</p>
          <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            Draft assistant only: create drafts from natural language and manage them in the Drafts tab
            (approve, dismiss, publish). Scheduling, autopilot, and analytics are coming soon — not live.
          </p>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ label, description, comingSoon }: { label: string; description: string; comingSoon?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border p-4" style={{ borderColor: 'var(--border-primary)' }}>
      <div className="pr-3">
        <p className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{description}</p>
      </div>
      {comingSoon ? (
        <span className="flex-shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium" style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-tertiary)' }}>
          Coming soon
        </span>
      ) : (
        <span className="flex-shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
          Live
        </span>
      )}
    </div>
  );
}
