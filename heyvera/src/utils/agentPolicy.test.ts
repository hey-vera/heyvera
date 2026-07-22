import { describe, expect, it } from 'vitest';
import {
  AGENT_POLICY_FOUNDATION_DETAIL,
  AGENT_POLICY_NOT_LIVE_BADGE,
  AGENT_POLICY_SECTION_TITLE,
  DEFAULT_AUTO_FOLLOW_ENABLED,
  DEFAULT_AUTO_REPLY_ENABLED,
  agentPolicyToggleLabel,
  isAgentAutoRuntimeLive,
  isAgentsProductActive,
  normalizeAgentPolicyFlags,
} from './agentPolicy';

describe('normalizeAgentPolicyFlags (12a)', () => {
  it('defaults both flags to false', () => {
    expect(normalizeAgentPolicyFlags(undefined)).toEqual({
      autoReplyEnabled: false,
      autoFollowEnabled: false,
    });
    expect(normalizeAgentPolicyFlags(null)).toEqual({
      autoReplyEnabled: false,
      autoFollowEnabled: false,
    });
    expect(normalizeAgentPolicyFlags({})).toEqual({
      autoReplyEnabled: false,
      autoFollowEnabled: false,
    });
    expect(DEFAULT_AUTO_REPLY_ENABLED).toBe(false);
    expect(DEFAULT_AUTO_FOLLOW_ENABLED).toBe(false);
  });

  it('only treats strict true as enabled', () => {
    expect(
      normalizeAgentPolicyFlags({
        autoReplyEnabled: true,
        autoFollowEnabled: false,
      }),
    ).toEqual({ autoReplyEnabled: true, autoFollowEnabled: false });
    // Loose / wrong types must not enable flags
    const loose = { autoReplyEnabled: 1 as unknown as boolean };
    expect(normalizeAgentPolicyFlags(loose)).toEqual({
      autoReplyEnabled: false,
      autoFollowEnabled: false,
    });
  });
});

describe('agentPolicyToggleLabel (12a)', () => {
  it('labels off state clearly', () => {
    expect(agentPolicyToggleLabel('auto_reply', false).toLowerCase()).toContain('off');
    expect(agentPolicyToggleLabel('auto_follow', false).toLowerCase()).toContain('off');
  });

  it('enabled labels stay foundation / not fully automated', () => {
    const reply = agentPolicyToggleLabel('auto_reply', true).toLowerCase();
    const follow = agentPolicyToggleLabel('auto_follow', true).toLowerCase();
    expect(reply).toMatch(/foundation|not fully automated/);
    expect(follow).toMatch(/foundation|not fully automated/);
    expect(reply).not.toContain('agents active');
    expect(follow).not.toContain('live automation');
  });
});

describe('runtime honesty (12a)', () => {
  it('auto runtime is never live in this wave', () => {
    expect(isAgentAutoRuntimeLive()).toBe(false);
  });

  it('Agents product is never Active', () => {
    expect(isAgentsProductActive()).toBe(false);
  });

  it('foundation copy is honest', () => {
    const detail = AGENT_POLICY_FOUNDATION_DETAIL.toLowerCase();
    expect(detail).toMatch(/foundation|not fully automated/);
    expect(detail).toMatch(/no worker|not fully automated/);
    expect(detail).not.toContain('agents active');
    expect(AGENT_POLICY_SECTION_TITLE.toLowerCase()).toContain('foundation');
    expect(AGENT_POLICY_NOT_LIVE_BADGE.toLowerCase()).toMatch(/foundation|not live/);
  });
});
