import { getDb } from './connection';
import { nanoid } from 'nanoid';

// ─── Row interfaces (snake_case matches SQLite columns) ──────────────────────

export interface SocialProfileRow {
  id: string;
  clerk_user_id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  banner_url: string | null;
  location: string | null;
  website_url: string | null;
  proof_state: string;
  continuity_state: string;
  created_at: string;
  updated_at: string;
}

export interface SocialProfileSummaryRow extends SocialProfileRow {
  primary_agent_name: string | null;
  primary_agent_slug: string | null;
  primary_agent_link_state: string | null;
}

export interface SocialLinkedAgentRow {
  id: string;
  profile_id: string;
  agent_name: string;
  agent_slug: string;
  agent_key: string;
  agent_type: string;
  link_state: string;
  visibility: string;
  proof_state: string;
  is_primary: number;
  created_at: string;
  updated_at: string;
}

export interface SocialPostWithAuthorRow {
  id: string;
  profile_id: string;
  linked_agent_id: string | null;
  body: string;
  visibility: string;
  proof_state: string;
  author_mode: string;
  reply_to_post_id: string | null;
  quote_post_id: string | null;
  created_at: string;
  updated_at: string;
  author_handle: string;
  author_display_name: string;
  agent_name: string | null;
  agent_slug: string | null;
}

export interface SocialCommunityWithCreatorRow {
  id: string;
  creator_profile_id: string;
  slug: string;
  name: string;
  description: string;
  visibility: string;
  created_at: string;
  updated_at: string;
  creator_handle: string;
  creator_display_name: string;
}

export interface SocialLongformWithAuthorRow {
  id: string;
  profile_id: string;
  linked_agent_id: string | null;
  title: string;
  summary: string;
  body: string;
  format_type: string;
  visibility: string;
  proof_state: string;
  author_mode: string;
  created_at: string;
  updated_at: string;
  author_handle: string;
  author_display_name: string;
  agent_name: string | null;
  agent_slug: string | null;
}

// ─── Profile queries ─────────────────────────────────────────────────────────

export function findSocialProfileByClerkId(clerkUserId: string): SocialProfileRow | undefined {
  return getDb()
    .prepare('SELECT * FROM social_profiles WHERE clerk_user_id = ?')
    .get(clerkUserId) as SocialProfileRow | undefined;
}

export function findSocialProfileByHandle(handle: string): SocialProfileRow | undefined {
  return getDb()
    .prepare('SELECT * FROM social_profiles WHERE handle = ?')
    .get(handle) as SocialProfileRow | undefined;
}

export function listSocialProfiles(limit: number): SocialProfileSummaryRow[] {
  return getDb().prepare(`
    SELECT p.*,
      la.agent_name    AS primary_agent_name,
      la.agent_slug    AS primary_agent_slug,
      la.link_state    AS primary_agent_link_state
    FROM social_profiles p
    LEFT JOIN social_linked_agents la
      ON la.profile_id = p.id AND la.is_primary = 1
    ORDER BY p.created_at DESC
    LIMIT ?
  `).all(limit) as SocialProfileSummaryRow[];
}

export function getFirstSocialProfile(): SocialProfileSummaryRow | undefined {
  return getDb().prepare(`
    SELECT p.*,
      la.agent_name    AS primary_agent_name,
      la.agent_slug    AS primary_agent_slug,
      la.link_state    AS primary_agent_link_state
    FROM social_profiles p
    LEFT JOIN social_linked_agents la
      ON la.profile_id = p.id AND la.is_primary = 1
    ORDER BY p.created_at ASC
    LIMIT 1
  `).get() as SocialProfileSummaryRow | undefined;
}

