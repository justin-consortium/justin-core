import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import sinon from 'sinon';

import { configureDB, clearPendingConfig, DataManager } from '../data-manager';
import { DBType } from '../constants';
import { MongoDBManager } from '../mongo/mongo-data-manager';
import {
  waitForMongoReady,
  silenceLogger,
  expectOk,
  expectFailed,
  expectFailedWithCode,
} from '../../testing';
import { JustinErrorCode } from '../../errors';

jest.setTimeout(120_000);

// A valid ObjectId format that does not exist in the DB
const nonExistentId = () => new ObjectId().toHexString();

describe('DataManager integration tests', () => {
  let repl: MongoMemoryReplSet;
  let dm: DataManager;
  let sb: sinon.SinonSandbox;
  let silenceLogs: { restore: () => void };

  beforeAll(async () => {
    silenceLogs = silenceLogger();
    sb = sinon.createSandbox();

    repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = repl.getUri();
    await waitForMongoReady(uri);

    const realInit = MongoDBManager.init.bind(MongoDBManager);
    sb.stub(MongoDBManager, 'init').callsFake(() => realInit(uri, 'data-manager-integration'));

    configureDB({ dbType: DBType.MONGO, uri });
    dm = DataManager.getInstance();
    await dm.init();
  });

  afterAll(async () => {
    try {
      await dm.close();
    } catch {}
    try {
      await repl.stop();
    } catch {}
    try {
      sb.restore();
    } catch {}
    clearPendingConfig();
    silenceLogs.restore();
  });

  beforeEach(async () => {
    await dm.clearCollection('items');
  });

  describe('init', () => {
    it('getInitializationStatus is true after init', () => {
      expect(dm.getInitializationStatus()).toBe(true);
    });

    it('calling init again is a no-op', async () => {
      await dm.init();
      expect(dm.getInitializationStatus()).toBe(true);
    });
  });

  describe('ensureStore', () => {
    it('is idempotent', async () => {
      await expect(dm.ensureStore('items')).resolves.not.toThrow();
      await expect(dm.ensureStore('items')).resolves.not.toThrow();
    });

    it('creates a new collection that can be written to immediately', async () => {
      await dm.ensureStore('new_col');
      expectOk(await dm.addItemToCollection('new_col', { x: 1 }));
      await dm.clearCollection('new_col');
    });
  });

  describe('ensureIndexes', () => {
    // Use a separate collection so index definitions don't leak into other tests
    const IDX_COL = 'indexed_items';

    beforeEach(async () => {
      // Insert and remove a seed document to fully materialise the collection before
      // calling listIndexes — MongoMemoryReplSet can fail listIndexes on a brand-new
      // collection that has not yet had any writes.
      await dm.ensureStore(IDX_COL);
      const seed = await dm.addItemToCollection(IDX_COL, { _seed: true });
      if (seed.ok) await dm.removeItemFromCollection(IDX_COL, seed.successes[0].id);
    });

    afterEach(async () => {
      await dm.clearCollection(IDX_COL);
    });

    it('creates a unique index that rejects duplicates', async () => {
      await dm.ensureIndexes(IDX_COL, [{ name: 'uniq_code', key: { code: 1 }, unique: true }]);
      await dm.addItemToCollection(IDX_COL, { code: 'abc' });
      expectFailed(await dm.addItemToCollection(IDX_COL, { code: 'abc' }));
    });

    it('allows different values under a unique index', async () => {
      await dm.ensureIndexes(IDX_COL, [{ name: 'uniq_code', key: { code: 1 }, unique: true }]);
      expectOk(await dm.addItemToCollection(IDX_COL, { code: 'abc' }));
      expectOk(await dm.addItemToCollection(IDX_COL, { code: 'def' }));
    });

    it('is idempotent', async () => {
      const idx = [{ name: 'uniq_code', key: { code: 1 }, unique: true }];
      await expect(dm.ensureIndexes(IDX_COL, idx)).resolves.not.toThrow();
      await expect(dm.ensureIndexes(IDX_COL, idx)).resolves.not.toThrow();
    });
  });

  describe('addItemToCollection', () => {
    it('returns ok:true with the item including its generated id', async () => {
      const result = await dm.addItemToCollection('items', { name: 'Alice', score: 10 });
      const item = expectOk(result);
      expect(item.id).toEqual(expect.any(String));
      expect(item.id.length).toBeGreaterThan(0);
      expect((item as any).name).toBe('Alice');
    });

    it('never exposes _id — only the mapped id field', async () => {
      const item = expectOk(await dm.addItemToCollection('items', { name: 'Bob' }));
      expect((item as any)._id).toBeUndefined();
    });

    it('each item gets a unique id', async () => {
      const r1 = expectOk(await dm.addItemToCollection('items', { n: 1 }));
      const r2 = expectOk(await dm.addItemToCollection('items', { n: 2 }));
      expect(r1.id).not.toBe(r2.id);
    });

    it('returns ok:false when a unique index constraint is violated', async () => {
      const col = 'dup_test';
      await dm.ensureStore(col);
      const seed = await dm.addItemToCollection(col, { _seed: true });
      if (seed.ok) await dm.removeItemFromCollection(col, seed.successes[0].id);
      await dm.ensureIndexes(col, [{ name: 'uniq_code', key: { code: 1 }, unique: true }]);
      await dm.addItemToCollection(col, { code: 'dup' });
      expectFailed(await dm.addItemToCollection(col, { code: 'dup' }));
      await dm.clearCollection(col);
    });
  });

  describe('findItemByIdInCollection', () => {
    it('returns the item for a known id', async () => {
      const { id } = expectOk(await dm.addItemToCollection('items', { name: 'Alice' }));
      const found = await dm.findItemByIdInCollection<any>('items', id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
      expect(found!.id).toBe(id);
      expect(found!._id).toBeUndefined();
    });

    it('returns null for an unknown id', async () => {
      expect(await dm.findItemByIdInCollection('items', 'nonexistent')).toBeNull();
    });
  });

  describe('findItemsInCollection', () => {
    it('returns all items matching the criteria', async () => {
      await dm.addItemToCollection('items', { type: 'a', v: 1 });
      await dm.addItemToCollection('items', { type: 'a', v: 2 });
      await dm.addItemToCollection('items', { type: 'b', v: 3 });

      const results = await dm.findItemsInCollection<any>('items', { type: 'a' });
      expect(results).toHaveLength(2);
      expect(results.every((r: any) => r.type === 'a')).toBe(true);
    });

    it('returns empty array when no items match', async () => {
      await dm.addItemToCollection('items', { type: 'a' });
      expect(await dm.findItemsInCollection('items', { type: 'z' })).toHaveLength(0);
    });

    it('supports multiple criteria fields (AND semantics)', async () => {
      await dm.addItemToCollection('items', { type: 'a', status: 'active' });
      await dm.addItemToCollection('items', { type: 'a', status: 'inactive' });
      await dm.addItemToCollection('items', { type: 'b', status: 'active' });

      const results = await dm.findItemsInCollection<any>('items', { type: 'a', status: 'active' });
      expect(results).toHaveLength(1);
    });
  });

  describe('findItemsByIdsInCollection', () => {
    it('returns items for the given ids only', async () => {
      const r1 = expectOk(await dm.addItemToCollection('items', { n: 1 }));
      const r2 = expectOk(await dm.addItemToCollection('items', { n: 2 }));
      await dm.addItemToCollection('items', { n: 3 });

      const results = await dm.findItemsByIdsInCollection<any>('items', [r1.id, r2.id]);
      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.n).sort()).toEqual([1, 2]);
    });

    it('returns empty array for empty ids list', async () => {
      await dm.addItemToCollection('items', { n: 1 });
      expect(await dm.findItemsByIdsInCollection('items', [])).toHaveLength(0);
    });

    it('silently skips unknown ids', async () => {
      const r1 = expectOk(await dm.addItemToCollection('items', { n: 1 }));
      const results = await dm.findItemsByIdsInCollection('items', [r1.id, nonExistentId()]);
      expect(results).toHaveLength(1);
    });
  });

  describe('getAllInCollection', () => {
    it('returns all items', async () => {
      await dm.addItemToCollection('items', { n: 1 });
      await dm.addItemToCollection('items', { n: 2 });
      await dm.addItemToCollection('items', { n: 3 });
      expect(await dm.getAllInCollection('items')).toHaveLength(3);
    });

    it('returns empty array for empty collection', async () => {
      expect(await dm.getAllInCollection('items')).toHaveLength(0);
    });
  });

  describe('updateItemByIdInCollection', () => {
    it('updates fields and returns the full updated shape', async () => {
      const { id } = expectOk(
        await dm.addItemToCollection<any>('items', { name: 'Alice', score: 10 }),
      );
      const updated = expectOk(
        await dm.updateItemByIdInCollection('items', id, { score: 99 }),
      ) as any;
      expect(updated.score).toBe(99);
      expect(updated.name).toBe('Alice');
      expect(updated.id).toBe(id);
    });

    it('persists the update — subsequent find reflects the change', async () => {
      const { id } = expectOk(await dm.addItemToCollection<any>('items', { score: 1 }));
      await dm.updateItemByIdInCollection('items', id, { score: 42 });
      const found = await dm.findItemByIdInCollection<any>('items', id);
      expect(found!.score).toBe(42);
    });

    it('returns NOT_FOUND for an unknown id', async () => {
      expectFailedWithCode(
        await dm.updateItemByIdInCollection('items', nonExistentId(), { score: 1 }),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('failure entry carries the id for traceability', async () => {
      const ghostId = nonExistentId();
      const result = await dm.updateItemByIdInCollection('items', ghostId, { x: 1 });
      if (!result.ok) expect(result.failures[0].id).toBe(ghostId);
    });

    it('does not affect other items', async () => {
      const r1 = expectOk(await dm.addItemToCollection<any>('items', { score: 1 }));
      const r2 = expectOk(await dm.addItemToCollection<any>('items', { score: 2 }));
      await dm.updateItemByIdInCollection('items', r1.id, { score: 99 });
      const found2 = await dm.findItemByIdInCollection<any>('items', r2.id);
      expect(found2!.score).toBe(2);
    });
  });

  describe('removeItemFromCollection', () => {
    it('removes the item and subsequent find returns null', async () => {
      const { id } = expectOk(await dm.addItemToCollection('items', { name: 'Alice' }));
      expectOk(await dm.removeItemFromCollection('items', id));
      expect(await dm.findItemByIdInCollection('items', id)).toBeNull();
    });

    it('returns NOT_FOUND for an unknown id', async () => {
      expectFailedWithCode(
        await dm.removeItemFromCollection('items', nonExistentId()),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('does not affect other items', async () => {
      const r1 = expectOk(await dm.addItemToCollection('items', { n: 1 }));
      const r2 = expectOk(await dm.addItemToCollection('items', { n: 2 }));
      await dm.removeItemFromCollection('items', r1.id);
      expect(await dm.findItemByIdInCollection('items', r2.id)).not.toBeNull();
    });
  });

  describe('addItemsToCollection', () => {
    it('inserts all items and returns ok:true with each inserted item', async () => {
      const result = await dm.addItemsToCollection('items', [
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' },
      ]);
      expectOk(result);
      expect(result.successes).toHaveLength(3);
      expect(await dm.getAllInCollection('items')).toHaveLength(3);
    });

    it('all inserted items get unique ids', async () => {
      const result = await dm.addItemsToCollection('items', [{ n: 1 }, { n: 2 }, { n: 3 }]);
      const ids = result.successes.map((s: any) => s.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('returns ok:true with empty successes for empty input', async () => {
      const result = await dm.addItemsToCollection('items', []);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });

    it('returns ok:false when a unique index violation occurs in a bulk insert', async () => {
      // When bulkWrite throws a MongoBulkWriteError the current implementation calls
      // handleError rather than extracting the partial insertedIds from error.result.
      // This means all successes from that batch are lost and the whole operation is
      // reported as a single failure. This is a known limitation of the current
      // addItemsToCollection implementation.
      const col = 'bulk_dup_test';
      await dm.ensureStore(col);
      const seed = await dm.addItemToCollection(col, { _seed: true });
      if (seed.ok) await dm.removeItemFromCollection(col, seed.successes[0].id);
      await dm.ensureIndexes(col, [{ name: 'uniq_name', key: { name: 1 }, unique: true }]);
      await dm.addItemToCollection(col, { name: 'Alice' });

      const result = await dm.addItemsToCollection(col, [
        { name: 'Bob' },
        { name: 'Alice' }, // duplicate — causes MongoBulkWriteError
        { name: 'Charlie' },
      ]);

      expect(result.ok).toBe(false);
      await dm.clearCollection(col);
    });
  });

  describe('updateItemsByIdInCollection', () => {
    it('updates multiple items in one call', async () => {
      const r1 = expectOk(await dm.addItemToCollection<any>('items', { score: 1 }));
      const r2 = expectOk(await dm.addItemToCollection<any>('items', { score: 2 }));

      expectOk(
        await dm.updateItemsByIdInCollection('items', [
          { id: r1.id, update: { score: 10 } },
          { id: r2.id, update: { score: 20 } },
        ]),
      );

      const all = await dm.getAllInCollection<any>('items');
      expect(all.map((i: any) => i.score).sort((a: number, b: number) => a - b)).toEqual([10, 20]);
    });

    it('returns ok:true with empty successes for empty input', async () => {
      const result = await dm.updateItemsByIdInCollection('items', []);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });

    it('returns ok:true with empty successes when no ids match — bulk path does not report NOT_FOUND', async () => {
      // The Mongo bulk adapter uses bulkWrite which does not report unmatched documents
      // as errors — only actual write errors (constraint violations) appear in writeErrors.
      // This is different from the single-item updateItemByIdInCollection which returns NOT_FOUND.
      const result = await dm.updateItemsByIdInCollection('items', [
        { id: nonExistentId(), update: { x: 1 } },
      ]);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(1);
    });

    it('returns ok:true for all items even when some ids do not match', async () => {
      const r1 = expectOk(await dm.addItemToCollection<any>('items', { score: 1 }));
      const result = await dm.updateItemsByIdInCollection('items', [
        { id: r1.id, update: { score: 99 } },
        { id: nonExistentId(), update: { score: 0 } },
      ]);
      // Bulk path reports both as successes since bulkWrite does not surface unmatched docs
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(2);
    });
  });

  describe('removeItemsFromCollection', () => {
    it('removes multiple items in one call', async () => {
      const r1 = expectOk(await dm.addItemToCollection('items', { n: 1 }));
      const r2 = expectOk(await dm.addItemToCollection('items', { n: 2 }));
      await dm.addItemToCollection('items', { n: 3 });

      expectOk(await dm.removeItemsFromCollection('items', [r1.id, r2.id]));

      const all = await dm.getAllInCollection<any>('items');
      expect(all).toHaveLength(1);
      expect((all[0] as any).n).toBe(3);
    });

    it('returns ok:true with empty successes for empty input', async () => {
      const result = await dm.removeItemsFromCollection('items', []);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });

    it('returns ok:true even when ids do not match — bulk path does not report NOT_FOUND', async () => {
      // Same as updateItemsByIdInCollection — bulkWrite does not surface unmatched deletes.
      const result = await dm.removeItemsFromCollection('items', [nonExistentId()]);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(1);
    });

    it('removes valid ids and silently skips nonexistent ids', async () => {
      const r1 = expectOk(await dm.addItemToCollection('items', { n: 1 }));
      const result = await dm.removeItemsFromCollection('items', [r1.id, nonExistentId()]);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(2);
      expect(await dm.findItemByIdInCollection('items', r1.id)).toBeNull();
    });
  });

  describe('clearCollection / isCollectionEmpty', () => {
    it('isCollectionEmpty returns true for empty collection', async () => {
      expect(await dm.isCollectionEmpty('items')).toBe(true);
    });

    it('isCollectionEmpty returns false after items are inserted', async () => {
      await dm.addItemToCollection('items', { n: 1 });
      expect(await dm.isCollectionEmpty('items')).toBe(false);
    });

    it('clearCollection removes all items', async () => {
      await dm.addItemToCollection('items', { n: 1 });
      await dm.addItemToCollection('items', { n: 2 });
      expectOk(await dm.clearCollection('items'));
      expect(await dm.isCollectionEmpty('items')).toBe(true);
    });

    it('clearCollection is safe on an already-empty collection', async () => {
      await expect(dm.clearCollection('items')).resolves.not.toThrow();
    });
  });

  describe('cross-operation consistency', () => {
    it('add → find → update → find reflects changes at each step', async () => {
      const { id } = expectOk(
        await dm.addItemToCollection<any>('items', { score: 1, status: 'new' }),
      );

      const found1 = await dm.findItemByIdInCollection<any>('items', id);
      expect(found1!.score).toBe(1);

      await dm.updateItemByIdInCollection('items', id, { score: 2, status: 'updated' });

      const found2 = await dm.findItemByIdInCollection<any>('items', id);
      expect(found2!.score).toBe(2);
      expect(found2!.status).toBe('updated');
    });

    it('add → remove → find returns null', async () => {
      const { id } = expectOk(await dm.addItemToCollection('items', { n: 1 }));
      await dm.removeItemFromCollection('items', id);
      expect(await dm.findItemByIdInCollection('items', id)).toBeNull();
    });

    it('findItemsInCollection criteria matches updated fields', async () => {
      const { id } = expectOk(await dm.addItemToCollection<any>('items', { status: 'pending' }));
      await dm.addItemToCollection('items', { status: 'pending' });
      await dm.updateItemByIdInCollection('items', id, { status: 'complete' });

      expect(await dm.findItemsInCollection('items', { status: 'pending' })).toHaveLength(1);
      const complete = await dm.findItemsInCollection<any>('items', { status: 'complete' });
      expect(complete).toHaveLength(1);
      expect(complete[0].id).toBe(id);
    });

    it('bulk add → bulk update → getAllInCollection reflects all changes', async () => {
      const bulk = await dm.addItemsToCollection('items', [
        { score: 1 },
        { score: 2 },
        { score: 3 },
      ]);
      const ids = bulk.successes.map((s: any) => s.id);

      await dm.updateItemsByIdInCollection(
        'items',
        ids.map((id: string, i: number) => ({
          id,
          update: { score: (i + 1) * 10 },
        })),
      );

      const all = await dm.getAllInCollection<any>('items');
      expect(all.map((i: any) => i.score).sort((a: number, b: number) => a - b)).toEqual([
        10, 20, 30,
      ]);
    });
  });
});
