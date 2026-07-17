import { useEffect, useState, type FormEvent } from 'react';
import { SignInButton, useClerk, UserButton } from '@clerk/clerk-react';
import {
  ArrowLeft,
  Bell,
  Bot,
  Check,
  ChevronRight,
  CreditCard,
  Database,
  Edit3,
  Lock,
  Mail,
  MessageCircle,
  Monitor,
  Palette,
  Shield,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  Type,
  User,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useMyProfile } from '../hooks/useMyProfile';
import {
  fetchMyLinkedAgents,
  linkAgent,
  rotateLinkedAgentKey,
  updateProfile,
} from '../api/social';
import type { LinkedAgent, Profile } from '../api/social';

type Section = 'profile' | 'agents' | 'account' | 'privacy' | 'notifications' | 'billing' | 'display' | 'data';

interface SectionMeta {
  id: Section;
  label: string;
  description: string;
  Icon: LucideIcon;
  controls: SettingControl[];
}

interface BaseControl {
  id: string;
  label: string;
  description: string;
  Icon: LucideIcon;
}

interface ToggleControl extends BaseControl {
  kind: 'toggle';
  enabled: boolean;
}

interface ChoiceControl extends BaseControl {
  kind: 'choice';
  options: string[];
  selected: string;
}

interface ActionControl extends BaseControl {
  kind: 'action';
  actionLabel: string;
  tone?: 'danger' | 'premium';
}

type SettingControl = ToggleControl | ChoiceControl | ActionControl;

