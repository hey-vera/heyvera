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

const VERA_GREETINGS = [
  "Hey! I'm Vera, your social media assistant. I can help you draft posts, manage your content, and keep your presence active. What would you like to do?",
  "Hi there! Ready to help with your social media. You can ask me to draft a post, review your drafts, or plan your content strategy.",
];

function getGreeting(): string {
  return VERA_GREETINGS[Math.floor(Math.random() * VERA_GREETINGS.length)]!;
}

export function AIPage() {
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b sticky-header-bg backdrop-blur-md" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="flex items-center gap-2 px-4 py-3">
          <Sparkles className="h-5 w-5" style={{ color: 'var(--accent)' }} />
          <h1 className="text-[20px] font-bold">Pulse</h1>
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
    { id: 'greeting', role: 'vera', content: getGreeting(), timestamp: Date.now() },
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
          veraReply = "I'd love to draft that for you, but you'll need to sign in first so I can save it to your account.";
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
              veraReply = `Got it! I've created a draft: "${postContent.slice(0, 80)}${postContent.length > 80 ? '...' : ''}". Check the Drafts tab to review and publish it.`;
            } else {
              veraReply = "Sure, I can draft a post for you. What would you like it to say?";
            }
          }
        }
      } else if (lowerText.includes('help') || lowerText.includes('what can')) {
        veraReply = "Here's what I can help with:\n\n• **Draft posts** — \"Write a post about our product launch\"\n• **Review drafts** — Check the Drafts tab to approve or dismiss\n• **Content ideas** — \"Give me post ideas for this week\"\n\nMore features like auto-replies, scheduled posting, and audience insights are coming soon!";
      } else if (lowerText.includes('hello') || lowerText.includes('hi') || lowerText.includes('hey')) {
        veraReply = "Hey! What can I help you with today? I can draft posts, review content, or brainstorm ideas for your social presence.";
      } else {
        veraReply = "I hear you! Right now I can help you draft posts — try saying \"draft a post about [topic]\". More automation features are coming soon, including auto-replies, scheduling, and audience analytics.";
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
            placeholder="Message Vera..."
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
        <p className="text-[15px] mb-4" style={{ color: 'var(--text-secondary)' }}>Your AI-generated drafts will appear here for review.</p>
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
            Chat with Vera to create drafts, or they'll appear here when your AI agent generates content.
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
          <h2 className="text-[17px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Pulse Automation</h2>
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
            Configure how Vera manages your social media presence.
          </p>
        </div>

        <div className="space-y-4">
          <SettingRow label="Auto-reply to mentions" description="Vera responds to people who mention you" comingSoon />
          <SettingRow label="Scheduled posting" description="Queue posts to publish at optimal times" comingSoon />
          <SettingRow label="Audience insights" description="Track engagement and follower growth" comingSoon />
          <SettingRow label="Content suggestions" description="Get personalized post ideas daily" comingSoon />
        </div>

        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}>
          <p className="text-[14px] font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Free tier</p>
          <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            You get generous automation for free — draft posts, basic scheduling, and content review. Upgrade for higher volume auto-replies, advanced analytics, and priority AI processing.
          </p>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ label, description, comingSoon }: { label: string; description: string; comingSoon?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border p-4" style={{ borderColor: 'var(--border-primary)' }}>
      <div>
        <p className="text-[14px] font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{description}</p>
      </div>
      {comingSoon ? (
        <span className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium" style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-tertiary)' }}>
          Soon
        </span>
      ) : (
        <div className="h-5 w-9 rounded-full" style={{ backgroundColor: 'var(--border-secondary)' }} />
      )}
    </div>
  );
}
