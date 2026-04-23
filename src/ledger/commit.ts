import type { LedgerCommitContext } from './types';

/**
 * Generates a sortable, URL-safe unique identifier without external dependencies.
 *
 * Format: `<13-char ms timestamp in base-36><10-char random suffix>`.
 * Lexicographic sort order matches chronological order, and the random suffix
 * provides collision resistance for typical write volumes.
 *
 * A full ULID library (`ulid`, `ulidx`) can be substituted here without
 * changing anything else in the ledger system.
 *
 * @internal
 */
const _generateCommitId = (): string => {
  const ts = Date.now().toString(36).padStart(13, '0');
  const rand = Math.random().toString(36).slice(2).padStart(10, '0').slice(0, 10);
  return `${ts}${rand}`;
};

/**
 * Creates a new {@link LedgerCommitContext} for grouping multiple write
 * operations under a single logical commit.
 *
 * All DataManager writes that carry this context will share the same
 * `commitId` and `committedAt`, enabling atomic reconstruction of a
 * multi-record change at a specific point in time.
 *
 * If no commit context is provided to a DataManager write, each operation
 * creates its own implicit single-operation commit automatically — every
 * ledger entry always has a `commitId` and `committedAt`.
 *
 * @param metadata - Optional metadata attached to every entry in this commit,
 *   e.g. `{ initiatedBy: 'migration-script' }`.
 *
 * @example
 * ```ts
 * const ctx = beginLedgerCommit({ initiatedBy: 'onboarding-flow' });
 *
 * await dm.addItemToCollection('users',    newUser,    ctx);
 * await dm.addItemToCollection('profiles', newProfile, ctx);
 * // Both ledger entries share ctx.commitId and ctx.committedAt.
 * ```
 */
const beginLedgerCommit = (metadata?: LedgerCommitContext['metadata']): LedgerCommitContext => ({
  commitId: _generateCommitId(),
  committedAt: new Date(),
  ...(metadata !== undefined ? { metadata } : {}),
});

/**
 * Creates an implicit single-operation commit context.
 *
 * Used internally by {@link LedgerManager} when the caller does not supply a
 * {@link LedgerCommitContext}. Ensures every ledger entry always carries a
 * `commitId` and `committedAt` regardless of how the write was initiated.
 *
 * @internal
 */
const makeImplicitCommit = (metadata?: LedgerCommitContext['metadata']): LedgerCommitContext =>
  beginLedgerCommit(metadata);

export { beginLedgerCommit, makeImplicitCommit };
