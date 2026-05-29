import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetDbForTests, closeDb, initDb } from '../../src/db/index';

describe('migration 201 — social layer schema', () => {
  beforeEach(() => {
    _resetDbForTests();
    initDb({ path: ':memory:' });
  });

  afterEach(() => {
    closeDb();
    _resetDbForTests();
  });

  const tableColumns = (table: string): string[] => {
    const db = initDb({ path: ':memory:' });
    const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    return cols.map((c) => c.name);
  };

  it('creates social_profiles with required columns', () => {
    const cols = tableColumns('social_profiles');
    expect(cols).toContain('id');
    expect(cols).toContain('clerk_user_id');
    expect(cols).toContain('handle');
    expect(cols).toContain('display_name');
    expect(cols).toContain('bio');
    expect(cols).toContain('avatar_url');
    expect(cols).toContain('proof_state');
    expect(cols).toContain('continuity_state');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  it('creates social_linked_agents with required columns', () => {
    const cols = tableColumns('social_linked_agents');
    expect(cols).toContain('id');
    expect(cols).toContain('profile_id');
    expect(cols).toContain('agent_name');
    expect(cols).toContain('agent_slug');
    expect(cols).toContain('agent_key');
    expect(cols).toContain('is_primary');
    expect(cols).toContain('proof_state');
  });

  it('creates social_posts with required columns', () => {
    const cols = tableColumns('social_posts');
    expect(cols).toContain('id');
    expect(cols).toContain('profile_id');
    expect(cols).toContain('body');
    expect(cols).toContain('author_mode');
    expect(cols).toContain('reply_to_post_id');
    expect(cols).toContain('quote_post_id');
    expect(cols).toContain('visibility');
    expect(cols).toContain('proof_state');
  });

  it('creates social_follows with required columns', () => {
    const cols = tableColumns('social_follows');
    expect(cols).toContain('id');
    expect(cols).toContain('follower_profile_id');
    expect(cols).toContain('following_profile_id');
    expect(cols).toContain('created_at');
  });

  it('creates social_communities with required columns', () => {
    const cols = tableColumns('social_communities');
    expect(cols).toContain('id');
    expect(cols).toContain('creator_profile_id');
    expect(cols).toContain('slug');
    expect(cols).toContain('name');
    expect(cols).toContain('description');
    expect(cols).toContain('visibility');
  });

  it('creates social_community_memberships with required columns', () => {
    const cols = tableColumns('social_community_memberships');
    expect(cols).toContain('id');
    expect(cols).toContain('community_id');
    expect(cols).toContain('profile_id');
    expect(cols).toContain('joined_at');
  });

  it('creates social_longform with required columns', () => {
    const cols = tableColumns('social_longform');
    expect(cols).toContain('id');
    expect(cols).toContain('profile_id');
    expect(cols).toContain('title');
    expect(cols).toContain('summary');
    expect(cols).toContain('body');
    expect(cols).toContain('format_type');
    expect(cols).toContain('author_mode');
    expect(cols).toContain('proof_state');
  });

  it('enforces unique handle constraint on social_profiles', () => {
    const db = initDb({ path: ':memory:' });
    db.exec(`INSERT INTO social_profiles (id, clerk_user_id, handle, display_name) VALUES ('a', 'clerk1', 'alice', 'Alice')`);
    expect(() => {
      db.exec(`INSERT INTO social_profiles (id, clerk_user_id, handle, display_name) VALUES ('b', 'clerk2', 'alice', 'Alice2')`);
    }).toThrow();
  });

  it('enforces unique clerk_user_id constraint on social_profiles', () => {
    const db = initDb({ path: ':memory:' });
    db.exec(`INSERT INTO social_profiles (id, clerk_user_id, handle, display_name) VALUES ('a', 'clerk1', 'alice', 'Alice')`);
    expect(() => {
      db.exec(`INSERT INTO social_profiles (id, clerk_user_id, handle, display_name) VALUES ('b', 'clerk1', 'bob', 'Bob')`);
    }).toThrow();
  });

  it('enforces unique slug constraint on social_communities', () => {
    const db = initDb({ path: ':memory:' });
    db.exec(`INSERT INTO social_profiles (id, clerk_user_id, handle, display_name) VALUES ('p1', 'clerk1', 'alice', 'Alice')`);
    db.exec(`INSERT INTO social_communities (id, creator_profile_id, slug, name) VALUES ('c1', 'p1', 'my-community', 'My Community')`);
    expect(() => {
      db.exec(`INSERT INTO social_communities (id, creator_profile_id, slug, name) VALUES ('c2', 'p1', 'my-community', 'Dupe')`);
    }).toThrow();
  });
});
