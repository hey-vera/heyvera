import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { SignInButton, useClerk, UserButton } from '@clerk/clerk-react';
import {
  ArrowLeft,
  Bell,
  Bot,
  Building2,
  Check,
  ChevronRight,
  CreditCard,
  Database,
  Edit3,
  ImagePlus,
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
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { useMyProfile } from '../hooks/useMyProfile';
import {
  createBrandPage,
  fetchMyBlocks,
  fetchMyLinkedAgents,
  fetchMyMutes,
  fetchMyPrefs,
  fetchX402Status,
  linkAgent,
  listMyPages,
  postX402PaidPing,
  rotateLinkedAgentKey,
  unblockUser,
  unmuteUser,
  updateLinkedAgentPolicies,
  updateMyPrefs,
  updateProfile,
  uploadMediaFile,
} from '../api/social';
import type {
  LinkedAgent,
  ModerationListEntry,
  Profile,
  SocialPage,
  X402PaidPingResult,
  X402Status,
} from '../api/social';
import {
  formatX402PaidPingResult,
  showX402PaidAction,
} from '../utils/x402Enabled';
import {
  AGENT_POLICY_FOUNDATION_DETAIL,
  AGENT_POLICY_NOT_LIVE_BADGE,
  AGENT_POLICY_SECTION_TITLE,
  normalizeAgentPolicyFlags,
} from '../utils/agentPolicy';
import { ALLOWED_IMAGE_ACCEPT, validateImageFile } from '../utils/imageUpload';
import { brandPagePath } from '../utils/guildVisibility';
import {
  normalizeSocialPrefs,
  prefsPatchToApiBody,
  prefsToChoiceState,
  prefsToToggleState,
  settingsControlToPrefsPatch,
} from '../utils/privacyPrefs';
import {
  applyReduceMotionPreference,
  readDevicePrefs,
  settingsControlMeta,
  writeDevicePref,
} from '../utils/settingsControlMeta';

type Section =
  | 'profile'
  | 'agents'
  | 'pages'
  | 'account'
  | 'privacy'
  | 'notifications'
  | 'billing'
  | 'display'
  | 'data';

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
    id: 'pages',
    label: 'Brand pages',
    description: 'Lightweight brand Pages you own. Multi-Page marketplace is not complete.',
    Icon: Building2,
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
        description:
          'Configure MFA in Clerk (Manage account). This row is not a HeyVera account toggle.',
        Icon: Lock,
        enabled: false,
      },
      {
        id: 'login-alerts',
        kind: 'toggle',
        label: 'Login alerts',
        description:
          'New-device login alerts are not wired to the account API yet.',
        Icon: Mail,
        enabled: false,
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
      {
        id: 'show-in-search',
        kind: 'toggle',
        label: 'Show in search',
        description: 'Allow your profile to appear in HeyVera profile search results.',
        Icon: Sparkles,
        enabled: true,
      },
      {
        id: 'allow-agent-dms',
        kind: 'toggle',
        label: 'Allow agent DMs',
        description: 'Let linked agents message you. Preference is saved; agent runtime is limited.',
        Icon: Bot,
        enabled: false,
      },
      {
        id: 'allow-agent-mentions',
        kind: 'toggle',
        label: 'Allow agent mentions',
        description: 'Let agents @mention you in posts. Preference is saved for future enforcement.',
        Icon: Bot,
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
        description: 'Preference for alerts on this browser only (no push subscription API yet).',
        Icon: Smartphone,
        enabled: true,
      },
      {
        id: 'email-digest',
        kind: 'choice',
        label: 'Email digest',
        description: 'Email digests are not saved to your account yet.',
        Icon: Mail,
        options: ['Off', 'Daily', 'Weekly'],
        selected: 'Weekly',
      },
      {
        id: 'conversation-quality',
        kind: 'toggle',
        label: 'Quality filter',
        description: 'Filter low-confidence notification chrome on this device.',
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
        kind: 'action',
        label: 'Premium plan',
        description: 'View real Premium plans and billing on the Premium page (not a fake toggle).',
        Icon: Star,
        actionLabel: 'View Premium',
        tone: 'premium',
      },
      {
        id: 'usage-alerts',
        kind: 'toggle',
        label: 'Usage alerts',
        description: 'Usage alert prefs are not saved to your account yet.',
        Icon: Bell,
        enabled: false,
      },
      {
        id: 'manage-billing',
        kind: 'action',
        label: 'Payment methods',
        description: 'Open Premium for billing and payment management.',
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
        description: 'Not wired to account prefs — Pulse drafts do not invent personalization.',
        Icon: Sparkles,
        enabled: false,
      },
      {
        id: 'memory-retention',
        kind: 'choice',
        label: 'AI memory retention',
        description: 'Not saved to your account yet (no server memory product).',
        Icon: Database,
        options: ['Off', '30 days', 'Until deleted'],
        selected: 'Off',
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

function PersistBadge({ controlId }: { controlId: string }) {
  const meta = settingsControlMeta(controlId);
  if (meta.persists === 'account') return null;
  return (
    <span
      className="mt-1 inline-block rounded-full border border-[var(--border-secondary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]"
      data-persist={meta.persists}
    >
      {meta.label}
    </span>
  );
}

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
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (data?.profile) {
      const fields = profileToFormFields(data.profile);
      setForm(fields);
      setInitialForm(fields);
    }
  }, [data]);

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    };
  }, [avatarPreview, bannerPreview]);

  const busy = saving || uploading;
  const hasChanges =
    form.displayName !== initialForm.displayName ||
    form.bio !== initialForm.bio ||
    form.avatarUrl !== initialForm.avatarUrl ||
    form.bannerUrl !== initialForm.bannerUrl ||
    form.location !== initialForm.location ||
    form.website !== initialForm.website ||
    avatarFile !== null ||
    bannerFile !== null;

  const clearAvatarFile = () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const clearBannerFile = () => {
    if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    setBannerFile(null);
    setBannerPreview(null);
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  const onPickImage = (kind: 'avatar' | 'banner', event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    const validationError = validateImageFile(file);
    if (validationError) {
      setFeedback({ type: 'error', message: validationError });
      if (kind === 'avatar') clearAvatarFile();
      else clearBannerFile();
      return;
    }

    const preview = URL.createObjectURL(file);
    if (kind === 'avatar') {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarFile(file);
      setAvatarPreview(preview);
    } else {
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
      setBannerFile(file);
      setBannerPreview(preview);
    }
    setFeedback(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const token = await getToken();
      if (!token) {
        setFeedback({ type: 'error', message: 'You must be signed in to update your profile.' });
        return;
      }

      let nextAvatarUrl = form.avatarUrl;
      let nextBannerUrl = form.bannerUrl;

      if (avatarFile || bannerFile) {
        setUploading(true);
        if (avatarFile) {
          const uploaded = await uploadMediaFile(token, avatarFile);
          nextAvatarUrl = uploaded.url;
        }
        if (bannerFile) {
          const uploaded = await uploadMediaFile(token, bannerFile);
          nextBannerUrl = uploaded.url;
        }
        setUploading(false);
      }

      // Only send changed fields
      const patch: Record<string, string> = {};
      if (form.displayName !== initialForm.displayName) patch.displayName = form.displayName;
      if (form.bio !== initialForm.bio) patch.bio = form.bio;
      if (nextAvatarUrl !== initialForm.avatarUrl) patch.avatarUrl = nextAvatarUrl;
      if (nextBannerUrl !== initialForm.bannerUrl) patch.bannerUrl = nextBannerUrl;
      if (form.location !== initialForm.location) patch.location = form.location;
      if (form.website !== initialForm.website) patch.websiteUrl = form.website;

      if (Object.keys(patch).length === 0) return;

      await updateProfile(token, patch);
      const nextForm: ProfileFormFields = {
        ...form,
        avatarUrl: nextAvatarUrl,
        bannerUrl: nextBannerUrl,
      };
      setForm(nextForm);
      setInitialForm(nextForm);
      clearAvatarFile();
      clearBannerFile();
      setFeedback({ type: 'success', message: 'Profile updated successfully.' });
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update profile.';
      setFeedback({ type: 'error', message });
    } finally {
      setUploading(false);
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

  const avatarDisplay = avatarPreview || form.avatarUrl || null;
  const bannerDisplay = bannerPreview || form.bannerUrl || null;

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
            disabled={busy}
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
            disabled={busy}
          />
        </label>
      </div>

      <div className="px-4 py-4">
        <span className="block text-[13px] font-bold text-[var(--text-secondary)]">Avatar</span>
        <div className="mt-2 flex items-center gap-4">
          <div
            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-[var(--border-secondary)] bg-[var(--bg-elevated)]"
          >
            {avatarDisplay ? (
              <img src={avatarDisplay} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-[var(--text-secondary)]">
                —
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <input
              ref={avatarInputRef}
              type="file"
              accept={ALLOWED_IMAGE_ACCEPT}
              className="hidden"
              onChange={(event) => onPickImage('avatar', event)}
              disabled={busy}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-[var(--accent)] transition-colors hover-overlay disabled:opacity-50"
              >
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                Upload avatar
              </button>
              {avatarFile ? (
                <button
                  type="button"
                  onClick={clearAvatarFile}
                  disabled={busy}
                  className="text-sm text-[var(--text-secondary)] disabled:opacity-50"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <label className="mt-2 block text-[12px] font-normal text-[var(--text-secondary)]">
              Or paste URL
              <input
                type="url"
                value={form.avatarUrl}
                onChange={(e) => {
                  setForm((f) => ({ ...f, avatarUrl: e.target.value }));
                  if (avatarFile) clearAvatarFile();
                }}
                className={fieldClass}
                placeholder="https://example.com/avatar.jpg"
                disabled={busy}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        <span className="block text-[13px] font-bold text-[var(--text-secondary)]">Banner</span>
        <div
          className="relative mt-2 h-[100px] overflow-hidden rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-elevated)]"
        >
          {bannerDisplay ? (
            <img src={bannerDisplay} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-[var(--text-secondary)]">
              No banner
            </div>
          )}
          {bannerFile ? (
            <button
              type="button"
              onClick={clearBannerFile}
              disabled={busy}
              className="absolute right-2 top-2 rounded-full p-1.5 disabled:opacity-50"
              style={{ backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)', color: 'var(--text-primary)' }}
              aria-label="Remove selected banner"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <input
          ref={bannerInputRef}
          type="file"
          accept={ALLOWED_IMAGE_ACCEPT}
          className="hidden"
          onChange={(event) => onPickImage('banner', event)}
          disabled={busy}
        />
        <button
          type="button"
          onClick={() => bannerInputRef.current?.click()}
          disabled={busy}
          className="mt-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-[var(--accent)] transition-colors hover-overlay disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          Upload banner
        </button>
        <label className="mt-2 block text-[12px] font-normal text-[var(--text-secondary)]">
          Or paste URL
          <input
            type="url"
            value={form.bannerUrl}
            onChange={(e) => {
              setForm((f) => ({ ...f, bannerUrl: e.target.value }));
              if (bannerFile) clearBannerFile();
            }}
            className={fieldClass}
            placeholder="https://example.com/banner.jpg"
            disabled={busy}
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
            disabled={busy}
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
            disabled={busy}
          />
        </label>
      </div>

      <div className="px-4 py-4">
        <button
          type="button"
          disabled={!hasChanges || busy}
          onClick={() => void handleSave()}
          className={`rounded-full px-5 py-2 text-[15px] font-bold transition-colors ${
            hasChanges && !busy
              ? 'bg-[var(--accent)] text-white hover:opacity-90'
              : 'cursor-not-allowed bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
          }`}
        >
          {uploading ? 'Uploading...' : saving ? 'Saving...' : 'Save changes'}
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
  /** Agent id currently saving a policy flag. */
  const [policySavingId, setPolicySavingId] = useState<string | null>(null);
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

  /** Persist steward policy flags (Wave 12a). Does not start a silent auto-reply bot. */
  const handlePolicyToggle = async (
    agent: LinkedAgent,
    field: 'autoReplyEnabled' | 'autoFollowEnabled',
    next: boolean,
  ) => {
    if (!isSignedIn) return;
    setPolicySavingId(agent.id);
    setError(null);
    setNotice(null);
    // Optimistic local update; rollback on error.
    const prev = agents;
    setAgents((list) =>
      list.map((a) => (a.id === agent.id ? { ...a, [field]: next } : a)),
    );
    try {
      const token = await getToken();
      if (!token) {
        setAgents(prev);
        setNotice('Sign in to save agent policies.');
        return;
      }
      const res = await updateLinkedAgentPolicies(token, agent.id, { [field]: next });
      if (res.linkedAgent) {
        setAgents((list) =>
          list.map((a) => (a.id === agent.id ? { ...a, ...res.linkedAgent } : a)),
        );
      }
      setNotice(
        res.note ??
          'Policy saved. Auto-reply and auto-follow are foundation only — not fully automated yet.',
      );
    } catch (err) {
      setAgents(prev);
      setError(err instanceof Error ? err.message : 'Failed to save agent policy');
    } finally {
      setPolicySavingId(null);
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

      <div
        className="mb-4 rounded-2xl border px-4 py-3"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-elevated)' }}
        role="note"
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[14px] font-bold">{AGENT_POLICY_SECTION_TITLE}</p>
          <span
            className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
          >
            {AGENT_POLICY_NOT_LIVE_BADGE}
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
          {AGENT_POLICY_FOUNDATION_DETAIL}
        </p>
      </div>

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
          {agents.map((agent) => {
            const policies = normalizeAgentPolicyFlags(agent);
            const saving = policySavingId === agent.id;
            return (
              <li key={agent.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
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
                </div>
                <div className="mt-3 ml-12 space-y-2">
                  <p className="text-[12px] font-semibold text-[var(--text-secondary)]">
                    Policies (save real flags — not live automation)
                  </p>
                  <label className="flex items-start gap-3 text-[13px]">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      checked={policies.autoReplyEnabled}
                      disabled={saving}
                      onChange={(e) =>
                        void handlePolicyToggle(agent, 'autoReplyEnabled', e.target.checked)
                      }
                      aria-label={`Auto-reply for ${agent.agentName} (foundation, not fully automated yet)`}
                    />
                    <span>
                      <span className="font-semibold">Auto-reply preferred</span>
                      <span className="block text-[12px] text-[var(--text-secondary)]">
                        Foundation / not fully automated yet — no silent auto-reply bot posts without
                        steward visibility.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 text-[13px]">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      checked={policies.autoFollowEnabled}
                      disabled={saving}
                      onChange={(e) =>
                        void handlePolicyToggle(agent, 'autoFollowEnabled', e.target.checked)
                      }
                      aria-label={`Auto-follow for ${agent.agentName} (foundation, not fully automated yet)`}
                    />
                    <span>
                      <span className="font-semibold">Auto-follow preferred</span>
                      <span className="block text-[12px] text-[var(--text-secondary)]">
                        Foundation / not fully automated yet — no auto-follow worker runs these flags
                        today.
                      </span>
                    </span>
                  </label>
                  {saving && (
                    <p className="text-[12px] text-[var(--text-secondary)]">Saving policy…</p>
                  )}
                </div>
              </li>
            );
          })}
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

function BrandPagesPanel({
  getToken,
  isSignedIn,
}: {
  getToken: () => Promise<string | null>;
  isSignedIn: boolean;
}) {
  const [pages, setPages] = useState<SocialPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadPages = async () => {
    if (!isSignedIn) {
      setPages([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setPages([]);
        return;
      }
      const res = await listMyPages(token);
      setPages((res.pages ?? []).filter((p) => p.kind === 'brand'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pages');
      setPages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPages();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on sign-in change only
  }, [isSignedIn]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isSignedIn) return;
    const displayName = name.trim();
    const cleanSlug = slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (!displayName || cleanSlug.length < 2) {
      setNotice('Name and a 2+ character slug are required.');
      return;
    }
    setSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setNotice('Sign in to create a brand page.');
        return;
      }
      await createBrandPage(token, {
        slug: cleanSlug,
        displayName,
        description: description.trim() || undefined,
      });
      setName('');
      setSlug('');
      setDescription('');
      setNotice('Brand page created. Use it from Create → Post as Page.');
      await loadPages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create brand page');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isSignedIn) {
    return (
      <div className="px-4 py-8 text-center text-[var(--text-secondary)]">
        Sign in to manage brand pages.
      </div>
    );
  }

  const fieldClass =
    'mt-1 w-full rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-elevated)] px-3 py-2 text-[15px] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none';

  return (
    <div className="px-4 py-4">
      <p className="mb-4 text-[13px] leading-5 text-[var(--text-secondary)]">
        Brand Pages are a multi-surface foundation for stewards. Person Pages stay 1:1 with your
        profile; agent Pages come from linked agents. This is not a full multi-Page marketplace yet —
        Agents product switcher remains WIP.
      </p>

      {loading ? (
        <p className="text-[13px] text-[var(--text-secondary)]">Loading…</p>
      ) : pages.length === 0 ? (
        <p className="mb-4 text-[13px] text-[var(--text-secondary)]">No brand pages yet.</p>
      ) : (
        <ul className="mb-4 space-y-2">
          {pages.map((p) => {
            const pageSlug = p.slug || p.handle;
            return (
            <li
              key={p.id}
              className="rounded-xl border border-[var(--border-primary)] px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-bold">{p.displayName}</span>
                  <span className="ml-2 text-[13px] text-[var(--text-secondary)]">@{pageSlug}</span>
                </div>
                {pageSlug ? (
                  <Link
                    to={brandPagePath(pageSlug)}
                    className="shrink-0 text-[13px] font-bold text-[var(--accent)] hover:underline"
                  >
                    View page
                  </Link>
                ) : null}
              </div>
            </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
        <label className="block text-[13px] font-bold text-[var(--text-secondary)]">
          Display name
          <input
            className={fieldClass}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug) {
                setSlug(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]+/g, '-')
                    .replace(/^-+|-+$/g, '')
                    .slice(0, 40),
                );
              }
            }}
            disabled={submitting}
            placeholder="Acme Co"
          />
        </label>
        <label className="block text-[13px] font-bold text-[var(--text-secondary)]">
          Slug
          <input
            className={fieldClass}
            value={slug}
            onChange={(e) =>
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9_-]+/g, '-')
                  .slice(0, 40),
              )
            }
            disabled={submitting}
            placeholder="acme"
          />
        </label>
        <label className="block text-[13px] font-bold text-[var(--text-secondary)]">
          Description (optional)
          <textarea
            className={fieldClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
            rows={2}
            placeholder="What this brand Page is for"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-[var(--accent)] px-5 py-2 text-[15px] font-bold text-white disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create brand page'}
        </button>
      </form>

      {notice && <p className="mt-3 text-[13px] text-[var(--text-secondary)]">{notice}</p>}
      {error && (
        <p className="mt-3 text-[13px]" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Wave 14m/n/o — honest x402 status card (network, mode, payTo).
 * Reads GET /v1/social/x402/status; optional paid-ping product gate test.
 * No fake pay wallet UI.
 */
function X402PaymentsCard() {
  const { isSignedIn, getToken } = useAuth();
  const [status, setStatus] = useState<X402Status | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'live' | 'error'>('loading');
  const [pingBusy, setPingBusy] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    fetchX402Status()
      .then((s) => {
        if (!cancelled) {
          setStatus(s);
          setLoadState('live');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus(null);
          setLoadState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = status?.enabled === true;
  const mode = status?.mode ?? (enabled ? 'shape_only' : 'disabled');
  const modeLabel =
    loadState === 'loading'
      ? 'Checking…'
      : loadState === 'error'
        ? 'Unavailable'
        : mode === 'facilitator'
          ? 'Facilitator'
          : mode === 'shape_only'
            ? 'Shape-only'
            : 'Disabled';
  const showPaidAction = showX402PaidAction(status);

  async function runPaidPing() {
    setPingBusy(true);
    setPingResult(null);
    try {
      const token = await getToken();
      if (!token) {
        setPingResult('Sign in required to test the paid action.');
        return;
      }
      // Shape payment only — facilitator mode will fail closed without a real proof.
      const result: X402PaidPingResult = await postX402PaidPing(token, {
        amount: '0.01',
        network: status?.network,
        payload: { x402Version: 1, source: 'settings-test-paid-action' },
        idempotencyKey: `ui-settings-${Date.now()}`,
      });
      setPingResult(formatX402PaidPingResult(result));
    } catch (e) {
      const err = e as Error & { body?: X402PaidPingResult };
      if (err.body) {
        setPingResult(formatX402PaidPingResult(err.body));
      } else {
        setPingResult(e instanceof Error ? e.message : 'Paid action failed');
      }
    } finally {
      setPingBusy(false);
    }
  }

  return (
    <div className="border-b border-[var(--border-primary)] px-4 py-4">
      <div className="flex gap-3">
        <Zap className="mt-0.5 flex-shrink-0 text-[var(--text-secondary)]" size={20} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-bold">Agent payments (x402)</h3>
            <span
              className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
              style={{
                borderColor: enabled ? 'var(--accent)' : 'var(--border-secondary)',
                color: enabled ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {modeLabel}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
            Agent micropayments foundation for Social. Status is server truth (
            <code className="text-[12px]">X402_ENABLED</code>, network, optional facilitator).
            Private keys are never handled in this UI or the status API.
          </p>
          {loadState === 'live' && status && (
            <dl className="mt-3 grid gap-1 text-[13px]">
              <div className="flex gap-2">
                <dt className="font-semibold text-[var(--text-secondary)]">Network</dt>
                <dd>{status.network}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-semibold text-[var(--text-secondary)]">Mode</dt>
                <dd>
                  <code className="text-[12px]">{mode}</code>
                </dd>
              </div>
              {status.payTo ? (
                <div className="flex min-w-0 gap-2">
                  <dt className="font-semibold text-[var(--text-secondary)]">Pay to</dt>
                  <dd className="truncate font-mono text-[12px]" title={status.payTo}>
                    {status.payTo}
                  </dd>
                </div>
              ) : null}
              <div className="flex gap-2">
                <dt className="font-semibold text-[var(--text-secondary)]">Note</dt>
                <dd className="text-[var(--text-secondary)]">{status.note}</dd>
              </div>
            </dl>
          )}
          {loadState === 'error' && (
            <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
              Could not reach /v1/social/x402/status. Treating as not configured.
            </p>
          )}
          {showPaidAction && isSignedIn ? (
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                disabled={pingBusy}
                onClick={() => void runPaidPing()}
                className="self-start rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-opacity disabled:opacity-50"
                style={{
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)',
                }}
              >
                {pingBusy ? 'Testing…' : 'Test paid action'}
              </button>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Calls <code className="text-[11px]">POST /v1/social/x402/paid-ping</code>.
                shape_only accepts a shape payment (not settled). Facilitator mode fails closed
                without a real verified payment.
              </p>
              {pingResult ? (
                <p
                  className="rounded-lg border px-3 py-2 text-[12px] font-mono"
                  style={{
                    borderColor: 'var(--border-secondary)',
                    color: 'var(--text-primary)',
                  }}
                  role="status"
                >
                  {pingResult}
                </p>
              ) : null}
            </div>
          ) : null}
          {showPaidAction && !isSignedIn ? (
            <p className="mt-3 text-[12px] text-[var(--text-secondary)]">
              Sign in to run the paid-ping product gate test.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModerationListsPanel({
  getToken,
  isSignedIn,
}: {
  getToken: () => Promise<string | null>;
  isSignedIn: boolean;
}) {
  const [blocks, setBlocks] = useState<ModerationListEntry[]>([]);
  const [mutes, setMutes] = useState<ModerationListEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setBlocks([]);
      setMutes([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error('Sign in to manage blocks and mutes.');
        const [b, m] = await Promise.all([fetchMyBlocks(token), fetchMyMutes(token)]);
        if (cancelled) return;
        setBlocks(b.blocks ?? []);
        setMutes(m.mutes ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load lists.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, isSignedIn]);

  const handleUnblock = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again.');
      await unblockUser(token, id);
      setBlocks((current) => current.filter((entry) => entry.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unblock failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleUnmute = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again.');
      await unmuteUser(token, id);
      setMutes((current) => current.filter((entry) => entry.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unmute failed.');
    } finally {
      setBusyId(null);
    }
  };

  if (!isSignedIn) {
    return (
      <div className="px-4 py-4 text-[13px] text-[var(--text-secondary)]">
        Sign in to manage blocked and muted accounts.
      </div>
    );
  }

  return (
    <div className="space-y-4 border-b border-[var(--border-primary)] px-4 py-4">
      <div>
        <h3 className="text-[15px] font-bold">Blocked accounts</h3>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          People you blocked cannot message you or appear in your feed.
        </p>
        {loading ? (
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">Loading…</p>
        ) : blocks.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">No blocked accounts.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {blocks.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="block truncate text-[14px] font-bold">{entry.displayName}</span>
                  <span className="block truncate text-[13px] text-[var(--text-secondary)]">
                    @{entry.handle}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busyId === entry.id}
                  onClick={() => void handleUnblock(entry.id)}
                  className="rounded-full border border-[var(--border-primary)] px-3 py-1 text-[13px] font-bold hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {busyId === entry.id ? '…' : 'Unblock'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-[15px] font-bold">Muted accounts</h3>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          Muted accounts are hidden from your feed without notifying them.
        </p>
        {loading ? (
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">Loading…</p>
        ) : mutes.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">No muted accounts.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {mutes.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="block truncate text-[14px] font-bold">{entry.displayName}</span>
                  <span className="block truncate text-[13px] text-[var(--text-secondary)]">
                    @{entry.handle}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busyId === entry.id}
                  onClick={() => void handleUnmute(entry.id)}
                  className="rounded-full border border-[var(--border-primary)] px-3 py-1 text-[13px] font-bold hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {busyId === entry.id ? '…' : 'Unmute'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? <p className="text-[13px] text-[var(--color-danger,#f4212e)]">{error}</p> : null}
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
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);

  const currentSection = SECTIONS.find((section) => section.id === activeSection) ?? SECTIONS[0];

  // Hydrate device-scoped prefs from localStorage once.
  useEffect(() => {
    const storage = typeof localStorage !== 'undefined' ? localStorage : null;
    const device = readDevicePrefs(storage);
    setToggles((current) => ({ ...current, ...device.toggles }));
    setChoices((current) => ({ ...current, ...device.choices }));
    if (typeof device.toggles['reduce-motion'] === 'boolean') {
      applyReduceMotionPreference(device.toggles['reduce-motion']);
    }
  }, []);

  // Hydrate privacy/account prefs from backend when signed in.
  useEffect(() => {
    if (!isSignedIn || !authEnabled) {
      setPrefsHydrated(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const raw = await fetchMyPrefs(token);
        if (cancelled) return;
        const prefs = normalizeSocialPrefs(raw as unknown as Record<string, unknown>);
        setToggles((current) => ({ ...current, ...prefsToToggleState(prefs) }));
        setChoices((current) => ({ ...current, ...prefsToChoiceState(prefs) }));
        setPrefsHydrated(true);
      } catch {
        // Leave local defaults; user can still try saves.
        if (!cancelled) setPrefsHydrated(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authEnabled, getToken, isSignedIn]);

  const persistPrefsControl = async (
    controlId: string,
    value: boolean | string,
    rollback: () => void,
  ) => {
    const patch = settingsControlToPrefsPatch(controlId, value);
    if (!patch) return;
    if (!isSignedIn || !authEnabled) {
      setNotice('Sign in to save privacy preferences.');
      rollback();
      return;
    }
    setPrefsSaving(true);
    setNotice(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sign in again to save preferences.');
      const saved = await updateMyPrefs(token, prefsPatchToApiBody(patch));
      const prefs = normalizeSocialPrefs(saved as unknown as Record<string, unknown>);
      setToggles((current) => ({ ...current, ...prefsToToggleState(prefs) }));
      setChoices((current) => ({ ...current, ...prefsToChoiceState(prefs) }));
      setNotice('Preferences saved.');
      setPrefsHydrated(true);
    } catch (err) {
      rollback();
      setNotice(err instanceof Error ? err.message : 'Could not save preferences.');
    } finally {
      setPrefsSaving(false);
    }
  };

  const persistDeviceControl = (kind: 'toggle' | 'choice', controlId: string, value: boolean | string) => {
    const storage = typeof localStorage !== 'undefined' ? localStorage : null;
    writeDevicePref(storage, kind, controlId, value);
    if (controlId === 'reduce-motion' && kind === 'toggle') {
      applyReduceMotionPreference(Boolean(value));
    }
    setNotice('Saved on this device only.');
  };

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

    if (control.id === 'manage-billing' || control.id === 'premium-plan') {
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
            {currentSection.id === 'pages' ? (
              <BrandPagesPanel getToken={getToken} isSignedIn={isSignedIn} />
            ) : null}
            {currentSection.id === 'account' ? <AccountSummary /> : null}
            {currentSection.id === 'privacy' ? (
              <ModerationListsPanel getToken={getToken} isSignedIn={Boolean(isSignedIn)} />
            ) : null}
            {currentSection.id === 'billing' || currentSection.id === 'data' ? (
              <X402PaymentsCard />
            ) : null}
            {notice ? (
              <div className="border-b border-[var(--border-primary)] px-4 py-3 text-[13px] text-[var(--text-secondary)]">
                {notice}
                {prefsSaving ? ' Saving…' : null}
              </div>
            ) : null}
            {!notice && prefsHydrated && (currentSection.id === 'privacy' || currentSection.id === 'account') ? (
              <div className="border-b border-[var(--border-primary)] px-4 py-2 text-[12px] text-[var(--text-secondary)]">
                Privacy preferences synced with your account.
              </div>
            ) : null}
            {currentSection.controls.map((control) => {
              const Icon = control.Icon;
              const meta = settingsControlMeta(control.id);

              if (control.kind === 'toggle') {
                const checked = toggles[control.id] ?? false;
                const isPrefsControl = settingsControlToPrefsPatch(control.id, checked) != null;
                const isDevice = meta.persists === 'device';
                const isNone = meta.persists === 'none';
                // Non-persisted toggles: keep interactive for local preview but never claim account save.
                const disabled = (isPrefsControl && prefsSaving) || (isNone && control.id === 'two-factor');

                return (
                  <button
                    key={control.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (isNone && control.id === 'two-factor') {
                        setNotice('Use Manage account (Clerk) for two-step verification.');
                        return;
                      }
                      const next = !checked;
                      setToggles((current) => ({ ...current, [control.id]: next }));
                      if (isPrefsControl) {
                        void persistPrefsControl(control.id, next, () => {
                          setToggles((current) => ({ ...current, [control.id]: checked }));
                        });
                      } else if (isDevice) {
                        persistDeviceControl('toggle', control.id, next);
                      } else if (isNone) {
                        setNotice(`${meta.label}. Change is local-only and is not synced.`);
                      }
                    }}
                    className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-60"
                    aria-pressed={checked}
                  >
                    <Icon className="mt-0.5 flex-shrink-0 text-[var(--text-secondary)]" size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold">{control.label}</span>
                      <span className="mt-1 block text-[13px] leading-5 text-[var(--text-secondary)]">
                        {control.description}
                      </span>
                      <PersistBadge controlId={control.id} />
                    </span>
                    <ToggleSwitch checked={checked} />
                  </button>
                );
              }

              if (control.kind === 'choice') {
                const selected = choices[control.id] ?? control.selected;
                const isPrefsControl = settingsControlToPrefsPatch(control.id, selected) != null;
                const isDevice = meta.persists === 'device';
                const isNone = meta.persists === 'none';

                return (
                  <div key={control.id} className="px-4 py-4">
                    <div className="flex gap-3">
                      <Icon className="mt-0.5 flex-shrink-0 text-[var(--text-secondary)]" size={20} />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-bold">{control.label}</h3>
                        <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">{control.description}</p>
                        <PersistBadge controlId={control.id} />
                        <div className="mt-3 flex flex-wrap gap-2">
                          {control.options.map((option) => {
                            const isSelected = option === selected;

                            return (
                              <button
                                key={option}
                                type="button"
                                disabled={isPrefsControl && prefsSaving}
                                onClick={() => {
                                  if (option === selected) return;
                                  setChoices((current) => ({ ...current, [control.id]: option }));
                                  if (isPrefsControl) {
                                    void persistPrefsControl(control.id, option, () => {
                                      setChoices((current) => ({
                                        ...current,
                                        [control.id]: selected,
                                      }));
                                    });
                                  } else if (isDevice) {
                                    persistDeviceControl('choice', control.id, option);
                                  } else if (isNone) {
                                    setNotice(`${meta.label}. Change is local-only and is not synced.`);
                                  }
                                }}
                                className={`min-h-9 rounded-full border px-3 text-[13px] font-bold transition-colors disabled:opacity-60 ${
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
                    <PersistBadge controlId={control.id} />
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
