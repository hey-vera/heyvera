/**
 * Batch B1 — pure mappers between API social prefs and Settings UI state.
 */

export type DmPolicy = 'everyone' | 'verified' | 'following' | 'mutuals' | 'nobody';
export type ProfileVisibility = 'public' | 'signed_in' | 'followers';

/** Canonical API shape (camelCase). */
export type SocialPrefs = {
  profileId?: string;
  dmPolicy: DmPolicy;
  discoverableByContact: boolean;
  showInSearch: boolean;
  protectedPosts: boolean;
  profileVisibility: ProfileVisibility;
  allowAgentDms: boolean;
  allowAgentMentions: boolean;
};

export type SocialPrefsPatch = Partial<
  Omit<SocialPrefs, 'profileId'>
>;

/** Defaults match BE lazy-create row. */
export const DEFAULT_SOCIAL_PREFS: SocialPrefs = {
  dmPolicy: 'verified',
  discoverableByContact: false,
  showInSearch: true,
  protectedPosts: false,
  profileVisibility: 'public',
  allowAgentDms: false,
  allowAgentMentions: false,
};

const DM_POLICY_LABELS: Record<DmPolicy, string> = {
  everyone: 'Everyone',
  verified: 'Verified users',
  following: 'People you follow',
  mutuals: 'Mutual follows',
  nobody: 'Nobody',
};

const VISIBILITY_LABELS: Record<ProfileVisibility, string> = {
  public: 'Public',
  signed_in: 'Signed-in users',
  followers: 'Followers only',
};

export function dmPolicyToLabel(policy: DmPolicy): string {
  return DM_POLICY_LABELS[policy] ?? DM_POLICY_LABELS.verified;
}

export function labelToDmPolicy(label: string): DmPolicy {
  const lower = label.trim().toLowerCase();
  if (lower.startsWith('everyone') || lower === 'all') return 'everyone';
  if (lower.includes('mutual')) return 'mutuals';
  if (lower === 'nobody' || lower === 'none') return 'nobody';
  if (lower.includes('follow')) return 'following';
  if (lower.includes('verified')) return 'verified';
  return 'verified';
}

export function profileVisibilityToLabel(v: ProfileVisibility): string {
  return VISIBILITY_LABELS[v] ?? VISIBILITY_LABELS.public;
}

export function labelToProfileVisibility(label: string): ProfileVisibility {
  const lower = label.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (lower.includes('follower')) return 'followers';
  if (lower.includes('signed')) return 'signed_in';
  return 'public';
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return fallback;
}

function asDmPolicy(v: unknown): DmPolicy {
  if (typeof v !== 'string') return DEFAULT_SOCIAL_PREFS.dmPolicy;
  return normalize_dm(v) ?? DEFAULT_SOCIAL_PREFS.dmPolicy;
}

function normalize_dm(raw: string): DmPolicy | null {
  const s = raw.trim().toLowerCase();
  if (s === 'everyone' || s === 'all' || s === 'open') return 'everyone';
  if (s === 'verified' || s === 'verified_users') return 'verified';
  if (s === 'following' || s === 'people_you_follow' || s === 'followers') return 'following';
  if (s === 'mutuals' || s === 'mutual_follow' || s === 'mutual_follows') return 'mutuals';
  if (s === 'nobody' || s === 'none' || s === 'closed') return 'nobody';
  return null;
}

function asVisibility(v: unknown): ProfileVisibility {
  if (typeof v !== 'string') return DEFAULT_SOCIAL_PREFS.profileVisibility;
  const s = v.trim().toLowerCase().replace(/-/g, '_');
  if (s === 'public') return 'public';
  if (s === 'signed_in' || s === 'signedin' || s === 'signed_in_users') return 'signed_in';
  if (s === 'followers' || s === 'followers_only') return 'followers';
  return DEFAULT_SOCIAL_PREFS.profileVisibility;
}

/**
 * Normalize a partial API / unknown payload into full SocialPrefs.
 * Accepts camelCase and snake_case keys.
 */
