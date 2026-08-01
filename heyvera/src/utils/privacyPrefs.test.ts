import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOCIAL_PREFS,
  dmPolicyToLabel,
  labelToDmPolicy,
  labelToProfileVisibility,
  normalizeSocialPrefs,
  prefsPatchToApiBody,
  prefsToChoiceState,
  prefsToToggleState,
  profileVisibilityToLabel,
  settingsControlToPrefsPatch,
} from './privacyPrefs';

describe('normalizeSocialPrefs', () => {
  it('returns defaults for null/empty', () => {
    expect(normalizeSocialPrefs(null)).toEqual(DEFAULT_SOCIAL_PREFS);
    expect(normalizeSocialPrefs(undefined)).toEqual(DEFAULT_SOCIAL_PREFS);
    expect(normalizeSocialPrefs({})).toEqual(DEFAULT_SOCIAL_PREFS);
  });

  it('accepts camelCase API payload', () => {
    const prefs = normalizeSocialPrefs({
      profileId: 'p1',
      dmPolicy: 'following',
      discoverableByContact: true,
      showInSearch: false,
      protectedPosts: true,
      profileVisibility: 'followers',
      allowAgentDms: true,
      allowAgentMentions: true,
    });
    expect(prefs).toEqual({
      profileId: 'p1',
      dmPolicy: 'following',
      discoverableByContact: true,
      showInSearch: false,
      protectedPosts: true,
      profileVisibility: 'followers',
      allowAgentDms: true,
      allowAgentMentions: true,
    });
  });

  it('accepts snake_case aliases', () => {
    const prefs = normalizeSocialPrefs({
      profile_id: 'p2',
      dm_policy: 'everyone',
      show_in_search: 0,
      protected_posts: 1,
    });
    expect(prefs.profileId).toBe('p2');
    expect(prefs.dmPolicy).toBe('everyone');
    expect(prefs.showInSearch).toBe(false);
    expect(prefs.protectedPosts).toBe(true);
  });
});

describe('label mappers', () => {
  it('round-trips dm policy labels', () => {
    expect(labelToDmPolicy(dmPolicyToLabel('everyone'))).toBe('everyone');
    expect(labelToDmPolicy(dmPolicyToLabel('verified'))).toBe('verified');
    expect(labelToDmPolicy(dmPolicyToLabel('following'))).toBe('following');
    expect(labelToDmPolicy(dmPolicyToLabel('mutuals'))).toBe('mutuals');
    expect(labelToDmPolicy(dmPolicyToLabel('nobody'))).toBe('nobody');
    expect(labelToDmPolicy('People you follow')).toBe('following');
    expect(labelToDmPolicy('Mutual follows')).toBe('mutuals');
    expect(labelToDmPolicy('Nobody')).toBe('nobody');
  });

  it('round-trips profile visibility labels', () => {
    expect(labelToProfileVisibility(profileVisibilityToLabel('public'))).toBe('public');
    expect(labelToProfileVisibility(profileVisibilityToLabel('signed_in'))).toBe('signed_in');
    expect(labelToProfileVisibility(profileVisibilityToLabel('followers'))).toBe('followers');
  });
});

describe('settings control → patch', () => {
  it('maps privacy toggles and choices', () => {
    expect(settingsControlToPrefsPatch('protected-posts', true)).toEqual({
      protectedPosts: true,
    });
    expect(settingsControlToPrefsPatch('discoverability', false)).toEqual({
      discoverableByContact: false,
    });
    expect(settingsControlToPrefsPatch('message-requests', 'Everyone')).toEqual({
      dmPolicy: 'everyone',
    });
    expect(settingsControlToPrefsPatch('profile-visibility', 'Followers only')).toEqual({
      profileVisibility: 'followers',
    });
    expect(settingsControlToPrefsPatch('two-factor', true)).toBeNull();
  });

  it('builds camelCase API body', () => {
    expect(
      prefsPatchToApiBody({
        dmPolicy: 'following',
        showInSearch: false,
      }),
    ).toEqual({ dmPolicy: 'following', showInSearch: false });
  });

  it('hydrates settings maps from prefs', () => {
    const prefs = normalizeSocialPrefs({
      dmPolicy: 'everyone',
      protectedPosts: true,
      profileVisibility: 'signed_in',
    });
    expect(prefsToToggleState(prefs)['protected-posts']).toBe(true);
    expect(prefsToChoiceState(prefs)['message-requests']).toBe('Everyone');
    expect(prefsToChoiceState(prefs)['profile-visibility']).toBe('Signed-in users');
  });
});
