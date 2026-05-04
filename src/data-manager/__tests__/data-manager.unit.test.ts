import { DataManager, configureDB, getPendingConfig, clearPendingConfig } from '../data-manager';
import { MongoLedgerStore } from '../../ledger/store';
import { MongoDBManager as mongoFns } from '../mongo/mongo-data-manager';
import { DBType } from '../constants';
import { JustInError, JustinErrorCode } from '../../errors';
import { makeDataManagerSandbox, loggerSpies, resetGlobalLoggerState } from '../../testing/testkit';
import type { LoggerSpies, DataManagerUnitSandbox } from '../../testing/testkit';
import {
  expectOk,
  expectFailed,
  expectFailedWithCode,
  resetSingleton,
} from '../../testing/helpers';

describe('DataManager unit tests', () => {
  let t: DataManagerUnitSandbox;
  let lg: LoggerSpies;

  beforeEach(() => {
    // Restore any leftover sandbox from a previously failed test before
    // creating a new one — prevents sinon "already wrapped" errors
    t?.restore();
    lg?.restore();
    resetSingleton(DataManager);
    t = makeDataManagerSandbox();
    lg = loggerSpies();
    configureDB({ dbType: DBType.MONGO, uri: 'mongodb://localhost:27017' });
  });

  afterEach(() => {
    t?.restore();
    lg?.restore();
    resetGlobalLoggerState();
    clearPendingConfig();
  });

  describe('configureDB / getPendingConfig', () => {
    it('stores the provided config', () => {
      configureDB({ dbType: DBType.MONGO, uri: 'mongodb://test:27017' });
      const config = getPendingConfig();
      expect(config?.uri).toBe('mongodb://test:27017');
      expect(config?.dbType).toBe(DBType.MONGO);
    });

    it('overwrites a previously stored config', () => {
      configureDB({ dbType: DBType.MONGO, uri: 'mongodb://first:27017' });
      configureDB({ dbType: DBType.MONGO, uri: 'mongodb://second:27017' });
      expect(getPendingConfig()?.uri).toBe('mongodb://second:27017');
    });

    it('includes optional dbName when provided', () => {
      configureDB({ dbType: DBType.MONGO, uri: 'mongodb://test:27017', dbName: 'mydb' });
      expect(getPendingConfig()?.dbName).toBe('mydb');
    });

    it('clearPendingConfig resets the config to null', () => {
      configureDB({ dbType: DBType.MONGO, uri: 'mongodb://test:27017' });
      clearPendingConfig();
      expect(getPendingConfig()).toBeNull();
    });
  });

  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      const a = DataManager.getInstance();
      const b = DataManager.getInstance();
      expect(a).toBe(b);
    });

    it('returns a new instance after killInstance', () => {
      const a = DataManager.getInstance();
      resetSingleton(DataManager);
      const b = DataManager.getInstance();
      expect(a).not.toBe(b);
    });
  });

  describe('init', () => {
    it('initialises successfully with a valid MONGO config', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      expect(dm.getInitializationStatus()).toBe(true);
    });

    it('calls mongo init with the configured uri and dbName', async () => {
      configureDB({ dbType: DBType.MONGO, uri: 'mongodb://test:27017', dbName: 'mydb' });
      const dm = DataManager.getInstance();
      await dm.init();
      expect(t.mongo.init.calledOnce).toBe(true);
      expect(t.mongo.init.firstCall.args[0]).toBe('mongodb://test:27017');
      expect(t.mongo.init.firstCall.args[1]).toBe('mydb');
    });

    it('is a no-op when already initialised', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      await dm.init();
      expect(t.mongo.init.calledOnce).toBe(true);
    });

    it('throws NOT_INITIALIZED when no config has been provided', async () => {
      clearPendingConfig();
      const dm = DataManager.getInstance();
      await expect(dm.init()).rejects.toMatchObject({ code: JustinErrorCode.NOT_INITIALIZED });
    });

    it('throws VALIDATION_ERROR for an unsupported DB type', async () => {
      configureDB({ dbType: 'POSTGRES' as any, uri: 'postgres://localhost' });
      const dm = DataManager.getInstance();
      await expect(dm.init()).rejects.toMatchObject({ code: JustinErrorCode.VALIDATION_ERROR });
    });

    it('throws when the mongo adapter init fails', async () => {
      t.mongo.init.rejects(new Error('connection refused'));
      const dm = DataManager.getInstance();
      await expect(dm.init()).rejects.toThrow(JustInError);
    });

    it('wires the ledger when getDb returns a Db instance', async () => {
      const fakeDb = {} as any;
      t.mongo.getDb.returns(fakeDb);
      const ensureStore = t.sb.stub(MongoLedgerStore.prototype, 'ensureStore').resolves();

      const dm = DataManager.getInstance();
      await dm.init();

      expect(ensureStore.calledOnce).toBe(true);
    });

    it('skips ledger wiring gracefully when getDb returns null', async () => {
      t.mongo.getDb.returns(null);
      const ensureStore = t.sb.stub(MongoLedgerStore.prototype, 'ensureStore').resolves();

      const dm = DataManager.getInstance();
      await dm.init();

      expect(ensureStore.called).toBe(false);
      expect(dm.getInitializationStatus()).toBe(true);
    });
  });

  describe('getInitializationStatus', () => {
    it('returns false before init', () => {
      const dm = DataManager.getInstance();
      expect(dm.getInitializationStatus()).toBe(false);
    });

    it('returns true after successful init', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      expect(dm.getInitializationStatus()).toBe(true);
    });
  });

  describe('close', () => {
    it('closes the adapter and sets isInitialized to false', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      await dm.close();
      expect(dm.getInitializationStatus()).toBe(false);
    });

    it('calls clearChangeListeners before closing the adapter', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      await dm.close();
      expect(t.clm.clearChangeListeners.calledOnce).toBe(true);
    });

    it('calls the adapter close method', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      await dm.close();
      expect(t.mongo.close.calledOnce).toBe(true);
    });
  });

  describe('ensureStore', () => {
    it('delegates to the adapter', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      await dm.ensureStore('users');
      expect(t.mongo.ensureStore.calledWith('users')).toBe(true);
    });

    it('throws when the adapter fails', async () => {
      t.mongo.ensureStore.rejects(new Error('store error'));
      const dm = DataManager.getInstance();
      await dm.init();
      await expect(dm.ensureStore('users')).rejects.toThrow(JustInError);
    });
  });

  describe('ensureIndexes', () => {
    it('delegates to the adapter', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      const indexes = [{ key: { uniqueIdentifier: 1 }, unique: true }];
      await dm.ensureIndexes('users', indexes);
      expect(t.mongo.ensureIndexes.calledWith('users', indexes)).toBe(true);
    });

    it('throws when the adapter fails', async () => {
      t.mongo.ensureIndexes.rejects(new Error('index error'));
      const dm = DataManager.getInstance();
      await dm.init();
      await expect(dm.ensureIndexes('users', [])).rejects.toThrow(JustInError);
    });
  });

  describe('addItemToCollection', () => {
    it('returns ok:true with the inserted item including its id', async () => {
      t.mongo.addItemToCollection.resolves('generated-id');
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.addItemToCollection('users', { name: 'Alice' });
      const item = expectOk(result);
      expect(item.id).toBe('generated-id');
      expect((item as any).name).toBe('Alice');
    });

    it('returns ok:false when the adapter throws', async () => {
      t.mongo.addItemToCollection.rejects(new Error('insert failed'));
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.addItemToCollection('users', { name: 'Alice' });
      expectFailed(result);
    });

    it('logs an error when the adapter throws', async () => {
      t.mongo.addItemToCollection.rejects(new Error('insert failed'));
      const dm = DataManager.getInstance();
      await dm.init();
      await dm.addItemToCollection('users', { name: 'Alice' });
      expect(lg.findByMessage('addItemToCollection failed')).toHaveLength(1);
    });
  });

  describe('updateItemByIdInCollection', () => {
    it('returns ok:true with the updated item', async () => {
      t.mongo.updateItemInCollection.resolves({ id: 'abc', name: 'Updated' });
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.updateItemByIdInCollection('users', 'abc', { name: 'Updated' });
      expectOk(result);
    });

    it('returns ok:false with NOT_FOUND when the adapter returns null', async () => {
      t.mongo.updateItemInCollection.resolves(null);
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.updateItemByIdInCollection('users', 'abc', {});
      expectFailedWithCode(result, JustinErrorCode.NOT_FOUND);
    });

    it('includes the id in the NOT_FOUND failure entry', async () => {
      t.mongo.updateItemInCollection.resolves(null);
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.updateItemByIdInCollection('users', 'abc', {});
      if (!result.ok) expect(result.failures[0].id).toBe('abc');
    });

    it('returns ok:false when the adapter throws', async () => {
      t.mongo.updateItemInCollection.rejects(new Error('update failed'));
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.updateItemByIdInCollection('users', 'abc', {});
      expectFailed(result);
    });
  });

  describe('removeItemFromCollection', () => {
    it('returns ok:true when the item is deleted', async () => {
      t.mongo.removeItemFromCollection.resolves(1);
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.removeItemFromCollection('users', 'abc');
      expectOk(result);
    });

    it('returns ok:false with NOT_FOUND when deletedCount is 0', async () => {
      t.mongo.removeItemFromCollection.resolves(0);
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.removeItemFromCollection('users', 'abc');
      expectFailedWithCode(result, JustinErrorCode.NOT_FOUND);
    });

    it('includes the id in the NOT_FOUND failure entry', async () => {
      t.mongo.removeItemFromCollection.resolves(0);
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.removeItemFromCollection('users', 'abc');
      if (!result.ok) expect(result.failures[0].id).toBe('abc');
    });

    it('returns ok:false when the adapter throws', async () => {
      t.mongo.removeItemFromCollection.rejects(new Error('delete failed'));
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.removeItemFromCollection('users', 'abc');
      expectFailed(result);
    });
  });

  describe('findItemByIdInCollection', () => {
    it('returns the item when found', async () => {
      t.mongo.findItemByIdInCollection.resolves({ id: 'abc', name: 'Alice' });
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.findItemByIdInCollection('users', 'abc');
      expect(result).toMatchObject({ id: 'abc', name: 'Alice' });
    });

    it('returns null when not found', async () => {
      t.mongo.findItemByIdInCollection.resolves(null);
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.findItemByIdInCollection('users', 'abc');
      expect(result).toBeNull();
    });

    it('returns null and logs when the adapter throws', async () => {
      t.mongo.findItemByIdInCollection.rejects(new Error('find failed'));
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.findItemByIdInCollection('users', 'abc');
      expect(result).toBeNull();
      expect(lg.captured.length).toBeGreaterThan(0);
    });
  });

  describe('findItemsInCollection', () => {
    it('returns matching items', async () => {
      t.mongo.findItemsInCollection.resolves([{ id: 'abc' }, { id: 'def' }]);
      const dm = DataManager.getInstance();
      await dm.init();
      const results = await dm.findItemsInCollection('users', { active: true });
      expect(results).toHaveLength(2);
    });

    it('returns empty array for null criteria', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      const results = await dm.findItemsInCollection('users', null as any);
      expect(results).toEqual([]);
    });

    it('returns empty array for empty collectionName', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      const results = await dm.findItemsInCollection('', { active: true });
      expect(results).toEqual([]);
    });

    it('returns empty array and logs when the adapter throws', async () => {
      t.mongo.findItemsInCollection.rejects(new Error('find failed'));
      const dm = DataManager.getInstance();
      await dm.init();
      const results = await dm.findItemsInCollection('users', { active: true });
      expect(results).toEqual([]);
      expect(lg.captured.length).toBeGreaterThan(0);
    });
  });

  describe('getAllInCollection', () => {
    it('returns all items', async () => {
      t.mongo.getAllInCollection.resolves([{ id: 'a' }, { id: 'b' }]);
      const dm = DataManager.getInstance();
      await dm.init();
      const results = await dm.getAllInCollection('users');
      expect(results).toHaveLength(2);
    });

    it('returns empty array and logs when the adapter throws', async () => {
      t.mongo.getAllInCollection.rejects(new Error('getAll failed'));
      const dm = DataManager.getInstance();
      await dm.init();
      const results = await dm.getAllInCollection('users');
      expect(results).toEqual([]);
      expect(lg.captured.length).toBeGreaterThan(0);
    });
  });

  describe('clearCollection', () => {
    it('returns ok:true on success', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.clearCollection('users');
      expectOk(result);
    });

    it('returns ok:false when the adapter throws', async () => {
      t.mongo.clearCollection.rejects(new Error('clear failed'));
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.clearCollection('users');
      expectFailed(result);
    });
  });

  describe('isCollectionEmpty', () => {
    it('returns true when the collection is empty', async () => {
      t.mongo.isCollectionEmpty.resolves(true);
      const dm = DataManager.getInstance();
      await dm.init();
      expect(await dm.isCollectionEmpty('users')).toBe(true);
    });

    it('returns false when the collection is not empty', async () => {
      t.mongo.isCollectionEmpty.resolves(false);
      const dm = DataManager.getInstance();
      await dm.init();
      expect(await dm.isCollectionEmpty('users')).toBe(false);
    });

    it('returns false and logs when the adapter throws', async () => {
      t.mongo.isCollectionEmpty.rejects(new Error('check failed'));
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.isCollectionEmpty('users');
      expect(result).toBe(false);
      expect(lg.captured.length).toBeGreaterThan(0);
    });
  });

  describe('getChangeStream', () => {
    it('delegates to the adapter and returns the stream', async () => {
      const fakeStream = { on: () => {} };
      t.mongo.getCollectionChangeReadable.returns(fakeStream);
      const dm = DataManager.getInstance();
      await dm.init();
      const stream = dm.getChangeStream('users', 'insert' as any);
      expect(stream).toBe(fakeStream);
    });
  });

  describe('addItemsToCollection', () => {
    it('returns ok:true with empty successes for empty input', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.addItemsToCollection('users', []);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });

    it('falls back to one-by-one inserts when adapter has no bulk method', async () => {
      // Remove the bulk stub so DataManager falls back to one-by-one
      delete (mongoFns as any).addItemsToCollection;
      t.mongo.addItemToCollection.onFirstCall().resolves('id-1').onSecondCall().resolves('id-2');
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.addItemsToCollection('users', [{ name: 'Alice' }, { name: 'Bob' }]);
      expectOk(result);
      expect(result.successes).toHaveLength(2);
    });

    it('returns partial failures when one-by-one insert fails for some items', async () => {
      // Remove the bulk stub so DataManager falls back to one-by-one
      delete (mongoFns as any).addItemsToCollection;
      t.mongo.addItemToCollection
        .onFirstCall()
        .resolves('id-1')
        .onSecondCall()
        .rejects(new Error('insert failed'));
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.addItemsToCollection('users', [{ name: 'Alice' }, { name: 'Bob' }]);
      expect(result.ok).toBe(false);
      expect(result.successes).toHaveLength(1);
      if (!result.ok) expect(result.failures).toHaveLength(1);
    });
  });

  describe('updateItemsByIdInCollection', () => {
    it('returns ok:true with empty successes for empty input', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.updateItemsByIdInCollection('users', []);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });

    it('returns ok:false with NOT_FOUND when item does not exist', async () => {
      delete (mongoFns as any).updateItemsInCollection;
      t.mongo.updateItemInCollection.resolves(null);
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.updateItemsByIdInCollection('users', [
        { id: 'abc', update: { name: 'Updated' } },
      ]);
      expectFailedWithCode(result, JustinErrorCode.NOT_FOUND);
    });

    it('returns ok:true when all items update successfully', async () => {
      delete (mongoFns as any).updateItemsInCollection;
      t.mongo.updateItemInCollection.resolves({ id: 'abc', name: 'Updated' });
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.updateItemsByIdInCollection('users', [
        { id: 'abc', update: { name: 'Updated' } },
      ]);
      expectOk(result);
    });
  });

  describe('removeItemsFromCollection', () => {
    it('returns ok:true with empty successes for empty input', async () => {
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.removeItemsFromCollection('users', []);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });

    it('returns ok:false with NOT_FOUND when item does not exist', async () => {
      delete (mongoFns as any).removeItemsFromCollection;
      t.mongo.removeItemFromCollection.resolves(0);
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.removeItemsFromCollection('users', ['abc']);
      expectFailedWithCode(result, JustinErrorCode.NOT_FOUND);
    });

    it('returns ok:true when all items are removed', async () => {
      delete (mongoFns as any).removeItemsFromCollection;
      t.mongo.removeItemFromCollection.resolves(1);
      const dm = DataManager.getInstance();
      await dm.init();
      const result = await dm.removeItemsFromCollection('users', ['abc', 'def']);
      expectOk(result);
    });
  });
});
