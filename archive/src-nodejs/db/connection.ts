/**
 * SQLite connection scaffold — single shared `better-sqlite3` handle.
 *
 * Pure-infrastructure module: nothing in the request path uses this yet.
 * It exists so that upcoming work (rotation credential tables, receipt
 * log, etc.) can open a database via a single reviewed primitive with
 * consistent pragmas, a migration bootstrap table, and a lifecycle
 * (init on start, close on shutdown) wired into the server.
 *
 * Pragmas set at init:
 *
 *   - `journal_mode=WAL`      — concurrent reads during writes; standard
 *                               for a single-process writer on a VPS.
 *   - `foreign_keys=ON`       — enforce FK constraints (off by default
 *                               in SQLite, which would silently permit
 *                               orphaned rows).
 *   - `busy_timeout=5000`     — block up to 5s on a locked database
 *                               instead of failing immediately, which
 *                               covers the occasional WAL checkpoint.
 *
 * Migration bootstrap: a `schema_migrations(version INTEGER PRIMARY KEY,
 * applied_at TEXT NOT NULL)` table is created unconditionally. The
 * MIGRATIONS array is intentionally empty in this PR — real migrations
 * (rotation tables, etc.) land in later PRs, each one appending a new
 * entry whose `version` is monotonically increasing.
 *
 * Test path: `initDb({ path: ':memory:' })` skips the data-directory
 * creation so unit tests can exercise the scaffold without touching the
 * filesystem.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

import { env } from '../config/index';
import { logger } from '../utils/logger';

type DbHandle = Database.Database;

interface Migration {
  version: number;
  description: string;
  up: (db: DbHandle) => void;
}

/**
 * Registered schema migrations, applied in order.
 *
 * Each entry must be idempotent under `CREATE TABLE IF NOT EXISTS` /
 * `CREATE INDEX IF NOT EXISTS` so that replaying the migration on a
 * database that already has the table is a no-op. Version numbers
 * are monotonically increasing; never re-use or re-order a version
 * once it has been merged to main.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'api_key_rotation credentials + identities',
    up: (db) => {
      // Durable half of the upcoming ClawNetApiKeyBackend:
      //
      //   api_key_rotation_credentials — every minted credential, active
      //   or revoked. The controller's verify-before-revoke keeps stale
      //   rows around until the next identity rotation drops them.
      //
      //   api_key_rotation_identities  — per-identity pointer tracking
      //   the current credential and the pre-committed next keypair.
      //
      // Both tables are INERT in this PR: no request-path code reads or
      // writes them yet. The backend wiring, admin mint endpoint, and
      // shadow-check lookup land in later PRs (#5/#6/#7).
      //
      // Secret columns store either a plain base64 row (legacy/no KEK)
      // or a `v1:…` AES-256-GCM blob from `src/core/vault-crypto.ts`.
      // Both forms are transparently handled by `decryptSecret`.
      //
      // No foreign keys: `identity_id` is a free-form string, and the
      // identities table is not populated from any cross-table source
      // that would meaningfully constrain it.
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_key_rotation_credentials (
          credential_id TEXT PRIMARY KEY,
          identity_id TEXT NOT NULL,
          algorithm_suite TEXT NOT NULL,
          class TEXT NOT NULL,
          public_key TEXT NOT NULL,
          secret_key TEXT NOT NULL,
          next_manifest_commitment TEXT NOT NULL,
          issued_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          revoked INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_akrc_identity
          ON api_key_rotation_credentials(identity_id);
        CREATE TABLE IF NOT EXISTS api_key_rotation_identities (
          identity_id TEXT PRIMARY KEY,
          current_credential_id TEXT NOT NULL,
          next_public_key TEXT NOT NULL,
          next_secret_key TEXT NOT NULL,
          ttl_ms INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    description: 'api_key_rotation_adoption mapping (G7.2)',
    up: (db) => {
      // Storage-only mapping for the Gate 7.2 adoption primitive. Each
      // row claims a `cn-[a-f0-9]{48}` legacy bearer as a rotation
      // credential: the `bearer` column equals the corresponding
      // `api_key_rotation_credentials.credential_id` by construction,
      // because the adoption path writes both rows in a single sync
      // transaction with `credential_id = bearer`.
      //
      // Three columns only. No `source`, no `authoritative`, no FK.
      // Rationale:
      //   - `source` / `authoritative` belong to the post-Gate-7
      //     cutover and would pre-commit schema decisions that that
      //     work deserves to make in its own PR.
      //   - No FK because v1 skips FKs and v2 stays consistent.
      //
      // Rollback (documented-only, no down hook):
      //   DROP INDEX idx_akra_identity;
      //   DROP TABLE api_key_rotation_adoption;
      //
      // This migration is additive and cannot corrupt v1 state.
      // SQLite quirk: `bearer TEXT PRIMARY KEY` alone would permit NULL
      // in the PK column (historical behavior preserved for backwards
      // compatibility; see https://sqlite.org/lang_createtable.html#the_primary_key).
      // Declare `NOT NULL` explicitly so `PRAGMA table_info` reports
      // notnull=1 and a NULL insert is refused at the engine level.
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_key_rotation_adoption (
          bearer TEXT PRIMARY KEY NOT NULL,
          identity_id TEXT NOT NULL,
          adopted_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_akra_identity
          ON api_key_rotation_adoption(identity_id);
      `);
    },
  },
  {
    version: 3,
    description: 'oauth_codes + audit_log — Sign in with ClawNet foundation tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS oauth_codes (
          code TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          api_key TEXT NOT NULL,
          app TEXT NOT NULL,
          email TEXT DEFAULT '',
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          action TEXT NOT NULL,
          actor_id TEXT,
          data_json TEXT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_entity
          ON audit_log(entity_type, entity_id);
      `);
    },
  },
  {
    version: 4,
    description: 'api_keys — core account table (no-op on live DB, migration debt repair)',
    up: (db) => {
      // CREATE TABLE IF NOT EXISTS is a safe no-op on the live database where
      // this table already exists (created by the guardian-vps migration lineage).
      // On a fresh database (CI, local dev, new VPS) this creates the table so
      // that GET /v1/auth/me and the OAuth auto-create path work without external
      // SQL setup. Columns and defaults exactly match the guardian-vps production
      // schema as of 2026-04.
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
          key TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          credits INTEGER NOT NULL DEFAULT 0,
          credits_used INTEGER NOT NULL DEFAULT 0,
          stripe_session_id TEXT UNIQUE,
          amount_paid REAL NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT,
          clerk_user_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_api_keys_clerk
          ON api_keys(clerk_user_id);
      `);
    },
  },
  {
    version: 197,
    description: 'soma_delegations — Soma identity leaf per ClawNet account',
    up: (db) => {
      // One row per account: the delegation leaf issued by ClawNet's root heart
      // at signup. delegation_json holds the full signed Delegation so it can be
      // returned to clients or chain-verified without re-issuing.
      //
      // INSERT OR IGNORE in the writer prevents duplicate rows on re-issue.
      // FK to api_keys.key enforced by foreign_keys=ON pragma set in initDb.
      // Rollback: DROP INDEX idx_soma_delegations_{api_key,clerk}; DROP TABLE soma_delegations;
      db.exec(`
        CREATE TABLE IF NOT EXISTS soma_delegations (
          id TEXT PRIMARY KEY,
          api_key_id TEXT NOT NULL REFERENCES api_keys(key),
          clerk_user_id TEXT NOT NULL,
          subject_did TEXT NOT NULL,
          delegation_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_soma_delegations_api_key
          ON soma_delegations(api_key_id);
        CREATE INDEX IF NOT EXISTS idx_soma_delegations_clerk
          ON soma_delegations(clerk_user_id);
      `);
    },
  },
  // Version 198: guardian-vps prior system occupies schema_migrations rows 1–196.
  // Versions 197+ are reserved for this repo. Do not use versions below 197 for new migrations.
  {
    version: 198,
    description: 'delegated_keys — Soma delegation key issuance + spend tracking',
    up: (db) => {
      // Economy delegation keys: issued by a root cn- account, scoped to a set
      // of endpoint globs, optionally capped on spend. account_key always points
      // to the root api_keys.key so billing deducts from the owner regardless of
      // which delegation key is presented.  scope_endpoints stores a JSON array
      // (e.g. '["pulse.*"]').  spend_used_credits is incremented atomically with
      // the api_keys deduction inside a single transaction (see POST /v1/auth/deduct).
      //
      // Rollback: DROP INDEX idx_delegated_keys_{account,parent}; DROP TABLE delegated_keys;
      db.exec(`
        CREATE TABLE IF NOT EXISTS delegated_keys (
          key TEXT PRIMARY KEY NOT NULL,
          account_key TEXT NOT NULL REFERENCES api_keys(key),
          parent_key TEXT NOT NULL,
          label TEXT,
          depth INTEGER NOT NULL DEFAULT 1,
          max_depth INTEGER NOT NULL DEFAULT 0,
          scope_endpoints TEXT,
          spend_cap_credits INTEGER,
          spend_used_credits INTEGER NOT NULL DEFAULT 0,
          branch_spend_cap_credits INTEGER,
          intent_declaration TEXT,
          expires_at TEXT,
          revoked_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_delegated_keys_account
          ON delegated_keys(account_key);
        CREATE INDEX IF NOT EXISTS idx_delegated_keys_parent
          ON delegated_keys(parent_key);
      `);
    },
  },
  {
    version: 199,
    description: 'webauthn_credentials + pending_ceremonies — WebAuthn signing ceremony',
    up: (db) => {
      // WebAuthn authenticator registry and signing ceremony state for
      // Soma UpdateCertificate authorization (proposal §8).
      //
      //   webauthn_credentials — every enrolled authenticator (passkey,
      //   hardware key, recovery seed). Credentials are never deleted;
      //   revoked rows stay with status='revoked' and revoked_at set.
      //   Role determines ceremony inclusion: primary and backup appear
      //   in allowCredentials, recovery is excluded (dedicated flow only).
      //
      //   pending_ceremonies — each CI-initiated ceremony request.
      //   Status lifecycle: awaiting_webauthn → completed | expired | cancelled.
      //   authenticator_credential_id references webauthn_credentials.id
      //   by convention but is not enforced (consistent with v1/v2 FK pattern).
      //
      // Rollback:
      //   DROP INDEX idx_pending_ceremonies_{status,expires};
      //   DROP INDEX idx_webauthn_credentials_{status,role};
      //   DROP TABLE pending_ceremonies;
      //   DROP TABLE webauthn_credentials;
      db.exec(`
        CREATE TABLE IF NOT EXISTS webauthn_credentials (
          id TEXT PRIMARY KEY,
          credential_id TEXT UNIQUE NOT NULL,
          public_key TEXT NOT NULL,
          counter INTEGER NOT NULL DEFAULT 0,
          transports TEXT,
          aaguid TEXT,
          ecosystem TEXT NOT NULL,
          role TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT,
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_status
          ON webauthn_credentials(status);
        CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_role
          ON webauthn_credentials(role);
        CREATE TABLE IF NOT EXISTS pending_ceremonies (
          id TEXT PRIMARY KEY,
          package_name TEXT NOT NULL,
          target_version TEXT NOT NULL,
          tarball_sha256 TEXT NOT NULL,
          git_commit TEXT NOT NULL,
          release_log_sequence INTEGER,
          release_log_entry_hash TEXT,
          status TEXT NOT NULL DEFAULT 'awaiting_webauthn',
          expires_at TEXT NOT NULL,
          completed_at TEXT,
          authenticator_credential_id TEXT,
          authenticator_kind TEXT,
          certificate_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_pending_ceremonies_status
          ON pending_ceremonies(status);
        CREATE INDEX IF NOT EXISTS idx_pending_ceremonies_expires
          ON pending_ceremonies(expires_at);
      `);
    },
  },
  {
    version: 200,
    description: 'rotation tables — guardian version collision fix',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_key_rotation_credentials (
          credential_id TEXT PRIMARY KEY,
          identity_id TEXT NOT NULL,
          algorithm_suite TEXT NOT NULL,
          class TEXT NOT NULL,
          public_key TEXT NOT NULL,
          secret_key TEXT NOT NULL,
          next_manifest_commitment TEXT NOT NULL,
          issued_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          revoked INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_akrc_identity
          ON api_key_rotation_credentials(identity_id);
        CREATE TABLE IF NOT EXISTS api_key_rotation_identities (
          identity_id TEXT PRIMARY KEY,
          current_credential_id TEXT NOT NULL,
          next_public_key TEXT NOT NULL,
          next_secret_key TEXT NOT NULL,
          ttl_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS api_key_rotation_adoption (
          bearer TEXT PRIMARY KEY NOT NULL,
          identity_id TEXT NOT NULL,
          adopted_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_akra_identity
          ON api_key_rotation_adoption(identity_id);
      `);
    },
  },
  {
    version: 201,
    description: 'social layer — profiles, posts, follows, communities, longform',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS social_profiles (
          id TEXT PRIMARY KEY,
          clerk_user_id TEXT NOT NULL,
          handle TEXT NOT NULL,
          display_name TEXT NOT NULL,
          bio TEXT NOT NULL DEFAULT '',
          avatar_url TEXT,
          banner_url TEXT,
          location TEXT,
          website_url TEXT,
          proof_state TEXT NOT NULL DEFAULT 'pending',
          continuity_state TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_social_profiles_clerk
          ON social_profiles(clerk_user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_social_profiles_handle
          ON social_profiles(handle);

        CREATE TABLE IF NOT EXISTS social_linked_agents (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES social_profiles(id),
          agent_name TEXT NOT NULL,
          agent_slug TEXT NOT NULL,
          agent_key TEXT NOT NULL,
          agent_type TEXT NOT NULL DEFAULT 'general',
          link_state TEXT NOT NULL DEFAULT 'active',
          visibility TEXT NOT NULL DEFAULT 'public',
          proof_state TEXT NOT NULL DEFAULT 'pending',
          is_primary INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_social_linked_agents_profile
          ON social_linked_agents(profile_id);

        CREATE TABLE IF NOT EXISTS social_posts (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES social_profiles(id),
          linked_agent_id TEXT REFERENCES social_linked_agents(id),
          body TEXT NOT NULL,
          visibility TEXT NOT NULL DEFAULT 'public',
          proof_state TEXT NOT NULL DEFAULT 'pending',
          author_mode TEXT NOT NULL DEFAULT 'person',
          reply_to_post_id TEXT REFERENCES social_posts(id),
          quote_post_id TEXT REFERENCES social_posts(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_social_posts_profile
          ON social_posts(profile_id);
        CREATE INDEX IF NOT EXISTS idx_social_posts_created
          ON social_posts(created_at);

        CREATE TABLE IF NOT EXISTS social_follows (
          id TEXT PRIMARY KEY,
          follower_profile_id TEXT NOT NULL REFERENCES social_profiles(id),
          following_profile_id TEXT NOT NULL REFERENCES social_profiles(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_social_follows_pair
          ON social_follows(follower_profile_id, following_profile_id);
        CREATE INDEX IF NOT EXISTS idx_social_follows_follower
          ON social_follows(follower_profile_id);
        CREATE INDEX IF NOT EXISTS idx_social_follows_following
          ON social_follows(following_profile_id);

        CREATE TABLE IF NOT EXISTS social_communities (
          id TEXT PRIMARY KEY,
          creator_profile_id TEXT NOT NULL REFERENCES social_profiles(id),
          slug TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          visibility TEXT NOT NULL DEFAULT 'public',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_social_communities_slug
          ON social_communities(slug);
        CREATE INDEX IF NOT EXISTS idx_social_communities_creator
          ON social_communities(creator_profile_id);

        CREATE TABLE IF NOT EXISTS social_community_memberships (
          id TEXT PRIMARY KEY,
          community_id TEXT NOT NULL REFERENCES social_communities(id),
          profile_id TEXT NOT NULL REFERENCES social_profiles(id),
          joined_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_social_memberships_pair
          ON social_community_memberships(community_id, profile_id);
        CREATE INDEX IF NOT EXISTS idx_social_memberships_profile
          ON social_community_memberships(profile_id);

        CREATE TABLE IF NOT EXISTS social_longform (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES social_profiles(id),
          linked_agent_id TEXT REFERENCES social_linked_agents(id),
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL,
          format_type TEXT NOT NULL DEFAULT 'essay',
          visibility TEXT NOT NULL DEFAULT 'public',
          proof_state TEXT NOT NULL DEFAULT 'pending',
          author_mode TEXT NOT NULL DEFAULT 'person',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_social_longform_profile
          ON social_longform(profile_id);
        CREATE INDEX IF NOT EXISTS idx_social_longform_created
          ON social_longform(created_at);

        CREATE TABLE IF NOT EXISTS social_likes (
          profile_id TEXT NOT NULL REFERENCES social_profiles(id),
          post_id TEXT NOT NULL REFERENCES social_posts(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (profile_id, post_id)
        );
        CREATE INDEX IF NOT EXISTS idx_social_likes_post
          ON social_likes(post_id);

        CREATE TABLE IF NOT EXISTS social_bookmarks (
          profile_id TEXT NOT NULL REFERENCES social_profiles(id),
          post_id TEXT NOT NULL REFERENCES social_posts(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (profile_id, post_id)
        );
        CREATE INDEX IF NOT EXISTS idx_social_bookmarks_post
          ON social_bookmarks(post_id);

        CREATE TABLE IF NOT EXISTS social_reposts (
          profile_id TEXT NOT NULL REFERENCES social_profiles(id),
          post_id TEXT NOT NULL REFERENCES social_posts(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (profile_id, post_id)
        );
        CREATE INDEX IF NOT EXISTS idx_social_reposts_post
          ON social_reposts(post_id);
      `);
    },
  },
  {
    version: 202,
    description: 'pulse — draft-and-approve pipeline for agent-assisted posts',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pulse_drafts (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL,
          body TEXT NOT NULL,
          visibility TEXT NOT NULL DEFAULT 'public',
          author_mode TEXT NOT NULL DEFAULT 'agent',
          linked_agent_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (profile_id) REFERENCES social_profiles(id)
        );
        CREATE INDEX IF NOT EXISTS idx_pulse_drafts_profile
          ON pulse_drafts(profile_id);
        CREATE INDEX IF NOT EXISTS idx_pulse_drafts_status
          ON pulse_drafts(status);

        CREATE TABLE IF NOT EXISTS pulse_audit_log (
          id TEXT PRIMARY KEY,
          draft_id TEXT NOT NULL,
          action TEXT NOT NULL,
          actor_profile_id TEXT NOT NULL,
          details TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (draft_id) REFERENCES pulse_drafts(id)
        );
        CREATE INDEX IF NOT EXISTS idx_pulse_audit_log_draft
          ON pulse_audit_log(draft_id);
      `);
    },
  },
];

/**
 * Align a guardian-vps-era `delegated_keys` table with the schema v198
 * expects.  No-op on fresh DBs where the table does not exist yet.
 */
