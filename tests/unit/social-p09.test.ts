import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetDbForTests, closeDb, initDb } from '../../src/db/index';
import {
  insertSocialProfile,
  insertSocialCommunity,
  insertCommunityMembership,
  getCommunityMembershipStatus,
  deleteCommunityMembership,
  listCommunityMembers,
  insertSocialLongform,
  listLongformByHandle,
} from '../../src/db/social';

function makeProfile(handle: string, clerk: string) {
  return insertSocialProfile({ clerkUserId: clerk, handle, displayName: handle, bio: '' });
}

function makeCommunity(creatorId: string, slug: string) {
  return insertSocialCommunity({ creatorProfileId: creatorId, slug, name: slug, description: '', visibility: 'public' });
}

describe('P09 — member directory, leave, longform-by-handle', () => {
  beforeEach(() => {
    _resetDbForTests();
    initDb({ path: ':memory:' });
  });

  afterEach(() => {
    closeDb();
    _resetDbForTests();
  });

  // ── getCommunityMembershipStatus ──────────────────────────────────────────

  describe('getCommunityMembershipStatus', () => {
    it('returns true when profile is a member', () => {
      const alice = makeProfile('alice', 'clerk-a');
      const c = makeCommunity(alice.id, 'c1');
      insertCommunityMembership(c.id, alice.id);
      expect(getCommunityMembershipStatus(c.id, alice.id)).toBe(true);
    });

    it('returns false when profile is not a member', () => {
      const alice = makeProfile('alice2', 'clerk-a2');
      const bob   = makeProfile('bob',    'clerk-b');
      const c = makeCommunity(alice.id, 'c2');
      expect(getCommunityMembershipStatus(c.id, bob.id)).toBe(false);
    });
  });

  // ── deleteCommunityMembership ─────────────────────────────────────────────

  describe('deleteCommunityMembership', () => {
    it('removes an existing membership', () => {
      const alice = makeProfile('alice3', 'clerk-a3');
      const c = makeCommunity(alice.id, 'c3');
      insertCommunityMembership(c.id, alice.id);
      expect(getCommunityMembershipStatus(c.id, alice.id)).toBe(true);
      deleteCommunityMembership(c.id, alice.id);
      expect(getCommunityMembershipStatus(c.id, alice.id)).toBe(false);
    });

    it('is a no-op when membership does not exist', () => {
      const alice = makeProfile('alice4', 'clerk-a4');
      const c = makeCommunity(alice.id, 'c4');
      expect(() => deleteCommunityMembership(c.id, alice.id)).not.toThrow();
    });
  });

  // ── listCommunityMembers ──────────────────────────────────────────────────

  describe('listCommunityMembers', () => {
    it('returns profiles that have joined the community', () => {
      const alice = makeProfile('alice5', 'clerk-a5');
      const bob   = makeProfile('bob2',   'clerk-b2');
      const carol = makeProfile('carol',  'clerk-c');
      const c = makeCommunity(alice.id, 'c5');
      insertCommunityMembership(c.id, alice.id);
      insertCommunityMembership(c.id, bob.id);

      const members = listCommunityMembers(c.id, 20, 0);
      const handles = members.map((m) => m.handle);
      expect(handles).toContain('alice5');
      expect(handles).toContain('bob2');
      expect(handles).not.toContain('carol');
    });

    it('returns empty array for a community with no members', () => {
      const alice = makeProfile('alice6', 'clerk-a6');
      const c = makeCommunity(alice.id, 'c6');
      expect(listCommunityMembers(c.id, 20, 0)).toHaveLength(0);
    });

    it('excludes members after they leave', () => {
      const alice = makeProfile('alice7', 'clerk-a7');
      const c = makeCommunity(alice.id, 'c7');
      insertCommunityMembership(c.id, alice.id);
      expect(listCommunityMembers(c.id, 20, 0)).toHaveLength(1);
      deleteCommunityMembership(c.id, alice.id);
      expect(listCommunityMembers(c.id, 20, 0)).toHaveLength(0);
    });

    it('respects limit and offset', () => {
      const alice = makeProfile('alice8', 'clerk-a8');
      const c = makeCommunity(alice.id, 'c8');
      for (let i = 0; i < 5; i++) {
        const p = makeProfile(`member${i}`, `clerk-m${i}`);
        insertCommunityMembership(c.id, p.id);
      }
      const page1 = listCommunityMembers(c.id, 2, 0);
      const page2 = listCommunityMembers(c.id, 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  // ── listLongformByHandle ──────────────────────────────────────────────────

  describe('listLongformByHandle', () => {
    it('returns only longform entries by the given handle', () => {
      const alice = makeProfile('alice9', 'clerk-a9');
      const bob   = makeProfile('bob3',   'clerk-b3');

      insertSocialLongform({ profileId: alice.id, title: 'Alice Essay', summary: '', body: 'body', formatType: 'essay', visibility: 'public', authorMode: 'person', linkedAgentId: null });
      insertSocialLongform({ profileId: bob.id,   title: 'Bob Essay',   summary: '', body: 'body', formatType: 'essay', visibility: 'public', authorMode: 'person', linkedAgentId: null });

      const aliceEntries = listLongformByHandle('alice9', 20, 0);
      expect(aliceEntries).toHaveLength(1);
      expect(aliceEntries[0].title).toBe('Alice Essay');

      const bobEntries = listLongformByHandle('bob3', 20, 0);
      expect(bobEntries).toHaveLength(1);
      expect(bobEntries[0].title).toBe('Bob Essay');
    });

    it('excludes non-public entries', () => {
      const alice = makeProfile('alice10', 'clerk-a10');
      insertSocialLongform({ profileId: alice.id, title: 'Private Essay', summary: '', body: 'body', formatType: 'essay', visibility: 'private', authorMode: 'person', linkedAgentId: null });
      expect(listLongformByHandle('alice10', 20, 0)).toHaveLength(0);
    });

    it('returns empty array for a handle with no longform', () => {
      makeProfile('alice11', 'clerk-a11');
      expect(listLongformByHandle('alice11', 20, 0)).toHaveLength(0);
    });

    it('respects limit and offset', () => {
      const alice = makeProfile('alice12', 'clerk-a12');
      for (let i = 0; i < 5; i++) {
        insertSocialLongform({ profileId: alice.id, title: `Essay ${i}`, summary: '', body: 'body', formatType: 'essay', visibility: 'public', authorMode: 'person', linkedAgentId: null });
      }
      const page1 = listLongformByHandle('alice12', 2, 0);
      const page2 = listLongformByHandle('alice12', 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('returns empty array for a non-existent handle', () => {
      expect(listLongformByHandle('ghost', 20, 0)).toHaveLength(0);
    });
  });
});
