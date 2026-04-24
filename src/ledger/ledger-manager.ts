import { createLogger } from '../logger';
import { makeImplicitCommit } from './commit';
import { diffForAdd, diffForUpdate, diffForDelete, emptyDiff } from './diff';
import type { LedgerStore } from './store/interface';
import type {
  DatabaseSnapshot,
  LedgerEntry,
  LedgerWriteEvent,
  LedgerWriteHook,
} from './types';

const Log = createLogger({ context: { package: '@just-in/core', source: 'ledger-manager' } });

/**
 * Receives write events from DataManager and persists immutable
 * {@link LedgerEntry} records to the injected {@link LedgerStore}.
 *
 * Register the hook once at application startup. Every write that passes
 * through DataManager — from any manager — is then captured automatically:
 *
 * ```ts
 * const ledgerStore = new MongoLedgerStore(db);
 * const ledger      = new LedgerManager(ledgerStore);
 *
 * DataManager.getInstance().registerLedgerHook(ledger.asWriteHook());
 * ```
 *
 * **ADD** — look up open entry (none expected), compute all-added diff,
 * append new entry with `validTo = null`.
 *
 * **UPDATE** — look up open entry, use its snapshot as the diff base,
 * close it, append new entry with updated snapshot and `validTo = null`.
 *
 * **DELETE** — look up open entry, source snapshot from it (no DB fetch),
 * close it, append DELETE tombstone.
 *
 * The store is injected via {@link LedgerStore}. Swap implementations without
 * changing this class.
 */
class LedgerManager {
  private store: LedgerStore;

  /**
   * @param store - The {@link LedgerStore} that persists audit history.
   *   Use `MongoLedgerStore` in production; use `InMemoryLedgerStore` from
   *   the testing package in tests.
   */
  constructor(store: LedgerStore) {
    this.store = store;
  }

  /**
   * Returns a {@link LedgerWriteHook} for passing to
   * `DataManager.registerLedgerHook()`.
   *
   * The returned hook never throws — any failure is logged and swallowed so
   * that business operations are never blocked by audit failures.
   */
  asWriteHook(): LedgerWriteHook {
    return async (event: LedgerWriteEvent): Promise<void> => {
      try {
        await this._handleWriteEvent(event);
      } catch (err) {
        Log.error('ledger: write hook failed — audit entry may be missing', {
          entity: event.entity,
          recordId: event.recordId,
          operation: event.operation,
          err,
        });
      }
    };
  }

  /**
   * Core write-event handler.
   *
   * Separated from the hook wrapper so it can be called directly in tests
   * without the error-swallowing try/catch.
   *
   * @internal
   */
  async _handleWriteEvent(event: LedgerWriteEvent): Promise<void> {
    const { entity, recordId, operation, snapshot, commit } = event;

    const openEntry = await this.store.findOpenVersion(entity, recordId);
    const prevSnapshot = openEntry?.snapshot;

    let diff = emptyDiff();

    if (operation === 'ADD') {
      diff = snapshot ? diffForAdd(snapshot) : emptyDiff();
    } else if (operation === 'UPDATE') {
      diff = diffForUpdate(prevSnapshot ?? {}, snapshot ?? {});
    } else if (operation === 'DELETE') {
      diff = prevSnapshot ? diffForDelete(prevSnapshot) : emptyDiff();
    }

    if (openEntry) {
      await this.store.closeOpenVersions(entity, recordId, commit.committedAt);
    }

    // For DELETE the event carries no snapshot — the tombstone snapshot is
    // sourced from the open ledger entry so no extra DB round-trip is needed.
    const entrySnapshot = operation === 'DELETE' ? prevSnapshot : snapshot;

    const entry: LedgerEntry = {
      entity,
      recordId,
      validFrom: commit.committedAt,
      validTo: null,
      operation,
      ...(entrySnapshot !== undefined ? { snapshot: entrySnapshot } : {}),
      diff,
      commitId: commit.commitId,
      committedAt: commit.committedAt,
      ...(commit.metadata !== undefined ? { metadata: commit.metadata } : {}),
    };

    await this.store.append(entry);
  }

  /**
   * Returns the snapshot of a single record as it existed at `asOf`.
   *
   * Queries the **ledger store only** — the current database is never touched.
   *
   * Returns `null` if the record did not exist at `asOf`, or if the version
   * active at `asOf` was a DELETE tombstone.
   *
   * @param entity   - Collection name.
   * @param recordId - ID of the record to look up.
   * @param asOf     - Point in time to reconstruct.
   */
  async getRecordAsOf(
    entity: string,
    recordId: string,
    asOf: Date,
  ): Promise<Record<string, unknown> | null> {
    const entry = await this.store.findVersionAsOf(entity, recordId, asOf);
    if (!entry || entry.operation === 'DELETE') return null;
    return entry.snapshot ?? null;
  }

  /**
   * Returns all records in `entity` matching `filterFn` at `asOf`.
   *
   * Queries the **ledger store only**.
   *
   * Pass `() => true` to retrieve all live records at `asOf`.
   *
   * @param entity   - Collection name.
   * @param filterFn - Predicate applied to each record snapshot.
   * @param asOf     - Point in time to reconstruct.
   */
  async queryAsOf(
    entity: string,
    filterFn: (snapshot: Record<string, unknown>) => boolean,
    asOf: Date,
  ): Promise<Array<Record<string, unknown>>> {
    const entries = await this.store.findAllVersionsAsOf(entity, asOf);
    return entries
      .filter((e) => e.operation !== 'DELETE' && e.snapshot !== undefined)
      .map((e) => e.snapshot as Record<string, unknown>)
      .filter(filterFn);
  }

  /**
   * Reconstructs the full database state at `asOf`.
   *
   * Queries the **ledger store only**. Iterates every entity ever written,
   * calls {@link queryAsOf} for each, and returns a map of entity → snapshots.
   *
   * Entities with no live records at `asOf` are included as empty arrays.
   *
   * @param asOf - Point in time to reconstruct.
   */
  async getDatabaseAsOf(asOf: Date): Promise<DatabaseSnapshot> {
    const entities = await this.store.listEntities();
    const result: DatabaseSnapshot = {};
    for (const entity of entities) {
      result[entity] = await this.queryAsOf(entity, () => true, asOf);
    }
    return result;
  }
}

export { LedgerManager, makeImplicitCommit };
