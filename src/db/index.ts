// Barrel re-export — all DB functions and types from domain modules.
// Import paths for all consumers remain `../db/index` or `../../db/index` unchanged.
export * from './connection';
export * from './keys';
export * from './credits';
export * from './skills';
export * from './marketplace';
export * from './escrow';
export * from './governance';
export * from './services';
export * from './audit';
export * from './admin';
export * from './contexts';
export * from './transfers';
export * from './sessions';
export * from './validations';
export * from './intel';
export * from './manifest';
export * from './attestations';
export * from './budget';
export * from './sponsorship';
export * from './bounties';
export * from './skill-extensions';
export * from './reseller';
export * from './identities';
// AID DB module removed — Soma replaced AID. Tables remain in DB via migrations.
export * from './agent-memory';
export * from './social-graph';
export * from './soma-verdicts';
export * from './providers';
export * from './promo-codes';
export * from './soma-check';
export * from './vouch';
export * from './signal';
export * from './delegated-keys';
