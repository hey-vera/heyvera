import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetDbForTests, closeDb, initDb } from '../../src/db/index';
import {
  insertSocialProfile,
  insertSocialFollow,
  insertSocialCommunity,
  insertCommunityMembership,
  insertSocialPost,
  listCommunityFeedPosts,
  listJoinedCommunities,
  listFollowers,
  listFollowing,
} from '../../src/db/social';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeProfile(handle: string, clerk: string) {
  return insertSocialProfile({ clerkUserId: clerk, handle, displayName: handle, bio: '' });
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('P07 — community feed, joined communities, followers, following', () => {
  beforeEach(() => {
    _resetDbForTests();
    initDb({ path: ':memory:' });
  });

  afterEach(() => {
    closeDb();
    _resetDbForTests();
  });

  // ── listCommunityFeedPosts ─────────────────────────────────────────────────

  describe('listCommunityFeedPosts', () => {
    it('returns posts only from community members', () => {
      const alice = makeProfile('alice', 'clerk-alice');
      const bob   = makeProfile('bob',   'clerk-bob');
      const carol = makeProfile('carol', 'clerk-carol');

      const community = insertSocialCommunity({
        creatorProfileId: alice.id,
        slug: 'rust-fans',
        name: 'Rust Fans',
        description: '',
        visibility: 'public',
      });

      insertCommunityMembership(community.id, alice.id);
      insertCommunityMembership(community.id, bob.id);

      insertSocialPost({ profileId: alice.id, body: 'alice post', visibility: 'public', authorMode: 'person', linkedAgentId: null, replyToPostId: null, quotePostId: null });
      insertSocialPost({ profileId: bob.id,   body: 'bob post',   visibility: 'public', authorMode: 'person', linkedAgentId: null, replyToPostId: null, quotePostId: null });
      insertSocialPost({ profileId: carol.id, body: 'carol post', visibility: 'public', authorMode: 'person', linkedAgentId: null, replyToPostId: null, quotePostId: null });

      const feed = listCommunityFeedPosts(community.id, 20, 0);
      const bodies = feed.map((p) => p.body);
      expect(bodies).toContain('alice post');
      expect(bodies).toContain('bob post');
      expect(bodies).not.toContain('carol post');
    });

    it('excludes non-public posts', () => {
      const alice = makeProfile('alice2', 'clerk-alice2');
      const community = insertSocialCommunity({
        creatorProfileId: alice.id,
        slug: 'secret-club',
        name: 'Secret Club',
        description: '',
        visibility: 'public',
      });
      insertCommunityMembership(community.id, alice.id);
      insertSocialPost({ profileId: alice.id, body: 'private post', visibility: 'private', authorMode: 'person', linkedAgentId: null, replyToPostId: null, quotePostId: null });

      const feed = listCommunityFeedPosts(community.id, 20, 0);
      expect(feed).toHaveLength(0);
    });

    it('respects limit and offset', () => {
      const alice = makeProfile('alice3', 'clerk-alice3');
      const community = insertSocialCommunity({
        creatorProfileId: alice.id,
        slug: 'paginated-club',
        name: 'Paginated Club',
        description: '',
        visibility: 'public',
      });
      insertCommunityMembership(community.id, alice.id);
      for (let i = 0; i < 5; i++) {
        insertSocialPost({ profileId: alice.id, body: `post ${i}`, visibility: 'public', authorMode: 'person', linkedAgentId: null, replyToPostId: null, quotePostId: null });
      }

      const page1 = listCommunityFeedPosts(community.id, 2, 0);
      const page2 = listCommunityFeedPosts(community.id, 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('returns empty array for community with no members who have posted', () => {
      const alice = makeProfile('alice4', 'clerk-alice4');
      const community = insertSocialCommunity({
        creatorProfileId: alice.id,
        slug: 'empty-club',
        name: 'Empty Club',
        description: '',
        visibility: 'public',
      });
      const feed = listCommunityFeedPosts(community.id, 20, 0);
      expect(feed).toHaveLength(0);
    });
  });

  // ── listJoinedCommunities ─────────────────────────────────────────────────

  describe('listJoinedCommunities', () => {
    it('returns communities a profile has joined', () => {
      const alice = makeProfile('alice5', 'clerk-alice5');
      const c1 = insertSocialCommunity({ creatorProfileId: alice.id, slug: 'c1', name: 'C1', description: '', visibility: 'public' });
      const c2 = insertSocialCommunity({ creatorProfileId: alice.id, slug: 'c2', name: 'C2', description: '', visibility: 'public' });
      const c3 = insertSocialCommunity({ creatorProfileId: alice.id, slug: 'c3', name: 'C3', description: '', visibility: 'public' });

      insertCommunityMembership(c1.id, alice.id);
      insertCommunityMembership(c2.id, alice.id);

      const joined = listJoinedCommunities(alice.id, 20);
      const slugs = joined.map((c) => c.slug);
      expect(slugs).toContain('c1');
      expect(slugs).toContain('c2');
      expect(slugs).not.toContain('c3');
    });

    it('includes joined_at on each row', () => {
      const alice = makeProfile('alice6', 'clerk-alice6');
      const c1 = insertSocialCommunity({ creatorProfileId: alice.id, slug: 'd1', name: 'D1', description: '', visibility: 'public' });
      insertCommunityMembership(c1.id, alice.id);
      const joined = listJoinedCommunities(alice.id, 20);
      expect(joined[0].joined_at).toBeTruthy();
    });

    it('returns empty array when profile has no memberships', () => {
      const alice = makeProfile('alice7', 'clerk-alice7');
      const joined = listJoinedCommunities(alice.id, 20);
      expect(joined).toHaveLength(0);
    });

    it('respects limit', () => {
      const alice = makeProfile('alice8', 'clerk-alice8');
      for (let i = 0; i < 5; i++) {
        const c = insertSocialCommunity({ creatorProfileId: alice.id, slug: `lim-${i}`, name: `Lim ${i}`, description: '', visibility: 'public' });
        insertCommunityMembership(c.id, alice.id);
      }
      const joined = listJoinedCommunities(alice.id, 3);
      expect(joined).toHaveLength(3);
    });
  });

  // ── listFollowers ─────────────────────────────────────────────────────────

  describe('listFollowers', () => {
    it('returns profiles that follow the given profile', () => {
      const alice = makeProfile('alice9',  'clerk-alice9');
      const bob   = makeProfile('bob2',    'clerk-bob2');
      const carol = makeProfile('carol2',  'clerk-carol2');

      insertSocialFollow(bob.id,   alice.id);
      insertSocialFollow(carol.id, alice.id);

      const followers = listFollowers(alice.id, 20, 0);
      const handles = followers.map((p) => p.handle);
      expect(handles).toContain('bob2');
      expect(handles).toContain('carol2');
      expect(handles).not.toContain('alice9');
    });

    it('does not include profiles who are not followers', () => {
      const alice = makeProfile('alice10', 'clerk-alice10');
      const dave  = makeProfile('dave',    'clerk-dave');
      void dave;

      const followers = listFollowers(alice.id, 20, 0);
      expect(followers).toHaveLength(0);
    });

    it('respects limit and offset', () => {
      const alice = makeProfile('alice11', 'clerk-alice11');
      const followers: string[] = [];
      for (let i = 0; i < 5; i++) {
        const p = makeProfile(`follower${i}`, `clerk-follower${i}`);
        insertSocialFollow(p.id, alice.id);
        followers.push(p.id);
      }
      const page1 = listFollowers(alice.id, 2, 0);
      const page2 = listFollowers(alice.id, 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  // ── listFollowing ─────────────────────────────────────────────────────────

  describe('listFollowing', () => {
    it('returns profiles the given profile follows', () => {
      const alice = makeProfile('alice12', 'clerk-alice12');
      const bob   = makeProfile('bob3',    'clerk-bob3');
      const carol = makeProfile('carol3',  'clerk-carol3');

      insertSocialFollow(alice.id, bob.id);
      insertSocialFollow(alice.id, carol.id);

      const following = listFollowing(alice.id, 20, 0);
      const handles = following.map((p) => p.handle);
      expect(handles).toContain('bob3');
      expect(handles).toContain('carol3');
      expect(handles).not.toContain('alice12');
    });

    it('returns empty array when profile follows nobody', () => {
      const alice = makeProfile('alice13', 'clerk-alice13');
      const following = listFollowing(alice.id, 20, 0);
      expect(following).toHaveLength(0);
    });

    it('respects limit and offset', () => {
      const alice = makeProfile('alice14', 'clerk-alice14');
      for (let i = 0; i < 5; i++) {
        const p = makeProfile(`followee${i}`, `clerk-followee${i}`);
        insertSocialFollow(alice.id, p.id);
      }
      const page1 = listFollowing(alice.id, 2, 0);
      const page2 = listFollowing(alice.id, 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('is independent from followers — following alice does not appear in alice following list', () => {
      const alice = makeProfile('alice15', 'clerk-alice15');
      const bob   = makeProfile('bob4',    'clerk-bob4');

      insertSocialFollow(bob.id, alice.id);

      const aliceFollowing = listFollowing(alice.id, 20, 0);
      expect(aliceFollowing).toHaveLength(0);
    });
  });
});