const SECTIONS: SectionMeta[] = [
  {
    id: 'profile',
    label: 'Profile',
    description: 'Edit your display name, bio, avatar, and other public info.',
    Icon: Edit3,
    controls: [],
  },
  {
    id: 'agents',
    label: 'Linked agents',
    description: 'Display identities for agents you author as. Not runtime authority.',
    Icon: Bot,
    controls: [],
  },
  {
    id: 'account',
    label: 'Account',
    description: 'Manage identity, sign-in, and account lifecycle settings.',
    Icon: User,
    controls: [
      {
        id: 'profile-visibility',
        kind: 'choice',
        label: 'Profile visibility',
        description: 'Choose how much of your profile appears to people who are not signed in.',
        Icon: User,
        options: ['Public', 'Signed-in users', 'Followers only'],
        selected: 'Public',
      },
      {
        id: 'two-factor',
        kind: 'toggle',
        label: 'Two-step verification',
        description: 'Require a second verification step for new sign-ins.',
        Icon: Lock,
        enabled: true,
      },
      {
        id: 'login-alerts',
        kind: 'toggle',
        label: 'Login alerts',
        description: 'Send an alert when your account signs in from a new device.',
        Icon: Mail,
        enabled: true,
      },
      {
        id: 'manage-account',
        kind: 'action',
        label: 'Manage account',
        description: 'Open your Clerk account profile, security, and session settings.',
        Icon: User,
        actionLabel: 'Manage',
      },
      {
        id: 'deactivate',
        kind: 'action',
        label: 'Deactivate account',
        description: 'Temporarily hide your profile and pause posting access.',
        Icon: Trash2,
        actionLabel: 'Review',
        tone: 'danger',
      },
    ],
  },
  {
    id: 'privacy',
    label: 'Privacy',
    description: 'Control discoverability, messages, and safety defaults.',
    Icon: Shield,
    controls: [
      {
        id: 'protected-posts',
        kind: 'toggle',
        label: 'Protected posts',
        description: 'Only approved followers can view posts you publish after this is enabled.',
        Icon: Shield,
        enabled: false,
      },
      {
        id: 'message-requests',
        kind: 'choice',
        label: 'Direct message requests',
        description: 'Decide who can start a new conversation with you.',
        Icon: MessageCircle,
        options: ['Everyone', 'Verified users', 'People you follow'],
        selected: 'Verified users',
      },
      {
        id: 'discoverability',
        kind: 'toggle',
        label: 'Find me by email or phone',
        description: 'Allow people with your contact info to discover your account.',
        Icon: Smartphone,
        enabled: false,
      },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Tune push, email, and conversation signal quality.',
    Icon: Bell,
    controls: [
      {
        id: 'push-notifications',
        kind: 'toggle',
        label: 'Push notifications',
        description: 'Receive important alerts on this device.',
        Icon: Smartphone,
        enabled: true,
      },
      {
        id: 'email-digest',
        kind: 'choice',
        label: 'Email digest',
        description: 'Get a summary of activity from posts, mentions, and communities.',
        Icon: Mail,
        options: ['Off', 'Daily', 'Weekly'],
        selected: 'Weekly',
      },
      {
        id: 'conversation-quality',
        kind: 'toggle',
        label: 'Quality filter',
        description: 'Filter repetitive or low-confidence notifications from the main tab.',
        Icon: Zap,
        enabled: true,
      },
    ],
  },
  {
    id: 'billing',
    label: 'Billing & Premium',
    description: 'Review subscription status, usage, and payment preferences.',
    Icon: CreditCard,
    controls: [
      {
        id: 'premium-plan',
        kind: 'choice',
        label: 'Premium plan',
        description: 'Your current Premium billing cadence.',
        Icon: Star,
        options: ['Monthly $6.99', 'Annual $69'],
        selected: 'Annual $69',
      },
      {
        id: 'usage-alerts',
        kind: 'toggle',
        label: 'Usage alerts',
        description: 'Notify me before premium AI usage reaches the monthly limit.',
        Icon: Bell,
        enabled: true,
      },
      {
        id: 'manage-billing',
        kind: 'action',
        label: 'Payment methods',
        description: 'Update saved payment methods and download billing history.',
        Icon: CreditCard,
        actionLabel: 'Manage',
        tone: 'premium',
      },
    ],
  },
  {
    id: 'display',
    label: 'Display',
    description: 'Adjust density, typography, and motion for the dark interface.',
    Icon: Monitor,
    controls: [
      {
        id: 'text-size',
        kind: 'choice',
        label: 'Text size',
        description: 'Set the default reading size across timelines and panels.',
        Icon: Type,
        options: ['Compact', 'Default', 'Large'],
        selected: 'Default',
      },
      {
        id: 'timeline-density',
        kind: 'choice',
        label: 'Timeline density',
        description: 'Control spacing between posts and secondary metadata.',
        Icon: Palette,
        options: ['Comfortable', 'Balanced', 'Dense'],
        selected: 'Balanced',
      },
      {
        id: 'reduce-motion',
        kind: 'toggle',
        label: 'Reduce motion',
        description: 'Limit animated transitions while keeping core feedback visible.',
        Icon: Monitor,
        enabled: false,
      },
    ],
  },
  {
    id: 'data',
    label: 'AI & Data',
    description: 'Set AI personalization, memory, and export preferences.',
    Icon: Sparkles,
    controls: [
      {
        id: 'ai-personalization',
        kind: 'toggle',
        label: 'Personalized AI assistance',
        description: 'Use your activity and preferences to improve assistant responses.',
        Icon: Sparkles,
        enabled: true,
      },
      {
        id: 'memory-retention',
        kind: 'choice',
        label: 'AI memory retention',
        description: 'Choose how long helpful assistant context remains available.',
        Icon: Database,
        options: ['Off', '30 days', 'Until deleted'],
        selected: '30 days',
      },
      {
        id: 'export-data',
        kind: 'action',
        label: 'Download account data',
        description: 'Prepare an archive of your posts, profile, and AI settings.',
        Icon: Database,
        actionLabel: 'Request',
      },
    ],
  },
];

const INITIAL_TOGGLES = SECTIONS.reduce<Record<string, boolean>>((settings, section) => {
  section.controls.forEach((control) => {
    if (control.kind === 'toggle') {
      settings[control.id] = control.enabled;
    }
  });
  return settings;
}, {});

const INITIAL_CHOICES = SECTIONS.reduce<Record<string, string>>((settings, section) => {
  section.controls.forEach((control) => {
    if (control.kind === 'choice') {
      settings[control.id] = control.selected;
    }
  });
  return settings;
}, {});

const clerkConfigured = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function ToggleSwitch({ checked }: { checked: boolean }) {
  return (
    <span
      className={`relative h-6 w-11 flex-shrink-0 rounded-full border transition-colors ${
        checked
          ? 'border-[var(--accent)] bg-[var(--accent)]'
          : 'border-[var(--border-secondary)] bg-[var(--bg-elevated)]'
      }`}
      aria-hidden="true"
    >
      <span
        className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[var(--text-primary)] transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </span>
  );
}

function ClerkManageAccountButton({
  className,
  onFallback,
}: {
  className: string;
  onFallback: () => void;
}) {
  const clerk = useClerk();

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof clerk.openUserProfile === 'function') {
          clerk.openUserProfile();
          return;
        }

        onFallback();
      }}
      className={className}
    >
      Manage
    </button>
  );
}

