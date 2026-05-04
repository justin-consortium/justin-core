/**
 * E2E tests for the Ledger system.
 *
 * Layer: E2E
 * - Real MongoMemoryReplSet and real DataManager — the full write pipeline.
 * - The ledger hook is registered once at startup, exactly as production.
 * - InMemoryLedgerStore is used to keep the ledger store isolated from the
 *   Mongo connection — the e2e coverage here is the write → hook pipeline.
 *   mongo-store.integration.test.ts covers MongoLedgerStore directly.
 * - All assertions use only the public LedgerManager API (getRecordAsOf,
 *   queryAsOf, getDatabaseAsOf) — store internals are never accessed.
 * - DataManager is used directly here because LedgerManager has no public
 *   manager of its own yet; it is infrastructure-level, not a manager. When
 *   a higher-level API exists these tests should be updated to use it.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import sinon from 'sinon';

import { configureDB } from '../../lifecycle';
import { DataManager, DBType } from '../../data-manager';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import { waitForMongoReady, silenceLogger, expectOk } from '../../testing';
import { InMemoryLedgerStore } from '../../testing/testkit/ledger.store.mock';

import { LedgerManager } from '../ledger-manager';
import { beginLedgerCommit } from '../commit';

jest.setTimeout(120_000);

describe('ledger.manager e2e', () => {
  let repl: MongoMemoryReplSet;
  let dm: DataManager;
  let sb: sinon.SinonSandbox;
  let silenceLogs: { restore: () => void };

  let ledgerStore: InMemoryLedgerStore;
  let ledger: LedgerManager;

  const ENTITY = 'ledger_e2e_items';

  beforeAll(async () => {
    silenceLogs = silenceLogger();
    sb = sinon.createSandbox();

    repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = repl.getUri();
    await waitForMongoReady(uri);

    const realInit = MongoDBManager.init.bind(MongoDBManager);
    sb.stub(MongoDBManager, 'init').callsFake(() => realInit(uri, 'ledger-e2e'));

    configureDB({ dbType: DBType.MONGO, uri });
    dm = DataManager.getInstance();
    await dm.init();
    await dm.ensureStore(ENTITY);

    ledgerStore = new InMemoryLedgerStore();
    ledger = new LedgerManager(ledgerStore);
    dm.registerLedgerHook(ledger.asWriteHook());
  });

  afterAll(async () => {
    try { await dm.close(); } catch {}
    try { await repl.stop(); } catch {}
    try { sb.restore(); } catch {}
    silenceLogs.restore();
  });

  beforeEach(async () => {
    ledgerStore.clear();
    await dm.clearCollection(ENTITY);
  });

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  describe('ADD — write capture', () => {
    it('captures the record in the ledger after addItemToCollection', async () => {
      const result = await dm.addItemToCollection(ENTITY, { name: 'Alice' });
      expectOk(result);

      const id = result.successes[0].id;
      const snap = await ledger.getRecordAsOf(ENTITY, id, new Date());

      expect(snap).not.toBeNull();
      expect(snap).toMatchObject({ name: 'Alice' });
    });

    it('captures multiple independent adds as separate entries', async () => {
      await dm.addItemToCollection(ENTITY, { name: 'Alice' });
      await dm.addItemToCollection(ENTITY, { name: 'Bob' });

      const results = await ledger.queryAsOf(ENTITY, new Date());
      expect(results).toHaveLength(2);
    });
  });

  describe('UPDATE — write capture', () => {
    it('captures the updated snapshot and closes the previous version', async () => {
      const addResult = await dm.addItemToCollection(ENTITY, { name: 'Alice' });
      const id = addResult.successes[0].id;
      const afterAdd = new Date();

      await sleep(2);

      await dm.updateItemByIdInCollection(ENTITY, id, { name: 'Alicia' });
      const afterUpdate = new Date();

      const snapAtAdd       = await ledger.getRecordAsOf(ENTITY, id, afterAdd);
      const snapAfterUpdate = await ledger.getRecordAsOf(ENTITY, id, afterUpdate);

      expect(snapAtAdd).toMatchObject({ name: 'Alice' });
      expect(snapAfterUpdate).toMatchObject({ name: 'Alicia' });
    });
  });

  describe('DELETE — write capture', () => {
    it('returns null for the record after deletion', async () => {
      const addResult = await dm.addItemToCollection(ENTITY, { name: 'Alice' });
      const id = addResult.successes[0].id;
      const afterAdd = new Date();

      await sleep(2);
      await dm.removeItemFromCollection(ENTITY, id);
      const afterDelete = new Date();

      const snapBeforeDelete = await ledger.getRecordAsOf(ENTITY, id, afterAdd);
      const snapAfterDelete  = await ledger.getRecordAsOf(ENTITY, id, afterDelete);

      expect(snapBeforeDelete).toMatchObject({ name: 'Alice' });
      expect(snapAfterDelete).toBeNull();
    });

    it('tombstone carries the last known snapshot without an extra DB fetch', async () => {
      const addResult = await dm.addItemToCollection(ENTITY, { name: 'Alice', score: 99 });
      const id = addResult.successes[0].id;
      await sleep(2);
      const justBefore = new Date();
      await sleep(2);

      await dm.removeItemFromCollection(ENTITY, id);

      const snap = await ledger.getRecordAsOf(ENTITY, id, justBefore);
      expect(snap).toMatchObject({ name: 'Alice', score: 99 });
    });
  });

  describe('queryAsOf', () => {
    it('returns only records that were live at the requested time', async () => {
      const r1 = await dm.addItemToCollection(ENTITY, { name: 'Alice' });
      await dm.addItemToCollection(ENTITY, { name: 'Bob' });
      const afterBoth = new Date();

      await sleep(2);
      await dm.removeItemFromCollection(ENTITY, r1.successes[0].id);

      const atBoth      = await ledger.queryAsOf(ENTITY, afterBoth);
      const afterDelete = await ledger.queryAsOf(ENTITY, new Date());

      expect(atBoth).toHaveLength(2);
      expect(afterDelete).toHaveLength(1);
      expect(afterDelete[0]).toMatchObject({ name: 'Bob' });
    });

    it('applies filterFn correctly', async () => {
      await dm.addItemToCollection(ENTITY, { name: 'Alice', active: true });
      await dm.addItemToCollection(ENTITY, { name: 'Bob',   active: false });

      const results = await ledger.queryAsOf(ENTITY, new Date(), (s) => s.active === true);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'Alice' });
    });
  });

  describe('getDatabaseAsOf', () => {
    it('reconstructs the full database across multiple entities', async () => {
      const ENTITY_B = 'ledger_e2e_other';
      await dm.ensureStore(ENTITY_B);
      await dm.clearCollection(ENTITY_B);

      await dm.addItemToCollection(ENTITY,   { name: 'Alice' });
      await dm.addItemToCollection(ENTITY_B, { name: 'Widget' });
      const asOf = new Date();

      const db = await ledger.getDatabaseAsOf(asOf);

      expect(db[ENTITY]).toHaveLength(1);
      expect(db[ENTITY_B]).toHaveLength(1);
    });

    it('returns an empty array for an entity where all records were deleted', async () => {
      const r = await dm.addItemToCollection(ENTITY, { name: 'Alice' });
      await sleep(2);
      await dm.removeItemFromCollection(ENTITY, r.successes[0].id);

      const db = await ledger.getDatabaseAsOf(new Date());
      expect(db[ENTITY]).toHaveLength(0);
    });
  });

  describe('beginLedgerCommit', () => {
    it('produces a context with a valid commitId and committedAt', () => {
      const ctx = beginLedgerCommit({ initiatedBy: 'e2e-test' });

      expect(ctx.commitId).toEqual(expect.any(String));
      expect(ctx.commitId.length).toBeGreaterThan(0);
      expect(ctx.committedAt).toBeInstanceOf(Date);
      expect(ctx.metadata).toEqual({ initiatedBy: 'e2e-test' });
    });
  });
});