export function insertSocialProfile(data: {
  clerkUserId: string;
  handle: string;
  displayName: string;
  bio: string;
}): SocialProfileRow {
  const id = nanoid();
  getDb().prepare(`
    INSERT INTO social_profiles (id, clerk_user_id, handle, display_name, bio)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, data.clerkUserId, data.handle, data.displayName, data.bio);
  return getDb()
    .prepare('SELECT * FROM social_profiles WHERE id = ?')
    .get(id) as SocialProfileRow;
}

export function updateSocialProfile(
  clerkUserId: string,
  data: Partial<{
    displayName: string;
    bio: string;
    avatarUrl: string | null;
    bannerUrl: string | null;
    location: string | null;
    websiteUrl: string | null;
  }>,
): SocialProfileRow | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.displayName !== undefined) { fields.push('display_name = ?'); values.push(data.displayName); }
  if (data.bio !== undefined) { fields.push('bio = ?'); values.push(data.bio); }
  if (data.avatarUrl !== undefined) { fields.push('avatar_url = ?'); values.push(data.avatarUrl); }
  if (data.bannerUrl !== undefined) { fields.push('banner_url = ?'); values.push(data.bannerUrl); }
  if (data.location !== undefined) { fields.push('location = ?'); values.push(data.location); }
  if (data.websiteUrl !== undefined) { fields.push('website_url = ?'); values.push(data.websiteUrl); }

  if (fields.length === 0) return findSocialProfileByClerkId(clerkUserId);

  fields.push("updated_at = datetime('now')");
  values.push(clerkUserId);

  getDb().prepare(
    `UPDATE social_profiles SET ${fields.join(', ')} WHERE clerk_user_id = ?`
  ).run(...values);

  return findSocialProfileByClerkId(clerkUserId);
}

// ─── Linked agent queries ────────────────────────────────────────────────────

export function getLinkedAgentsByProfileId(profileId: string): SocialLinkedAgentRow[] {
  return getDb()
    .prepare('SELECT * FROM social_linked_agents WHERE profile_id = ? ORDER BY is_primary DESC, created_at ASC')
    .all(profileId) as SocialLinkedAgentRow[];
}

export function insertLinkedAgent(data: {
  profileId: string;
  agentName: string;
  agentSlug: string;
  agentKey: string;
  agentType: string;
  visibility: string;
  proofState: string;
  isPrimary: boolean;
}): SocialLinkedAgentRow {
  const id = nanoid();
  getDb().prepare(`
    INSERT INTO social_linked_agents
      (id, profile_id, agent_name, agent_slug, agent_key, agent_type, visibility, proof_state, is_primary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.profileId, data.agentName, data.agentSlug, data.agentKey,
         data.agentType, data.visibility, data.proofState, data.isPrimary ? 1 : 0);
  return getDb()
    .prepare('SELECT * FROM social_linked_agents WHERE id = ?')
    .get(id) as SocialLinkedAgentRow;
}

// ─── Profile stats ───────────────────────────────────────────────────────────

export function getProfileStats(profileId: string): {
  postCount: number;
  followerCount: number;
  followingCount: number;
  linkedAgentCount: number;
  communityCount: number;
  longformCount: number;
} {
  const db = getDb();
  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { cnt: number }).cnt;

  return {
    postCount: count('SELECT COUNT(*) AS cnt FROM social_posts WHERE profile_id = ?', profileId),
    followerCount: count('SELECT COUNT(*) AS cnt FROM social_follows WHERE following_profile_id = ?', profileId),
    followingCount: count('SELECT COUNT(*) AS cnt FROM social_follows WHERE follower_profile_id = ?', profileId),
    linkedAgentCount: count('SELECT COUNT(*) AS cnt FROM social_linked_agents WHERE profile_id = ?', profileId),
    communityCount: count('SELECT COUNT(*) AS cnt FROM social_communities WHERE creator_profile_id = ?', profileId),
    longformCount: count('SELECT COUNT(*) AS cnt FROM social_longform WHERE profile_id = ?', profileId),
  };
}

// ─── Feed queries ────────────────────────────────────────────────────────────