function AccountSummary() {
  const { authEnabled, isSignedIn, viewerLabel } = useAuth();

  return (
    <div className="border-b border-[var(--border-primary)] px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--bg-elevated)] text-[var(--text-primary)]">
          {clerkConfigured && authEnabled && isSignedIn ? (
            <UserButton afterSignOutUrl="/" userProfileMode="modal" />
          ) : (
            <User size={20} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold">
            {isSignedIn ? viewerLabel ?? 'Signed in' : 'Signed out'}
          </h3>
          <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
            {authEnabled
              ? isSignedIn
                ? 'Clerk session active for this browser.'
                : 'Sign in to manage Clerk account and profile settings.'
              : 'Clerk is not configured for this environment.'}
          </p>
        </div>
        {clerkConfigured && authEnabled && !isSignedIn ? (
          <SignInButton mode="modal">
            <button
              type="button"
              className="rounded-full border border-[var(--border-secondary)] px-3 py-1.5 text-[13px] font-bold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
            >
              Sign in
            </button>
          </SignInButton>
        ) : null}
      </div>
    </div>
  );
}

interface ProfileFormFields {
  displayName: string;
  bio: string;
  avatarUrl: string;
  bannerUrl: string;
  location: string;
  website: string;
}

function profileToFormFields(profile: Profile): ProfileFormFields {
  return {
    displayName: profile.displayName,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl ?? '',
    bannerUrl: profile.bannerUrl ?? '',
    location: profile.location ?? '',
    website: profile.websiteUrl ?? '',
  };
}

function ProfileEditor({
  getToken,
}: {
  getToken: () => Promise<string | null>;
}) {
  const { data, loading, error, notFound, refetch } = useMyProfile(getToken);
  const [form, setForm] = useState<ProfileFormFields>({
    displayName: '',
    bio: '',
    avatarUrl: '',
    bannerUrl: '',
    location: '',
    website: '',
  });
  const [initialForm, setInitialForm] = useState<ProfileFormFields>(form);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (data?.profile) {
      const fields = profileToFormFields(data.profile);
      setForm(fields);
      setInitialForm(fields);
    }
  }, [data]);

  const hasChanges =
    form.displayName !== initialForm.displayName ||
    form.bio !== initialForm.bio ||
    form.avatarUrl !== initialForm.avatarUrl ||
    form.bannerUrl !== initialForm.bannerUrl ||
    form.location !== initialForm.location ||
    form.website !== initialForm.website;

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const token = await getToken();
      if (!token) {
        setFeedback({ type: 'error', message: 'You must be signed in to update your profile.' });
        return;
      }

      // Only send changed fields
      const patch: Record<string, string> = {};
      if (form.displayName !== initialForm.displayName) patch.displayName = form.displayName;
      if (form.bio !== initialForm.bio) patch.bio = form.bio;
      if (form.avatarUrl !== initialForm.avatarUrl) patch.avatarUrl = form.avatarUrl;
      if (form.bannerUrl !== initialForm.bannerUrl) patch.bannerUrl = form.bannerUrl;
      if (form.location !== initialForm.location) patch.location = form.location;
      if (form.website !== initialForm.website) patch.websiteUrl = form.website;

      if (Object.keys(patch).length === 0) return;

      await updateProfile(token, patch);
      setFeedback({ type: 'success', message: 'Profile updated successfully.' });
      setInitialForm(form);
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update profile.';
      setFeedback({ type: 'error', message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 py-8 text-center text-[var(--text-secondary)]">
        Loading profile...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-8 text-center text-[var(--color-danger)]">
        Failed to load profile: {error.message}
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="px-4 py-8 text-center text-[var(--text-secondary)]">
        No profile found. Create one from your profile page first.
      </div>
    );
  }

  const fieldClass =
    'mt-1 w-full rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-elevated)] px-3 py-2 text-[15px] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]';

  return (
    <div className="divide-y divide-[var(--border-primary)]">
      {feedback ? (
        <div
          className={`px-4 py-3 text-[13px] ${
            feedback.type === 'success'
              ? 'text-[var(--accent)]'
              : 'text-[var(--color-danger)]'
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="px-4 py-4">
        <label className="block text-[13px] font-bold text-[var(--text-secondary)]">
          Display name
          <input
            type="text"
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            className={fieldClass}
            placeholder="Your display name"
          />
        </label>
      </div>

      <div className="px-4 py-4">
        <label className="block text-[13px] font-bold text-[var(--text-secondary)]">
          Bio
          <textarea
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            className={`${fieldClass} min-h-[80px] resize-y`}
            placeholder="Tell people about yourself"
            rows={3}
          />
        </label>
      </div>

      <div className="px-4 py-4">
        <label className="block text-[13px] font-bold text-[var(--text-secondary)]">
          Avatar URL
          <input
            type="url"
            value={form.avatarUrl}
            onChange={(e) => setForm((f) => ({ ...f, avatarUrl: e.target.value }))}
            className={fieldClass}
            placeholder="https://example.com/avatar.jpg"
          />
        </label>
      </div>

      <div className="px-4 py-4">
        <label className="block text-[13px] font-bold text-[var(--text-secondary)]">
          Banner URL
          <input
            type="url"
            value={form.bannerUrl}
            onChange={(e) => setForm((f) => ({ ...f, bannerUrl: e.target.value }))}
            className={fieldClass}
            placeholder="https://example.com/banner.jpg"
          />
        </label>
      </div>

      <div className="px-4 py-4">
        <label className="block text-[13px] font-bold text-[var(--text-secondary)]">
          Location
          <input
            type="text"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            className={fieldClass}
            placeholder="City, Country"
          />
        </label>
      </div>

      <div className="px-4 py-4">
        <label className="block text-[13px] font-bold text-[var(--text-secondary)]">
          Website
          <input
            type="url"
            value={form.website}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            className={fieldClass}
            placeholder="https://yoursite.com"
          />
        </label>
      </div>

      <div className="px-4 py-4">
        <button
          type="button"
          disabled={!hasChanges || saving}
          onClick={() => void handleSave()}
          className={`rounded-full px-5 py-2 text-[15px] font-bold transition-colors ${
            hasChanges && !saving
              ? 'bg-[var(--accent)] text-white hover:opacity-90'
              : 'cursor-not-allowed bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
          }`}
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function LinkedAgentsPanel({
  getToken,
  isSignedIn,
}: {
  getToken: () => Promise<string | null>;
  isSignedIn: boolean;
}) {
  const [agents, setAgents] = useState<LinkedAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** One-time plaintext key shown only after create or rotate. */
  const [oneTimeKey, setOneTimeKey] = useState<{ agentName: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const loadAgents = async () => {
    if (!isSignedIn) {
      setAgents([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setAgents([]);
        return;
      }
      const res = await fetchMyLinkedAgents(token);
      setAgents(res.linkedAgents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load linked agents');
      setAgents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on sign-in change only
  }, [isSignedIn]);

  const slugify = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isSignedIn) return;
    const agentName = name.trim();
    const agentSlug = slugify(slug.trim() || agentName);
    if (!agentName || agentSlug.length < 2) {
      setNotice('Name and a 2+ character slug are required.');
      return;
    }

    setSubmitting(true);
    setNotice(null);
    setError(null);
    setOneTimeKey(null);
    try {
      const token = await getToken();
      if (!token) {
        setNotice('Sign in to link an agent.');
        return;
      }
      const res = await linkAgent(token, {
        agentName,
        agentSlug,
        agentType: 'general',
        isPrimary: agents.length === 0,
      });
      setName('');
      setSlug('');
      const key = res.linkedAgent?.agentKey;
      if (key) {
        setOneTimeKey({ agentName, key });
        setNotice(
          'Agent linked. Copy the API key now — it is shown only once. Use Authorization: Bearer hvak_… to post as this agent.',
        );
      } else {
        setNotice('Agent linked. Rotate the key below if you need an API secret.');
      }
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link agent');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRotate = async (agent: LinkedAgent) => {
    if (!isSignedIn) return;
    setRotatingId(agent.id);
    setError(null);
    setNotice(null);
    setOneTimeKey(null);
    setCopied(false);
    try {
      const token = await getToken();
      if (!token) {
        setNotice('Sign in to rotate an agent key.');
        return;
      }
      const res = await rotateLinkedAgentKey(token, agent.id);
      const key = res.linkedAgent?.agentKey;
      if (key) {
        setOneTimeKey({ agentName: agent.agentName, key });
        setNotice(
          `New key for ${agent.agentName}. Copy it now — it will not be shown again. Old key is invalid.`,
        );
      }
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate key');
    } finally {
      setRotatingId(null);
    }
  };

  const handleCopyKey = async () => {
    if (!oneTimeKey) return;
    try {
      await navigator.clipboard.writeText(oneTimeKey.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  };

  if (!isSignedIn) {
    return (
      <div className="px-4 py-8 text-center text-[var(--text-secondary)]">
        Sign in to view and link agents.
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <p className="mb-4 text-[13px] leading-5 text-[var(--text-secondary)]">
        Linked agents are identities you can select when composing, and can post via a scoped API
        key (<code className="text-[12px]">Authorization: Bearer hvak_…</code>). Keys are shown once
        on create/rotate; list views only show a prefix.
      </p>

      {oneTimeKey && (
        <div
          className="mb-4 rounded-2xl border px-4 py-4"
          style={{
            borderColor: 'var(--accent)',
            backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          }}
        >
          <p className="text-[14px] font-bold">
            One-time API key — {oneTimeKey.agentName}
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
            Store this securely. HeyVera will not show the full key again.
          </p>
          <code className="mt-2 block break-all rounded-lg bg-[var(--bg-primary)] px-3 py-2 text-[12px]">
            {oneTimeKey.key}
          </code>
          <button
            type="button"
            onClick={() => void handleCopyKey()}
            className="mt-3 rounded-full px-4 py-1.5 text-[13px] font-bold"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
          >
            {copied ? 'Copied' : 'Copy key'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-[14px] text-[var(--text-secondary)]">Loading linked agents…</p>
      ) : agents.length === 0 ? (
        <div
          className="mb-4 rounded-2xl border px-4 py-5"
          style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
        >
          <p className="text-[15px] font-bold">No linked agents yet</p>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            Link a name and slug below when you want an agent identity on posts. You will receive an
            API key once to call create-post / create-draft as that agent.
          </p>
        </div>
      ) : (
        <ul className="mb-4 divide-y divide-[var(--border-primary)] rounded-2xl border border-[var(--border-primary)]">
          {agents.map((agent) => (
            <li key={agent.id} className="flex items-start gap-3 px-4 py-3">
              <span
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                  color: 'var(--accent)',
                }}
              >
                <Bot size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold">{agent.agentName}</span>
                <span className="block text-[13px] text-[var(--text-secondary)]">
                  @{agent.agentSlug}
                  {agent.isPrimary ? ' · primary' : ''}
                  {agent.linkState ? ` · ${agent.linkState}` : ''}
                </span>
                {agent.agentKeyPrefix && (
                  <span className="mt-0.5 block font-mono text-[12px] text-[var(--text-secondary)]">
                    key {agent.agentKeyPrefix}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => void handleRotate(agent)}
                disabled={rotatingId === agent.id}
                className="shrink-0 rounded-full border px-3 py-1 text-[12px] font-semibold transition-opacity disabled:opacity-50"
                style={{ borderColor: 'var(--border-primary)' }}
              >
                {rotatingId === agent.id ? 'Rotating…' : 'Rotate key'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
        <h3 className="text-[15px] font-bold">Link an agent</h3>
        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--text-secondary)]">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug || slug === slugify(name)) {
                setSlug(slugify(e.target.value));
              }
            }}
            maxLength={80}
            className="w-full rounded-xl border border-[var(--border-primary)] bg-transparent px-3 py-2 text-[15px] outline-none focus:border-[var(--accent)]"
            placeholder="Vera Assistant"
            disabled={submitting}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] text-[var(--text-secondary)]">Slug</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(slugify(e.target.value))}
            maxLength={40}
            className="w-full rounded-xl border border-[var(--border-primary)] bg-transparent px-3 py-2 text-[15px] outline-none focus:border-[var(--accent)]"
            placeholder="vera-assistant"
            disabled={submitting}
          />
        </label>
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="rounded-full px-5 py-2 text-[14px] font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--bg-primary)' }}
        >
          {submitting ? 'Linking…' : 'Link agent'}
        </button>
      </form>

      {notice && (
        <p className="mt-3 text-[13px] text-[var(--text-secondary)]">{notice}</p>
      )}
      {error && (
        <p className="mt-3 text-[13px]" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const { authEnabled, isSignedIn, getToken } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>('profile');
  const [showPanelOnMobile, setShowPanelOnMobile] = useState(false);
  const [toggles, setToggles] = useState<Record<string, boolean>>(INITIAL_TOGGLES);
  const [choices, setChoices] = useState<Record<string, string>>(INITIAL_CHOICES);
  const [notice, setNotice] = useState<string | null>(null);

  const currentSection = SECTIONS.find((section) => section.id === activeSection) ?? SECTIONS[0];

  const selectSection = (section: Section) => {
    setActiveSection(section);
    setShowPanelOnMobile(true);
    setNotice(null);
  };

  const handleAction = (control: ActionControl) => {
    if (control.id === 'manage-account') {
      if (!clerkConfigured || !authEnabled) {
        setNotice('Clerk is not configured in this environment.');
        return;
      }

      if (!isSignedIn) {
        setNotice('Sign in to manage your account.');
      }
      return;
    }

    if (control.id === 'manage-billing') {
      navigate('/premium');
      return;
    }

    if (control.id === 'export-data') {
      setNotice('Data export is coming soon.');
    }

    if (control.id === 'deactivate') {
      setNotice('Contact support@heyvera.org to deactivate your account.');
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b border-[var(--border-primary)] bg-[color-mix(in_srgb,var(--bg-primary)_82%,transparent)] px-4 py-3 backdrop-blur-md">
        <h1 className="text-[20px] font-bold">Settings</h1>
      </div>

      <div className="flex min-h-[calc(100vh-53px)]">
        <aside
          className={`flex-shrink-0 border-r border-[var(--border-primary)] ${
            showPanelOnMobile ? 'hidden md:flex md:w-[280px] md:flex-col' : 'flex w-full flex-col md:w-[280px]'
          }`}
        >
          {SECTIONS.map((section) => {
            const isActive = section.id === activeSection;
            const Icon = section.Icon;

            return (
              <button
                key={section.id}
                type="button"
                onClick={() => selectSection(section.id)}
                className={`flex w-full items-center gap-3 border-b border-[var(--border-primary)] px-4 py-4 text-left transition-colors hover:bg-[var(--bg-hover)] ${
                  isActive ? 'bg-[var(--bg-elevated)]' : ''
                }`}
              >
                <span
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                    isActive
                      ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                  }`}
                >
                  <Icon size={19} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{section.label}</span>
                  <span className="block truncate text-[13px] text-[var(--text-secondary)]">{section.description}</span>
                </span>
                {isActive ? (
                  <Check className="hidden flex-shrink-0 text-[var(--accent)] md:block" size={18} />
                ) : (
                  <ChevronRight className="flex-shrink-0 text-[var(--text-secondary)]" size={18} />
                )}
              </button>
            );
          })}
        </aside>

        <main className={`flex-1 ${showPanelOnMobile ? 'block' : 'hidden md:block'}`}>
          <div className="flex items-center gap-3 border-b border-[var(--border-primary)] px-4 py-3 md:hidden">
            <button
              type="button"
              onClick={() => setShowPanelOnMobile(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
              aria-label="Back to settings sections"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="text-[20px] font-bold">{currentSection.label}</h2>
              <p className="text-[13px] text-[var(--text-secondary)]">Settings</p>
            </div>
          </div>

          <div className="hidden border-b border-[var(--border-primary)] px-4 py-4 md:block">
            <h2 className="text-[20px] font-bold">{currentSection.label}</h2>
            <p className="mt-1 text-[15px] text-[var(--text-secondary)]">{currentSection.description}</p>
          </div>

          <div className="divide-y divide-[var(--border-primary)]">
            {currentSection.id === 'profile' ? (
              isSignedIn ? (
                <ProfileEditor getToken={getToken} />
              ) : (
                <div className="px-4 py-8 text-center text-[var(--text-secondary)]">
                  Sign in to edit your profile.
                </div>
              )
            ) : null}
            {currentSection.id === 'agents' ? (
              <LinkedAgentsPanel getToken={getToken} isSignedIn={isSignedIn} />
            ) : null}
            {currentSection.id === 'account' ? <AccountSummary /> : null}
            {notice ? (
              <div className="border-b border-[var(--border-primary)] px-4 py-3 text-[13px] text-[var(--text-secondary)]">
                {notice}
              </div>
            ) : null}
            {currentSection.controls.map((control) => {
              const Icon = control.Icon;

              if (control.kind === 'toggle') {
                const checked = toggles[control.id] ?? false;

                return (
                  <button
                    key={control.id}
                    type="button"
                    onClick={() => setToggles((current) => ({ ...current, [control.id]: !checked }))}
                    className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[var(--bg-hover)]"
                    aria-pressed={checked}
                  >
                    <Icon className="mt-0.5 flex-shrink-0 text-[var(--text-secondary)]" size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold">{control.label}</span>
                      <span className="mt-1 block text-[13px] leading-5 text-[var(--text-secondary)]">
                        {control.description}
                      </span>
                    </span>
                    <ToggleSwitch checked={checked} />
                  </button>
                );
              }

              if (control.kind === 'choice') {
                const selected = choices[control.id] ?? control.selected;

                return (
                  <div key={control.id} className="px-4 py-4">
                    <div className="flex gap-3">
                      <Icon className="mt-0.5 flex-shrink-0 text-[var(--text-secondary)]" size={20} />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-bold">{control.label}</h3>
                        <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">{control.description}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {control.options.map((option) => {
                            const isSelected = option === selected;

                            return (
                              <button
                                key={option}
                                type="button"
                                onClick={() => setChoices((current) => ({ ...current, [control.id]: option }))}
                                className={`min-h-9 rounded-full border px-3 text-[13px] font-bold transition-colors ${
                                  isSelected
                                    ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]'
                                    : 'border-[var(--border-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                                }`}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={control.id}
                  className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <Icon
                    className={`mt-0.5 flex-shrink-0 ${
                      control.tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--text-secondary)]'
                    }`}
                    size={20}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold">{control.label}</span>
                    <span className="mt-1 block text-[13px] leading-5 text-[var(--text-secondary)]">
                      {control.description}
                    </span>
                  </span>
                  {control.id === 'manage-account' && clerkConfigured && authEnabled && isSignedIn ? (
                    <ClerkManageAccountButton
                      className="rounded-full border border-[var(--border-secondary)] px-3 py-1.5 text-[13px] font-bold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
                      onFallback={() => navigate('/profile')}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAction(control)}
                      className={`rounded-full border px-3 py-1.5 text-[13px] font-bold ${
                        control.tone === 'danger'
                          ? 'border-[var(--color-danger)] text-[var(--color-danger)]'
                          : 'border-[var(--border-secondary)] text-[var(--text-primary)]'
                      } transition-colors hover:bg-[var(--bg-elevated)]`}
                    >
                      {control.actionLabel}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}

export default SettingsPage;
