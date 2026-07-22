/**
 * Wave 12a — pure helpers for linked-agent policy foundation (PW-8 lite).
 *
 * Steward-gated flags persist via PATCH /linked-agents/{id}.
 * No auto-reply / auto-follow worker ships in this wave — UI must stay honest.
 */

/** Default for new agents and missing API fields. */
export const DEFAULT_AUTO_REPLY_ENABLED = false;
export const DEFAULT_AUTO_FOLLOW_ENABLED = false;

/** Banner / section label when policy UI is shown. */
export const AGENT_POLICY_SECTION_TITLE = 'Agent policies (foundation)';

/**
 * Honest detail: flags save, but automation is not live runtime.
 * Must never claim silent auto-posting or "Agents Active".
 */
export const AGENT_POLICY_FOUNDATION_DETAIL =
  'These preferences save on your linked agent. Auto-reply and auto-follow are foundation only — not fully automated yet. No worker posts or follows without steward visibility.';

/** Short badge for a single policy toggle. */
export const AGENT_POLICY_NOT_LIVE_BADGE = 'Foundation — not live runtime';

export type AgentPolicyFlags = {
  autoReplyEnabled: boolean;
  autoFollowEnabled: boolean;
};

/** Normalize API/missing fields to boolean defaults (false). */
export function normalizeAgentPolicyFlags(
  input: Partial<AgentPolicyFlags> | null | undefined,
): AgentPolicyFlags {
  return {
    autoReplyEnabled: input?.autoReplyEnabled === true,
    autoFollowEnabled: input?.autoFollowEnabled === true,
  };
}

/**
 * Label for a policy toggle given saved value.
 * Enabled flags still say foundation — never "live" or "Active" automation.
 */
export function agentPolicyToggleLabel(
  kind: 'auto_reply' | 'auto_follow',
  enabled: boolean,
): string {
  const base = kind === 'auto_reply' ? 'Auto-reply' : 'Auto-follow';
  if (!enabled) return `${base} (off)`;
  return `${base} preferred (foundation — not fully automated yet)`;
}

/**
 * Whether UI may claim that auto-reply/follow is running.
 * Wave 12: always false — no worker exists.
 */
export function isAgentAutoRuntimeLive(): boolean {
  return false;
}

/** True only when a product surface may claim "Agents Active" (never in Wave 12). */
export function isAgentsProductActive(): boolean {
  return false;
}
