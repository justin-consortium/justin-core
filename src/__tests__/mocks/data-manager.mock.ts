import sinon from 'sinon';
import DataManager from '../../data-manager/data-manager';
import { makeStream } from '../helpers/streams';
import type { SinonSandbox, SinonStub, SinonSpy } from 'sinon';
import { MongoDBManager as mongoFns } from '../../data-manager/mongo/mongo-data-manager';
import { ChangeListenerManager as CLM } from '../../data-manager/change-listener.manager';
import * as Helpers from '../../data-manager/data-manager.helpers';

type Key = string; // `${collection}:${type}`

export function mockDataManager() {
  const sb = sinon.createSandbox();
  const streams = new Map<Key, ReturnType<typeof makeStream>>();

  const getKey = (col: string, type: unknown) => `${col}:${String(type)}`;

  const instance = {
    getChangeStream: jest.fn((collection: string, changeType: unknown) => {
      const key = getKey(collection, changeType);
      if (!streams.has(key)) streams.set(key, makeStream());
      return streams.get(key)!;
    }),
  };

  sb.stub(DataManager as any, 'getInstance').returns(instance as any);

  return {
    /** The minimal DM instance with getChangeStream mocked. */
    instance,
    /** Retrieve (and create if missing) a stream for a collection/changeType combo. */
    getStream(collection: string, changeType: unknown) {
      return (instance as any).getChangeStream(collection, changeType);
    },
    /** Restore all stubs on DataManager and associated sandbox. */
    restore() {
      sb.restore();
    },
  };
}

export type DataManagerMock = ReturnType<typeof createDataManagerMock>;
export function createDataManagerMock() {
  return {
    // lifecycle
    init: jest.fn(async () => {}),
    ensureStore: jest.fn(async (_store: string, _opts?: unknown) => {}),
    ensureIndexes: jest.fn(async (_store: string, _indexes?: unknown) => {}),
    close: jest.fn(async () => {}),
    getInitializationStatus: jest.fn<boolean, []>(() => true),

    // CRUD-ish
    addItemToCollection: jest.fn(),
    updateItemByIdInCollection: jest.fn(),
    removeItemFromCollection: jest.fn(),
    getAllInCollection: jest.fn(),
    clearCollection: jest.fn(async (_store: string) => {}),
    isCollectionEmpty: jest.fn(),
    findItemByIdInCollection: jest.fn(),
    findItemsInCollection: jest.fn(),

    // change streams (optional in CRUD tests)
    getChangeStream: jest.fn(),
  };
}

export function installDataManagerSingleton(dm: DataManagerMock) {
  const sb = sinon.createSandbox();
  sb.stub(DataManager as any, 'getInstance').returns(dm as any);

  return {
    dm,
    sb,
    /** Restore the original DataManager.getInstance() and all sandbox stubs. */
    restore() {
      sb.restore();
    },
  };
}



type ClmMock = {
  addChangeListener: jest.Mock;
  removeChangeListener: jest.Mock;
  clearChangeListeners: jest.Mock;
};

export type DataManagerUnitSandbox = {
  sb: SinonSandbox;
  clm: ClmMock;
  mongo: {
    init: SinonStub;
    ensureStore: SinonStub;
    ensureIndexes: SinonStub;
    close: SinonStub;
    addItemToCollection: SinonStub;
    updateItemInCollection: SinonStub;
    removeItemFromCollection: SinonStub;
    getAllInCollection: SinonStub;
    clearCollection: SinonStub;
    isCollectionEmpty: SinonStub;
    findItemByIdInCollection: SinonStub;
    findItemsInCollection: SinonStub;
    getCollectionChangeReadable: SinonStub;
  };
  handleDbErrorSpy: SinonSpy<[string, string, unknown], never>;
  restore(): void;
};

export function makeDataManagerSandbox(): DataManagerUnitSandbox {
  const sb = sinon.createSandbox();

  const clm: ClmMock = {
    addChangeListener: jest.fn(),
    removeChangeListener: jest.fn(),
    clearChangeListeners: jest.fn(),
  };
  sb.stub(CLM, 'getInstance').returns(clm as any);

  const mongo = {
    init: sb.stub(mongoFns, 'init').resolves(),
    ensureStore: sb.stub(mongoFns, 'ensureStore').resolves(),
    ensureIndexes: sb.stub(mongoFns, 'ensureIndexes').resolves(),
    close: sb.stub(mongoFns, 'close').resolves(),
    addItemToCollection: sb.stub(mongoFns, 'addItemToCollection'),
    updateItemInCollection: sb.stub(mongoFns, 'updateItemInCollection'),
    removeItemFromCollection: sb.stub(mongoFns, 'removeItemFromCollection'),
    getAllInCollection: sb.stub(mongoFns, 'getAllInCollection'),
    clearCollection: sb.stub(mongoFns, 'clearCollection').resolves(),
    isCollectionEmpty: sb.stub(mongoFns, 'isCollectionEmpty'),
    findItemByIdInCollection: sb.stub(mongoFns, 'findItemByIdInCollection'),
    findItemsInCollection: sb.stub(mongoFns, 'findItemsInCollection'),
    getCollectionChangeReadable: sb.stub(
      mongoFns,
      'getCollectionChangeReadable',
    ),
  };

  const handleDbErrorSpy = sb.spy(Helpers, 'handleDbError');

  const restore = () => sb.restore();

  return { sb, clm, mongo, handleDbErrorSpy, restore };
}
