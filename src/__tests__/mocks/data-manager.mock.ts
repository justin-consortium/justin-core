import sinon from 'sinon';
// eslint-disable-next-line no-duplicate-imports
import type { SinonSandbox, SinonSpy, SinonStub } from 'sinon';

import DataManager from '../../data-manager/data-manager';
import { ChangeListenerManager as CLM } from '../../data-manager/change-listener.manager';
import { makeStream } from '../helpers/streams';
import * as Helpers from '../../data-manager/data-manager.helpers';
import { MongoDBManager as mongoFns } from '../../data-manager/mongo/mongo-data-manager';

type Key = string; // `${collection}:${type}`

/**
 * Mocks the DataManager singleton *just enough* for ChangeListenerManager tests:
 * - replaces DataManager.getInstance() with an object that has getChangeStream()
 * - getChangeStream() returns a stable Readable per (collection, changeType)
 */
function mockDataManager() {
  const sb = sinon.createSandbox();
  const streams = new Map<Key, ReturnType<typeof makeStream>>();

  const getKey = (col: string, type: unknown) => `${col}:${String(type)}`;

  const getChangeStream = sb.stub().callsFake((collection: string, changeType: unknown) => {
    const key = getKey(collection, changeType);
    if (!streams.has(key)) streams.set(key, makeStream());
    return streams.get(key)!;
  });

  const instance = { getChangeStream };

  sb.stub(DataManager as any, 'getInstance').returns(instance as any);

  return {
    instance,
    getStream(collection: string, changeType: unknown) {
      return getChangeStream(collection, changeType);
    },
    restore() {
      sb.restore();
    },
  };
}

/**
 * A standalone sinon-stubbed DataManager-shaped object.
 *
 * This does NOT patch the singleton; use installDataManagerSingleton for that.
 */
function createDataManagerMock() {
  return {
    // lifecycle
    init: sinon.stub().resolves(),
    ensureStore: sinon.stub().resolves(),
    ensureIndexes: sinon.stub().resolves(),
    close: sinon.stub().resolves(),
    getInitializationStatus: sinon.stub().returns(true),

    // CRUD-ish
    addItemToCollection: sinon.stub(),
    updateItemByIdInCollection: sinon.stub(),
    removeItemFromCollection: sinon.stub(),
    getAllInCollection: sinon.stub(),
    clearCollection: sinon.stub().resolves(),
    isCollectionEmpty: sinon.stub(),
    findItemByIdInCollection: sinon.stub(),
    findItemsInCollection: sinon.stub(),

    // change streams (optional)
    getChangeStream: sinon.stub(),
  };
}

type DataManagerMock = ReturnType<typeof createDataManagerMock>;

/**
 * Installs a DataManagerMock as the DataManager singleton.
 */
function installDataManagerSingleton(dm: DataManagerMock) {
  const sb = sinon.createSandbox();
  sb.stub(DataManager as any, 'getInstance').returns(dm as any);

  return {
    dm,
    restore() {
      sb.restore();
    },
  };
}

type ClmMock = {
  addChangeListener: SinonStub;
  removeChangeListener: SinonStub;
  clearChangeListeners: SinonStub;
};

type DataManagerUnitSandbox = {
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
  handleDbErrorSpy: SinonSpy;
  restore(): void;
};

/**
 * Sandbox for DataManager unit tests that stub the MongoDBManager module functions
 * and ChangeListenerManager singleton instance.
 */
function makeDataManagerSandbox(): DataManagerUnitSandbox {
  const sb = sinon.createSandbox();

  const clm: ClmMock = {
    addChangeListener: sb.stub(),
    removeChangeListener: sb.stub(),
    clearChangeListeners: sb.stub(),
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
    getCollectionChangeReadable: sb.stub(mongoFns, 'getCollectionChangeReadable'),
  };

  const handleDbErrorSpy = sb.spy(Helpers, 'handleDbError');

  return {
    sb,
    clm,
    mongo,
    handleDbErrorSpy,
    restore() {
      sb.restore();
    },
  };
}



export type { DataManagerMock, DataManagerUnitSandbox };

export {
  mockDataManager,
  createDataManagerMock,
  installDataManagerSingleton,
  makeDataManagerSandbox,
};
