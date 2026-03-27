import sinon from 'sinon';
import type { SinonSandbox, SinonSpy, SinonStub } from 'sinon';
import { ChangeListenerManager as CLM } from '../../data-manager/change-listener.manager';
import { MongoDBManager as mongoFns } from '../../data-manager/mongo/mongo-data-manager';
import * as Helpers from '../../utils/error.helpers';

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
  handleErrorSpy: SinonSpy;
  restore(): void;
};

/**
 * Restores any existing sinon stubs on the MongoDBManager module and
 * ChangeListenerManager class before creating new ones.
 *
 * makeDataManagerSandbox stubs module-level objects (mongoFns, CLM) that
 * persist across test runs. If a previous sandbox was not restored — e.g.
 * because beforeEach threw mid-way — those stubs are still in place and
 * sinon will throw "already wrapped" on the next call. Calling this first
 * makes the sandbox safe to create even after a partially-failed teardown.
 */
function _restoreExistingStubs(): void {
  const mongoMethods = [
    'init',
    'ensureStore',
    'ensureIndexes',
    'close',
    'addItemToCollection',
    'updateItemInCollection',
    'removeItemFromCollection',
    'getAllInCollection',
    'clearCollection',
    'isCollectionEmpty',
    'findItemByIdInCollection',
    'findItemsInCollection',
    'getCollectionChangeReadable',
  ] as const;

  for (const method of mongoMethods) {
    const fn = (mongoFns as any)[method];
    if (fn && typeof fn.restore === 'function') fn.restore();
  }

  const clmFn = (CLM as any).getInstance;
  if (clmFn && typeof clmFn.restore === 'function') clmFn.restore();

  const handleErrorFn = (Helpers as any).handleError;
  if (handleErrorFn && typeof handleErrorFn.restore === 'function') handleErrorFn.restore();
}

/**
 * Sandbox for DataManager unit tests that stub the MongoDBManager module
 * functions and ChangeListenerManager singleton instance.
 *
 * Safe to call even after a partially-failed teardown — restores any
 * pre-existing stubs before creating new ones.
 */
function makeDataManagerSandbox(): DataManagerUnitSandbox {
  _restoreExistingStubs();

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

  const handleErrorSpy = sb.spy(Helpers, 'handleError');

  return {
    sb,
    clm,
    mongo,
    handleErrorSpy,
    restore() {
      sb.restore();
    },
  };
}

export type { DataManagerUnitSandbox };
export { makeDataManagerSandbox };
