/**
 * Integration tests for MongoLedgerStore.
 *
 * Layer: INTEGRATION
 * - Real MongoMemoryReplSet — validates actual Mongo queries and aggregations.
 * - Tests the six LedgerStore methods directly, including validity interval
 *   boundary conditions that the rest of the ledger system depends on.
 * - No DataManager, no LedgerManager — MongoLedgerStore is the subject.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import * as mongoDB from 'mongodb';
import sinon from 'sinon';

import { waitForMongoReady, silenceLogger } from '../../testing';
import { MongoLedgerStore } from '../store';
import type { LedgerEntry } from '../types';

jest.setTimeout(120_000);

const T0 = new Date('2024-01-01T00:00:00.000Z');
const T1 = new Date('2024-01-01T00:01:00.000Z');
const T2 = new Date('2024-01-01T00:02:00.000Z');
const T3 = new Date('2024-01-01T00:03:00.000Z');

const makeEntry = (
  overrides: Partial<LedgerEntry> & Pick<LedgerEntry, 'entity' | 'recordId'>,
): LedgerEntry => ({
  validFrom: T0,
  validTo: null,
  operation: 'ADD',
  snapshot: { id: overrides.recordId },
  diff: { added: {}, changed: {}, removed: {} },
  commitId: `commit-${overrides.recordId}`,
  committedAt: overrides.validFrom ?? T0,
  ...overrides,
});

describe('MongoLedgerStore integration tests', () => {
  let repl: MongoMemoryReplSet;
  let client: mongoDB.MongoClient;
  let db: mongoDB.Db;
  let ledgerStore: MongoLedgerStore;
  let sb: sinon.SinonSandbox;
  let silenceLogs: { restore: () => void };

  beforeAll(async () => {
    silenceLogs = silenceLogger();
    sb = sinon.createSandbox();

    repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = repl.getUri();
    await waitForMongoReady(uri);

    client = new mongoDB.MongoClient(uri);
    await client.connect();
    db = client.db('ledger-integration');

    ledgerStore = new MongoLedgerStore(db);
    await ledgerStore.ensureStore();
  });

  afterAll(async () => {
    try { await client.close(); } catch {}
    try { await repl.stop(); } catch {}
    try { sb.restore(); } catch {}
    silenceLogs.restore();
  });

  beforeEach(async () => {
    await db.collection('ledger_history').deleteMany({});
  });

  describe('ensureStore', () => {
    it('creates the ledger_history collection', async () => {
      const collections = await db.listCollections({ name: 'ledger_history' }).toArray();
      expect(collections).toHaveLength(1);
    });

    it('creates the required indexes', async () => {
      const indexes = await db.collection('ledger_history').listIndexes().toArray();
      const names = indexes.map((i) => i.name);
      expect(names).toContain('ledger_entity_record_validFrom');
      expect(names).toContain('ledger_entity_validFrom_validTo');
    });

    it('is idempotent — calling twice does not throw', async () => {
      await expect(ledgerStore.ensureStore()).resolves.not.toThrow();
    });
  });

  describe('append', () => {
    it('persists an entry to ledger_history', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1' }));

      const count = await db.collection('ledger_history').countDocuments();
      expect(count).toBe(1);
    });

    it('does not store _id on the entry shape returned by queries', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1' }));

      const result = await ledgerStore.findOpenVersion('users', 'u1');
      expect(result).not.toBeNull();
      expect((result as any)._id).toBeUndefined();
    });

    it('stores multiple entries independently', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1' }));
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u2' }));

      const count = await db.collection('ledger_history').countDocuments();
      expect(count).toBe(2);
    });
  });

  describe('closeOpenVersions', () => {
    it('sets validTo on the open entry for the given record', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0 }));
      await ledgerStore.closeOpenVersions('users', 'u1', T1);

      const result = await ledgerStore.findOpenVersion('users', 'u1');
      expect(result).toBeNull();
    });

    it('does not close entries for other records', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0 }));
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u2', validFrom: T0 }));

      await ledgerStore.closeOpenVersions('users', 'u1', T1);

      const u2 = await ledgerStore.findOpenVersion('users', 'u2');
      expect(u2).not.toBeNull();
      expect(u2?.validTo).toBeNull();
    });

    it('does not close entries for other entities', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users',    recordId: 'u1', validFrom: T0 }));
      await ledgerStore.append(makeEntry({ entity: 'profiles', recordId: 'u1', validFrom: T0 }));

      await ledgerStore.closeOpenVersions('users', 'u1', T1);

      const profile = await ledgerStore.findOpenVersion('profiles', 'u1');
      expect(profile).not.toBeNull();
    });

    it('is a no-op when no open entry exists', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: T1 }),
      );

      await expect(
        ledgerStore.closeOpenVersions('users', 'u1', T2),
      ).resolves.not.toThrow();
    });
  });

  describe('findOpenVersion', () => {
    it('returns the open entry for a record', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0 }));

      const result = await ledgerStore.findOpenVersion('users', 'u1');

      expect(result).not.toBeNull();
      expect(result?.recordId).toBe('u1');
      expect(result?.validTo).toBeNull();
    });

    it('returns null when no open entry exists', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: T1 }),
      );

      const result = await ledgerStore.findOpenVersion('users', 'u1');
      expect(result).toBeNull();
    });

    it('returns null for an unknown record', async () => {
      const result = await ledgerStore.findOpenVersion('users', 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns the most recent open entry when multiple exist', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, snapshot: { v: 1 } }),
      );
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T1, snapshot: { v: 2 } }),
      );

      const result = await ledgerStore.findOpenVersion('users', 'u1');
      expect(result?.snapshot).toMatchObject({ v: 2 });
    });
  });

  describe('findVersionAsOf', () => {
    it('returns the entry whose interval contains asOf', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: null }),
      );

      const result = await ledgerStore.findVersionAsOf('users', 'u1', T1);
      expect(result).not.toBeNull();
      expect(result?.recordId).toBe('u1');
    });

    it('returns null when asOf is before validFrom', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T1, validTo: null }),
      );

      const result = await ledgerStore.findVersionAsOf('users', 'u1', T0);
      expect(result).toBeNull();
    });

    it('returns null when asOf is exactly at validTo (exclusive upper bound)', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: T1 }),
      );

      const result = await ledgerStore.findVersionAsOf('users', 'u1', T1);
      expect(result).toBeNull();
    });

    it('returns the entry when asOf is exactly at validFrom (inclusive lower bound)', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: T2 }),
      );

      const result = await ledgerStore.findVersionAsOf('users', 'u1', T0);
      expect(result).not.toBeNull();
    });

    it('returns the correct version across multiple versions', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: T1, snapshot: { v: 1 } }),
      );
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T1, validTo: null, snapshot: { v: 2 } }),
      );

      const atT0 = await ledgerStore.findVersionAsOf('users', 'u1', T0);
      const atT2 = await ledgerStore.findVersionAsOf('users', 'u1', T2);

      expect(atT0?.snapshot).toMatchObject({ v: 1 });
      expect(atT2?.snapshot).toMatchObject({ v: 2 });
    });

    it('returns null for an unknown record', async () => {
      const result = await ledgerStore.findVersionAsOf('users', 'nonexistent', T0);
      expect(result).toBeNull();
    });
  });

  describe('findAllVersionsAsOf', () => {
    it('returns all records live at asOf', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0 }));
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u2', validFrom: T0 }));

      const results = await ledgerStore.findAllVersionsAsOf('users', T1);
      expect(results).toHaveLength(2);
    });

    it('returns at most one entry per recordId', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: T1 }),
      );
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T1, validTo: null }),
      );

      const results = await ledgerStore.findAllVersionsAsOf('users', T2);
      expect(results).toHaveLength(1);
    });

    it('excludes records not yet created at asOf', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T2 }));

      const results = await ledgerStore.findAllVersionsAsOf('users', T0);
      expect(results).toHaveLength(0);
    });

    it('includes DELETE tombstones — filtering is the callers responsibility', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, operation: 'DELETE' }),
      );

      const results = await ledgerStore.findAllVersionsAsOf('users', T1);
      expect(results).toHaveLength(1);
      expect(results[0].operation).toBe('DELETE');
    });

    it('only returns entries for the requested entity', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users',    recordId: 'u1', validFrom: T0 }));
      await ledgerStore.append(makeEntry({ entity: 'profiles', recordId: 'p1', validFrom: T0 }));

      const results = await ledgerStore.findAllVersionsAsOf('users', T1);
      expect(results).toHaveLength(1);
      expect(results[0].entity).toBe('users');
    });
  });

  describe('listEntities', () => {
    it('returns all distinct entity names', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users',    recordId: 'u1' }));
      await ledgerStore.append(makeEntry({ entity: 'profiles', recordId: 'p1' }));
      await ledgerStore.append(makeEntry({ entity: 'users',    recordId: 'u2' }));

      const entities = await ledgerStore.listEntities();
      expect(entities).toHaveLength(2);
      expect(entities).toContain('users');
      expect(entities).toContain('profiles');
    });

    it('returns empty array when no entries exist', async () => {
      const entities = await ledgerStore.listEntities();
      expect(entities).toHaveLength(0);
    });
  });
});