export function normalizeSocialPrefs(
  raw: Record<string, unknown> | null | undefined,
): SocialPrefs {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SOCIAL_PREFS };
  }
  const r = raw as Record<string, unknown>;
  return {
    profileId:
      typeof r.profileId === 'string'
        ? r.profileId
        : typeof r.profile_id === 'string'
          ? r.profile_id
          : undefined,
    dmPolicy: asDmPolicy(r.dmPolicy ?? r.dm_policy),
    discoverableByContact: asBool(
      r.discoverableByContact ?? r.discoverable_by_contact,
      DEFAULT_SOCIAL_PREFS.discoverableByContact,
    ),
    showInSearch: asBool(
      r.showInSearch ?? r.show_in_search,
      DEFAULT_SOCIAL_PREFS.showInSearch,
    ),
    protectedPosts: asBool(
      r.protectedPosts ?? r.protected_posts,
      DEFAULT_SOCIAL_PREFS.protectedPosts,
    ),
    profileVisibility: asVisibility(r.profileVisibility ?? r.profile_visibility),
    allowAgentDms: asBool(
      r.allowAgentDms ?? r.allow_agent_dms,
      DEFAULT_SOCIAL_PREFS.allowAgentDms,
    ),
    allowAgentMentions: asBool(
      r.allowAgentMentions ?? r.allow_agent_mentions,
      DEFAULT_SOCIAL_PREFS.allowAgentMentions,
    ),
  };
}

/** Map prefs → Settings toggle ids used on pages/SettingsPage. */
export function prefsToToggleState(prefs: SocialPrefs): Record<string, boolean> {
  return {
    'protected-posts': prefs.protectedPosts,
    discoverability: prefs.discoverableByContact,
    'show-in-search': prefs.showInSearch,
    'allow-agent-dms': prefs.allowAgentDms,
    'allow-agent-mentions': prefs.allowAgentMentions,
  };
}

/** Map prefs → Settings choice ids. */
export function prefsToChoiceState(prefs: SocialPrefs): Record<string, string> {
  return {
    'profile-visibility': profileVisibilityToLabel(prefs.profileVisibility),
    'message-requests': dmPolicyToLabel(prefs.dmPolicy),
  };
}

/**
 * Build a PATCH body from a single Settings control change.
 * Returns null when the control is not a privacy/account prefs control.
 */
export function settingsControlToPrefsPatch(
  controlId: string,
  value: boolean | string,
): SocialPrefsPatch | null {
  switch (controlId) {
    case 'protected-posts':
      return { protectedPosts: Boolean(value) };
    case 'discoverability':
      return { discoverableByContact: Boolean(value) };
    case 'show-in-search':
      return { showInSearch: Boolean(value) };
    case 'allow-agent-dms':
      return { allowAgentDms: Boolean(value) };
    case 'allow-agent-mentions':
      return { allowAgentMentions: Boolean(value) };
    case 'profile-visibility':
      return {
        profileVisibility: labelToProfileVisibility(String(value)),
      };
    case 'message-requests':
      return { dmPolicy: labelToDmPolicy(String(value)) };
    default:
      return null;
  }
}

/** Serialize patch for API (camelCase only). */
export function prefsPatchToApiBody(patch: SocialPrefsPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.dmPolicy !== undefined) body.dmPolicy = patch.dmPolicy;
  if (patch.discoverableByContact !== undefined) {
    body.discoverableByContact = patch.discoverableByContact;
  }
  if (patch.showInSearch !== undefined) body.showInSearch = patch.showInSearch;
  if (patch.protectedPosts !== undefined) body.protectedPosts = patch.protectedPosts;
  if (patch.profileVisibility !== undefined) {
    body.profileVisibility = patch.profileVisibility;
  }
  if (patch.allowAgentDms !== undefined) body.allowAgentDms = patch.allowAgentDms;
  if (patch.allowAgentMentions !== undefined) {
    body.allowAgentMentions = patch.allowAgentMentions;
  }
  return body;
}
