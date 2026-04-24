/**
 * @module ledger
 *
 * Append-only audit store that enables point-in-time reconstruction of any
 * collection or the entire database.
 *
 * See `LEDGER.md` in this directory for a plain-language explanation.
 *
 * ### Quick start
 *
 * ```ts
 * import { LedgerManager } from './ledger';
 * import { MongoLedgerStore } from './ledger/mongo/store';
 *
 * const ledgerStore = new MongoLedgerStore(db);
 * const ledger      = new LedgerManager(ledgerStore);
 *
 * DataManager.getInstance().registerLedgerHook(ledger.asWriteHook());
 * ```
 */

export { LedgerManager } from './ledger-manager';

export type { LedgerStore } from './store';
export { MongoLedgerStore } from './store';

export { beginLedgerCommit } from './commit';

export { deepDiff, diffForAdd, diffForUpdate, diffForDelete, emptyDiff } from './diff';

export type {
  LedgerEntry,
  LedgerDiff,
  LedgerOperation,
  LedgerCommitContext,
  LedgerWriteEvent,
  LedgerWriteHook,
  DatabaseSnapshot,
} from './types';
