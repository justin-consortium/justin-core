import type { LedgerEntry } from './types';

/**
 * Storage contract for the ledger's audit history.
 *
 * `LedgerStore` is database-agnostic — implementations own persistence and
 * the ledger logic never references a specific database driver. This mirrors
 * the `DataManagerAdapter` pattern already used in the rest of the codebase.
 *
 * The production implementation is `MongoLedgerStore`
 * (`src/ledger/mongo/store.ts`), which writes to the single shared
 * `ledger_history` collection in MongoDB.
 *
 * For tests, use `InMemoryLedgerStore` from `src/testing/testkit`.
 *
 * Recommended indexes (implementor responsibility):
 * - `(entity, recordId, validFrom)` — single-record history lookup
 * - `(entity, validFrom, validTo)`  — collection-level as-of queries
 */
interface LedgerStore {
  /**
   * Inserts a new entry into the ledger history.
   * The store must not mutate the provided object.
   *
   * @param entry - The entry to append.
   */
  append(entry: LedgerEntry): Promise<void>;

  /**
   * Closes all open versions (`validTo === null`) for the given record by
   * setting their `validTo` to `closedAt`.
   *
   * @param entity   - Collection name.
   * @param recordId - ID of the record whose open versions should be closed.
   * @param closedAt - The timestamp to assign as `validTo`.
   */
  closeOpenVersions(entity: string, recordId: string, closedAt: Date): Promise<void>;

  /**
   * Returns the most recent open entry (`validTo === null`) for a record.
   *
   * Used by {@link LedgerManager} to source the pre-image for UPDATE diffs
   * and DELETE tombstones — no DB round-trip to the main collections required.
   *
   * Returns `null` if no open version exists.
   *
   * @param entity   - Collection name.
   * @param recordId - ID of the record.
   */
  findOpenVersion(entity: string, recordId: string): Promise<LedgerEntry | null>;

  /**
   * Returns the single entry valid at `asOf` for the specified record.
   *
   * A version is valid when:
   * ```
   * validFrom <= asOf  AND  (validTo IS NULL OR validTo > asOf)
   * ```
   *
   * Returns `null` if the record did not exist at `asOf`.
   *
   * @param entity   - Collection name.
   * @param recordId - ID of the record to look up.
   * @param asOf     - Point in time to query.
   */
  findVersionAsOf(entity: string, recordId: string, asOf: Date): Promise<LedgerEntry | null>;

  /**
   * Returns all entries valid at `asOf` across the given entity, with at most
   * one entry per `recordId` (the one with the greatest `validFrom <= asOf`).
   *
   * Entries whose `operation === 'DELETE'` are included; {@link LedgerManager}
   * filters them when reconstructing live state.
   *
   * @param entity - Collection name.
   * @param asOf   - Point in time to query.
   */
  findAllVersionsAsOf(entity: string, asOf: Date): Promise<LedgerEntry[]>;

  /**
   * Returns all distinct entity names that have at least one entry in the store.
   *
   * Used by {@link LedgerManager.getDatabaseAsOf} to enumerate all entities
   * without requiring the caller to maintain a registry.
   */
  listEntities(): Promise<string[]>;
}

export type { LedgerStore };