function alignLegacyDelegatedKeys(handle: DbHandle): void {
  const cols = handle.pragma('table_info(delegated_keys)') as Array<{
    name: string;
  }>;
  if (cols.length === 0) return;

  const names = new Set(cols.map((c) => c.name));
  const isLegacy = names.has('child_key') || !names.has('account_key');
  if (!isLegacy) return;

  handle.transaction(() => {
    // Guardian-vps PK was "child_key"; v198 expects "key".
    if (names.has('child_key') && !names.has('key')) {
      handle.exec(
        'ALTER TABLE delegated_keys RENAME COLUMN child_key TO key',
      );
    }

    // v198 indexes delegated_keys(account_key) — missing from legacy.
    // Backfill from parent_key which served the same billing role.
    if (!names.has('account_key')) {
      handle.exec('ALTER TABLE delegated_keys ADD COLUMN account_key TEXT');
      handle.exec(
        'UPDATE delegated_keys SET account_key = parent_key WHERE account_key IS NULL',
      );
    }

    if (!names.has('spend_cap_credits')) {
      handle.exec(
        'ALTER TABLE delegated_keys ADD COLUMN spend_cap_credits INTEGER',
      );
    }
    if (!names.has('spend_used_credits')) {
      handle.exec(
        'ALTER TABLE delegated_keys ADD COLUMN spend_used_credits INTEGER NOT NULL DEFAULT 0',
      );
    }
    if (!names.has('branch_spend_cap_credits')) {
      handle.exec(
        'ALTER TABLE delegated_keys ADD COLUMN branch_spend_cap_credits INTEGER',
      );
    }
    if (names.has('scope_endpoints_glob') && !names.has('scope_endpoints')) {
      handle.exec(
        'ALTER TABLE delegated_keys RENAME COLUMN scope_endpoints_glob TO scope_endpoints',
      );
    } else if (!names.has('scope_endpoints')) {
      handle.exec(
        'ALTER TABLE delegated_keys ADD COLUMN scope_endpoints TEXT',
      );
    }
  })();
  logger.info('db: aligned legacy delegated_keys schema');
}

