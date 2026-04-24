import * as mongoDB from 'mongodb';
import { createLogger } from '../../logger';
import type { LedgerEntry } from '../types';
import type { LedgerStore } from './interface';

const COLLECTION = 'ledger_history';

const Log = createLogger({ context: { package: '@just-in/core', source: 'mongo-ledger-store' } });

/**
 * Converts a raw MongoDB document into a {@link LedgerEntry}.
 *
 * Strips the Mongo `_id` field — ledger entries are identified by
 * `(entity, recordId, validFrom)` rather than by a DB-assigned key.
 *
 * @internal
 */
const _toEntry = (doc: mongoDB.WithId<mongoDB.Document>): LedgerEntry => {
  const { _id: _discarded, ...rest } = doc;
  return rest as unknown as LedgerEntry;
};

/**
 * MongoDB implementation of {@link LedgerStore}.
 *
 * All audit history is persisted to a single `ledger_history` collection.
 * Every collection in the system shares this one table, distinguished by the
 * `entity` field on each entry. See `LEDGER.md` for the design rationale.
 *
 * Call {@link ensureStore} once at application startup (after the Mongo
 * connection is established) to create the collection and its indexes.
 *
 * @example
 * ```ts
 * const ledgerStore = new MongoLedgerStore(db);
 * await ledgerStore.ensureStore();
 *
 * const ledger = new LedgerManager(ledgerStore);
 * DataManager.getInstance().registerLedgerHook(ledger.asWriteHook());
 * ```
 */
class MongoLedgerStore implements LedgerStore {
  private db: mongoDB.Db;

  /**
   * @param db - An initialised MongoDB `Db` instance. The same `Db` used by
   *   `MongoDBManager` should be passed here so both share one connection.
   */
  constructor(db: mongoDB.Db) {
    this.db = db;
  }

  private get coll(): mongoDB.Collection {
    return this.db.collection(COLLECTION);
  }

  /**
   * Creates the `ledger_history` collection and ensures both required indexes
   * exist. Safe to call multiple times — idempotent.
   *
   * Required indexes:
   * - `(entity, recordId, validFrom)` — single-record history lookup
   * - `(entity, validFrom, validTo)`  — collection-level as-of queries
   */
  async ensureStore(): Promise<void> {
    const exists = await this.db
      .listCollections({ name: COLLECTION }, { nameOnly: true })
      .hasNext();

    if (!exists) {
      try {
        await this.db.createCollection(COLLECTION);
        Log.debug(`ledger: created collection ${COLLECTION}`);
      } catch (err: any) {
        if (err?.codeName !== 'NamespaceExists') throw err;
      }
    }

    const coll = this.coll;
    const existing = await coll.listIndexes().toArray();
    const existingKeys = new Set(existing.map((i) => JSON.stringify(i.key)));

    const required: mongoDB.IndexDescription[] = [
      { key: { entity: 1, recordId: 1, validFrom: 1 } as const, name: 'ledger_entity_record_validFrom' },
      { key: { entity: 1, validFrom: 1, validTo: 1 } as const,  name: 'ledger_entity_validFrom_validTo' },
    ];

    for (const idx of required) {
      if (!existingKeys.has(JSON.stringify(idx.key))) {
        await coll.createIndex(idx.key, { name: idx.name });
        Log.debug(`ledger: created index ${idx.name}`);
      }
    }
  }

  async append(entry: LedgerEntry): Promise<void> {
    try {
      await this.coll.insertOne({ ...entry });
    } catch (err) {
      Log.error('ledger: append failed', { entity: entry.entity, recordId: entry.recordId, err });
      throw err;
    }
  }

  async closeOpenVersions(entity: string, recordId: string, closedAt: Date): Promise<void> {
    try {
      await this.coll.updateMany(
        { entity, recordId, validTo: null },
        { $set: { validTo: closedAt } },
      );
    } catch (err) {
      Log.error('ledger: closeOpenVersions failed', { entity, recordId, err });
      throw err;
    }
  }

  async findOpenVersion(entity: string, recordId: string): Promise<LedgerEntry | null> {
    try {
      const doc = await this.coll.findOne(
        { entity, recordId, validTo: null },
        { sort: { validFrom: -1 } },
      );
      return doc ? _toEntry(doc) : null;
    } catch (err) {
      Log.error('ledger: findOpenVersion failed', { entity, recordId, err });
      throw err;
    }
  }

  async findVersionAsOf(
    entity: string,
    recordId: string,
    asOf: Date,
  ): Promise<LedgerEntry | null> {
    try {
      const doc = await this.coll.findOne(
        {
          entity,
          recordId,
          validFrom: { $lte: asOf },
          $or: [{ validTo: null }, { validTo: { $gt: asOf } }],
        },
        { sort: { validFrom: -1 } },
      );
      return doc ? _toEntry(doc) : null;
    } catch (err) {
      Log.error('ledger: findVersionAsOf failed', { entity, recordId, asOf, err });
      throw err;
    }
  }

  async findAllVersionsAsOf(entity: string, asOf: Date): Promise<LedgerEntry[]> {
    try {
      const docs = await this.coll
        .aggregate([
          {
            $match: {
              entity,
              validFrom: { $lte: asOf },
              $or: [{ validTo: null }, { validTo: { $gt: asOf } }],
            },
          },
          { $sort: { validFrom: -1 } },
          {
            $group: {
              _id: '$recordId',
              doc: { $first: '$$ROOT' },
            },
          },
          { $replaceRoot: { newRoot: '$doc' } },
        ])
        .toArray();

      return docs.map((d) => _toEntry(d as mongoDB.WithId<mongoDB.Document>));
    } catch (err) {
      Log.error('ledger: findAllVersionsAsOf failed', { entity, asOf, err });
      throw err;
    }
  }

  async listEntities(): Promise<string[]> {
    try {
      return await this.coll.distinct('entity');
    } catch (err) {
      Log.error('ledger: listEntities failed', { err });
      throw err;
    }
  }
}

export { MongoLedgerStore };
