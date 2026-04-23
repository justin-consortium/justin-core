import type { LedgerEntry } from '../../ledger/types';
import type { LedgerStore } from '../../ledger/store';

/**
 * In-memory implementation of {@link LedgerStore} for use in tests.
 *
 * All data is held in a plain array and lost when the process exits.
 * This implementation prioritises correctness and readability over
 * performance — it performs linear scans rather than maintaining indexes.
 *
 * **Do not use in production.** The production store is `MongoLedgerStore`.
 *
 * @example
 * ```ts
 * import { InMemoryLedgerStore } from '../../testing';
 *
 * const ledgerStore = new InMemoryLedgerStore();
 * const ledger      = new LedgerManager(ledgerStore);
 * ```
 */
class InMemoryLedgerStore implements LedgerStore {
  private _entries: LedgerEntry[] = [];

  /**
   * Exposes the raw entry array for test assertions only.
   * Do not mutate from outside the store.
   * @internal
   */
  get _all(): ReadonlyArray<LedgerEntry> {
    return this._entries;
  }

  async append(entry: LedgerEntry): Promise<void> {
    this._entries.push({ ...entry });
  }

  async closeOpenVersions(entity: string, recordId: string, closedAt: Date): Promise<void> {
    for (const entry of this._entries) {
      if (entry.entity === entity && entry.recordId === recordId && entry.validTo === null) {
        entry.validTo = closedAt;
      }
    }
  }

  async findOpenVersion(entity: string, recordId: string): Promise<LedgerEntry | null> {
    for (let i = this._entries.length - 1; i >= 0; i--) {
      const e = this._entries[i];
      if (e.entity === entity && e.recordId === recordId && e.validTo === null) {
        return e;
      }
    }
    return null;
  }

  async findVersionAsOf(entity: string, recordId: string, asOf: Date): Promise<LedgerEntry | null> {
    const asOfMs = asOf.getTime();
    const candidates = this._entries.filter(
      (e) =>
        e.entity === entity &&
        e.recordId === recordId &&
        e.validFrom.getTime() <= asOfMs &&
        (e.validTo === null || e.validTo.getTime() > asOfMs),
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((best, e) =>
      e.validFrom.getTime() > best.validFrom.getTime() ? e : best,
    );
  }

  async findAllVersionsAsOf(entity: string, asOf: Date): Promise<LedgerEntry[]> {
    const asOfMs = asOf.getTime();
    const matching = this._entries.filter(
      (e) =>
        e.entity === entity &&
        e.validFrom.getTime() <= asOfMs &&
        (e.validTo === null || e.validTo.getTime() > asOfMs),
    );
    const byId = new Map<string, LedgerEntry>();
    for (const entry of matching) {
      const existing = byId.get(entry.recordId);
      if (!existing || entry.validFrom.getTime() > existing.validFrom.getTime()) {
        byId.set(entry.recordId, entry);
      }
    }
    return Array.from(byId.values());
  }

  async listEntities(): Promise<string[]> {
    return [...new Set(this._entries.map((e) => e.entity))];
  }

  /**
   * Removes all entries from the store.
   * Call in `beforeEach` / `afterEach` to isolate tests.
   */
  clear(): void {
    this._entries = [];
  }
}

export { InMemoryLedgerStore };