export function listFeedPosts(
  limit: number,
  offset: number,
  filter?: string,
): SocialPostWithAuthorRow[] {
  const filterClause = filter && filter !== 'all'
    ? `AND sp.author_mode = '${filter.replace(/'/g, "''")}'`
    : '';

  return getDb().prepare(`
    SELECT
      sp.*,
      p.handle    AS author_handle,
      p.display_name AS author_display_name,
      la.agent_name  AS agent_name,
      la.agent_slug  AS agent_slug
    FROM social_posts sp
    JOIN social_profiles p ON p.id = sp.profile_id
    LEFT JOIN social_linked_agents la ON la.id = sp.linked_agent_id
    WHERE sp.visibility = 'public' ${filterClause}
    ORDER BY sp.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as SocialPostWithAuthorRow[];
}

export function listFeedPostsByHandle(
  handle: string,
  limit: number,
  offset: number,
): SocialPostWithAuthorRow[] {
  return getDb().prepare(`
    SELECT
      sp.*,
      p.handle       AS author_handle,
      p.display_name AS author_display_name,
      la.agent_name  AS agent_name,
      la.agent_slug  AS agent_slug
    FROM social_posts sp
    JOIN social_profiles p ON p.id = sp.profile_id AND p.handle = ?
    LEFT JOIN social_linked_agents la ON la.id = sp.linked_agent_id
    WHERE sp.visibility = 'public'
    ORDER BY sp.created_at DESC
    LIMIT ? OFFSET ?
  `).all(handle, limit, offset) as SocialPostWithAuthorRow[];
}

export function insertSocialPost(data: {
  profileId: string;
  body: string;
  visibility: string;
  authorMode: string;
  linkedAgentId: string | null;
  replyToPostId: string | null;
  quotePostId: string | null;
}): SocialPostWithAuthorRow {
  const id = nanoid();
  getDb().prepare(`
    INSERT INTO social_posts
      (id, profile_id, body, visibility, author_mode, linked_agent_id, reply_to_post_id, quote_post_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.profileId, data.body, data.visibility, data.authorMode,
         data.linkedAgentId, data.replyToPostId, data.quotePostId);
  return getDb().prepare(`
    SELECT sp.*, p.handle AS author_handle, p.display_name AS author_display_name,
      la.agent_name AS agent_name, la.agent_slug AS agent_slug
    FROM social_posts sp
    JOIN social_profiles p ON p.id = sp.profile_id
    LEFT JOIN social_linked_agents la ON la.id = sp.linked_agent_id
    WHERE sp.id = ?
  `).get(id) as SocialPostWithAuthorRow;
}

// ─── Follow queries ──────────────────────────────────────────────────────────

export function getFollowStatus(followerProfileId: string, followingProfileId: string): boolean {
  return getDb()
    .prepare('SELECT 1 FROM social_follows WHERE follower_profile_id = ? AND following_profile_id = ?')
    .get(followerProfileId, followingProfileId) !== undefined;
}

export function insertSocialFollow(followerProfileId: string, followingProfileId: string): string {
  const id = nanoid();
  getDb().prepare(`
    INSERT OR IGNORE INTO social_follows (id, follower_profile_id, following_profile_id)
    VALUES (?, ?, ?)
  `).run(id, followerProfileId, followingProfileId);
  const row = getDb()
    .prepare('SELECT id FROM social_follows WHERE follower_profile_id = ? AND following_profile_id = ?')
    .get(followerProfileId, followingProfileId) as { id: string };
  return row.id;
}

export function deleteSocialFollow(followerProfileId: string, followingProfileId: string): void {
  getDb()
    .prepare('DELETE FROM social_follows WHERE follower_profile_id = ? AND following_profile_id = ?')
    .run(followerProfileId, followingProfileId);
}

// ─── Community queries ───────────────────────────────────────────────────────

export function listSocialCommunities(limit: number): SocialCommunityWithCreatorRow[] {
  return getDb().prepare(`
    SELECT sc.*, p.handle AS creator_handle, p.display_name AS creator_display_name
    FROM social_communities sc
    JOIN social_profiles p ON p.id = sc.creator_profile_id
    WHERE sc.visibility = 'public'
    ORDER BY sc.created_at DESC
    LIMIT ?
  `).all(limit) as SocialCommunityWithCreatorRow[];
}

export function findSocialCommunityBySlug(slug: string): SocialCommunityWithCreatorRow | undefined {
  return getDb().prepare(`
    SELECT sc.*, p.handle AS creator_handle, p.display_name AS creator_display_name
    FROM social_communities sc
    JOIN social_profiles p ON p.id = sc.creator_profile_id
    WHERE sc.slug = ?
  `).get(slug) as SocialCommunityWithCreatorRow | undefined;
}

export function insertSocialCommunity(data: {
  creatorProfileId: string;
  slug: string;
  name: string;
  description: string;
  visibility: string;
}): SocialCommunityWithCreatorRow {
  const id = nanoid();
  getDb().prepare(`
    INSERT INTO social_communities (id, creator_profile_id, slug, name, description, visibility)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.creatorProfileId, data.slug, data.name, data.description, data.visibility);
  return findSocialCommunityBySlug(data.slug)!;
}

export function insertCommunityMembership(communityId: string, profileId: string): string {
  const id = nanoid();
  getDb().prepare(`
    INSERT OR IGNORE INTO social_community_memberships (id, community_id, profile_id)
    VALUES (?, ?, ?)
  `).run(id, communityId, profileId);
  const row = getDb()
    .prepare('SELECT id FROM social_community_memberships WHERE community_id = ? AND profile_id = ?')
    .get(communityId, profileId) as { id: string };
  return row.id;
}

// ─── Longform queries ────────────────────────────────────────────────────────

export function listSocialLongform(limit: number, offset: number): SocialLongformWithAuthorRow[] {
  return getDb().prepare(`
    SELECT
      sl.*,
      p.handle       AS author_handle,
      p.display_name AS author_display_name,
      la.agent_name  AS agent_name,
      la.agent_slug  AS agent_slug
    FROM social_longform sl
    JOIN social_profiles p ON p.id = sl.profile_id
    LEFT JOIN social_linked_agents la ON la.id = sl.linked_agent_id
    WHERE sl.visibility = 'public'
    ORDER BY sl.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as SocialLongformWithAuthorRow[];
}

export function insertSocialLongform(data: {
  profileId: string;
  title: string;
  summary: string;
  body: string;
  formatType: string;
  visibility: string;
  authorMode: string;
  linkedAgentId: string | null;
}): SocialLongformWithAuthorRow {
  const id = nanoid();
  getDb().prepare(`
    INSERT INTO social_longform
      (id, profile_id, title, summary, body, format_type, visibility, author_mode, linked_agent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.profileId, data.title, data.summary, data.body,
         data.formatType, data.visibility, data.authorMode, data.linkedAgentId);
  return getDb().prepare(`
    SELECT sl.*, p.handle AS author_handle, p.display_name AS author_display_name,
      la.agent_name AS agent_name, la.agent_slug AS agent_slug
    FROM social_longform sl
    JOIN social_profiles p ON p.id = sl.profile_id
    LEFT JOIN social_linked_agents la ON la.id = sl.linked_agent_id
    WHERE sl.id = ?
  `).get(id) as SocialLongformWithAuthorRow;
}