let db: DbHandle | null = null;

export interface InitDbOptions {
  /**
   * Override the database path. Defaults to `env.DB_PATH`.
   * Pass `':memory:'` in tests to skip filesystem IO.
   */
  path?: string;
}

/**
 * Open the database handle, set pragmas, and run any pending
 * migrations. Idempotent: calling twice with no intervening `closeDb`
 * returns the existing handle.
 */
export function initDb(options: InitDbOptions = {}): DbHandle {
  if (db) return db;

  const dbPath = options.path ?? env.DB_PATH;

  if (dbPath !== ':memory:') {
    const dir = path.dirname(path.resolve(dbPath));
    fs.mkdirSync(dir, { recursive: true });
  }

  const handle = new Database(dbPath);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');
  handle.pragma('busy_timeout = 5000');

  alignLegacyDelegatedKeys(handle);

  handle.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set<number>(
    handle
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version),
  );

  // `OR IGNORE` on the schema_migrations insert makes the migration
  // step race-tolerant: if two initializers somehow hit the same
  // on-disk database before either has committed (not a supported
  // operating mode today — the orchestrator runs as a single Node
  // process — but also not guaranteed by anything architectural), the
  // second writer's `CREATE TABLE IF NOT EXISTS` is already a no-op,
  // and this insert silently no-ops instead of tripping the PRIMARY
  // KEY constraint and rolling the whole transaction back.
  const insertApplied = handle.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    const runMigration = handle.transaction(() => {
      migration.up(handle);
      insertApplied.run(migration.version, new Date().toISOString());
    });
    runMigration();
    logger.info(
      { version: migration.version, description: migration.description },
      'db: migration applied',
    );
  }

  db = handle;
  logger.info({ path: dbPath }, 'db: initialized');
  return db;
}

/**
 * Return the shared database handle. Throws if `initDb` has not been
 * called yet — callers should never lazily open the database on first
 * query, because that would bypass the startup lifecycle and hide
 * migration failures behind the first request.
 */
export function getDb(): DbHandle {
  if (!db) {
    throw new Error('db: getDb() called before initDb()');
  }
  return db;
}

/**
 * Close the database handle. Safe to call multiple times; a no-op if
 * the handle is already closed. Invoked from the graceful-shutdown
 * hook so the WAL is checkpointed and the file handle released before
 * the process exits.
 */
export function closeDb(): void {
  if (!db) return;
  try {
    db.close();
  } finally {
    db = null;
  }
}

/**
 * Test-only: drop the shared handle without closing it. Used by unit
 * tests that want to simulate a fresh process without tearing down an
 * in-memory database they still want to inspect via a separate handle.
 */
export function _resetDbForTests(): void {
  db = null;
}

/**
 * Append a row to audit_log — fire-and-forget, never throws.
 * Silently no-ops if the audit_log table doesn't exist (e.g. fresh dev DB).
 */
export function logAudit(params: {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string;
  data?: Record<string, unknown>;
}): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, data_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nanoid(16),
        params.entityType,
        params.entityId,
        params.action,
        params.actorId ?? null,
        params.data ? JSON.stringify(params.data) : null,
      );
  } catch {
    // Never let audit failures crash the caller
  }
}
