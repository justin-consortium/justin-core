import sinon, { SinonSandbox, SinonStub } from 'sinon';

import DataManager from '../../data-manager/data-manager';
import { ChangeListenerManager } from '../../data-manager/change-listener.manager';
import { USERS } from '../../data-manager/data-manager.constants';
import { CollectionChangeType } from '../../data-manager/data-manager.type';
import * as helpers from '../../data-manager/data-manager.helpers';
import { UserManager, TestingUserManager } from '../user-manager';

describe('UserManager (unit)', () => {
  let sb: SinonSandbox;
  let dm: any;
  let clm: any;
  let handleDbErrorStub: SinonStub;

  beforeEach(() => {
    sb = sinon.createSandbox();

    // Grab the singleton instances that user-manager closed over at import time
    dm = (DataManager as any).getInstance();
    clm = (ChangeListenerManager as any).getInstance();

    // DataManager lifecycle
    sb.stub(dm, 'init').resolves();
    sb.stub(dm, 'ensureStore').resolves();
    sb.stub(dm, 'ensureIndexes').resolves();
    sb.stub(dm, 'getInitializationStatus').returns(true);

    // CRUD-ish methods
    sb.stub(dm, 'getAllInCollection').resolves([]);
    sb.stub(dm, 'addItemToCollection').resolves(undefined);
    sb.stub(dm, 'updateItemByIdInCollection').resolves(undefined);
    sb.stub(dm, 'removeItemFromCollection').resolves(true);
    sb.stub(dm, 'clearCollection').resolves();

    // ChangeListenerManager wiring
    sb.stub(clm, 'addChangeListener');
    sb.stub(clm, 'removeChangeListener');
    sb.stub(clm, 'clearChangeListeners');

    // handleDbError: log + rethrow, but we want to assert calls and control the error shape
    handleDbErrorStub = sb
      .stub(helpers, 'handleDbError')
      .callsFake((message: string, error: unknown): never => {
        const err =
          error instanceof Error ? error : new Error(String(error ?? message));
        (err as any).dbMessage = message;
        throw err;
      });

    // Always start from a clean cache
    TestingUserManager._users.clear();
  });

  afterEach(() => {
    TestingUserManager._users.clear();
    sb.restore();
  });

  it('init: initializes DM, ensures store/indexes, refreshes cache, and sets up change listeners', async () => {
    (dm.getAllInCollection as SinonStub).resolves([
      { _id: 'u1', uniqueIdentifier: 'a', attributes: { x: 1 } },
    ]);

    await expect(UserManager.init()).resolves.toBeUndefined();

    sinon.assert.calledOnce(dm.init as SinonStub);
    sinon.assert.calledWith(dm.ensureStore as SinonStub, USERS);
    sinon.assert.calledWith(dm.ensureIndexes as SinonStub, USERS, [
      { name: 'uniq_user_identifier', key: { uniqueIdentifier: 1 }, unique: true },
    ]);

    // Change listeners were registered for INSERT/UPDATE/DELETE
    sinon.assert.callCount(clm.addChangeListener as SinonStub, 3);
  });

  it('shutdown: removes all user change listeners', () => {
    UserManager.shutdown();

    sinon.assert.calledWith(
      clm.removeChangeListener as SinonStub,
      USERS,
      CollectionChangeType.INSERT,
    );
    sinon.assert.calledWith(
      clm.removeChangeListener as SinonStub,
      USERS,
      CollectionChangeType.UPDATE,
    );
    sinon.assert.calledWith(
      clm.removeChangeListener as SinonStub,
      USERS,
      CollectionChangeType.DELETE,
    );
  });

  it('refreshCache: clears and repopulates cache with id transform', async () => {
    (dm.getAllInCollection as SinonStub).resolves([
      { _id: 'x1', uniqueIdentifier: 'uid-1', attributes: { a: 1 } },
      { _id: 'x2', uniqueIdentifier: 'uid-2', attributes: { b: 2 } },
    ]);

    await TestingUserManager.refreshCache();

    expect(TestingUserManager._users.size).toBe(2);
    expect(TestingUserManager._users.get('x1')).toEqual({
      id: 'x1',
      uniqueIdentifier: 'uid-1',
      attributes: { a: 1 },
    });
    expect(TestingUserManager._users.get('x2')).toEqual({
      id: 'x2',
      uniqueIdentifier: 'uid-2',
      attributes: { b: 2 },
    });

    sinon.assert.calledWith(dm.getAllInCollection as SinonStub, USERS);
  });

  it('addUser: validates payload and uniqueness; inserts and caches result', async () => {
    // seed cache empty
    TestingUserManager._users.clear();

    // invalid shapes -> null
    await expect(UserManager.addUser(null as any)).resolves.toBeNull();
    await expect(UserManager.addUser({} as any)).resolves.toBeNull();

    // duplicate uniqueIdentifier -> null
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'dup',
      attributes: {},
    } as any);
    await expect(
      UserManager.addUser({ uniqueIdentifier: 'dup', initialAttributes: {} }),
    ).resolves.toBeNull();

    // new uniqueIdentifier -> DM insert, cache
    (dm.addItemToCollection as SinonStub).resolves({
      id: 'n1',
      uniqueIdentifier: 'new',
      attributes: { foo: 1 },
    });

    const out = await UserManager.addUser({
      uniqueIdentifier: 'new',
      initialAttributes: { foo: 1 },
    });

    expect(out).toEqual({
      id: 'n1',
      uniqueIdentifier: 'new',
      attributes: { foo: 1 },
    });

    sinon.assert.calledWith(dm.addItemToCollection as SinonStub, USERS, {
      uniqueIdentifier: 'new',
      attributes: { foo: 1 },
    });
    expect(TestingUserManager._users.get('n1')).toEqual(out);
  });

  it('addUser: on DM error calls handleDbError (throws)', async () => {
    const boom = new Error('fail-insert');
    (dm.addItemToCollection as SinonStub).rejects(boom);

    await expect(
      UserManager.addUser({ uniqueIdentifier: 'x', initialAttributes: {} }),
    ).rejects.toThrow('fail-insert');

    sinon.assert.calledWith(
      handleDbErrorStub,
      'Failed to add users:',
      boom,
    );
  });

  it('addUsers: rejects on empty input; otherwise iterates addUser and returns successful inserts', async () => {
    await expect(UserManager.addUsers([] as any)).rejects.toThrow(
      'No users provided for insertion.',
    );

    // seed cache with one duplicate
    TestingUserManager._users.clear();
    TestingUserManager._users.set('dupid', {
      id: 'dupid',
      uniqueIdentifier: 'dup',
      attributes: {},
    } as any);

    const addStub = dm.addItemToCollection as SinonStub;
    addStub
      .onFirstCall()
      .resolves({ id: 'u1', uniqueIdentifier: 'a', attributes: {} })
      .onSecondCall()
      .resolves({ id: 'u2', uniqueIdentifier: 'b', attributes: {} });

    const res = await UserManager.addUsers([
      { uniqueIdentifier: 'a', initialAttributes: {} },
      { uniqueIdentifier: 'dup', initialAttributes: {} }, // duplicate → skipped
      { uniqueIdentifier: 'b', initialAttributes: {} },
    ]);

    expect(res).toEqual([
      { id: 'u1', uniqueIdentifier: 'a', attributes: {} },
      { id: 'u2', uniqueIdentifier: 'b', attributes: {} },
    ]);
  });

  it('getAllUsers returns cached list (requires init)', () => {
    TestingUserManager._users.clear();
    TestingUserManager._users.set('x', {
      id: 'x',
      uniqueIdentifier: 'u',
      attributes: {},
    } as any);

    expect(TestingUserManager.getAllUsers()).toEqual([
      { id: 'x', uniqueIdentifier: 'u', attributes: {} },
    ]);
  });

  it('getUserByUniqueIdentifier finds a user or null', () => {
    TestingUserManager._users.clear();
    TestingUserManager._users.set('a', {
      id: 'a',
      uniqueIdentifier: 'u1',
      attributes: {},
    } as any);

    expect(TestingUserManager.getUserByUniqueIdentifier('u1')).toEqual({
      id: 'a',
      uniqueIdentifier: 'u1',
      attributes: {},
    });
    expect(TestingUserManager.getUserByUniqueIdentifier('nope')).toBeNull();
  });

  it('updateUserById merges attributes, writes via DM, updates cache', async () => {
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'a',
      attributes: { a: 1, b: 1 },
    } as any);

    (dm.updateItemByIdInCollection as SinonStub).resolves({
      id: 'u1',
      uniqueIdentifier: 'a',
      attributes: { a: 1, b: 2, c: 3 },
    });

    const updated = await TestingUserManager.updateUserById('u1', {
      b: 2,
      c: 3,
    });

    expect(updated).toEqual({
      id: 'u1',
      uniqueIdentifier: 'a',
      attributes: { a: 1, b: 2, c: 3 },
    });

    sinon.assert.calledWith(
      dm.updateItemByIdInCollection as SinonStub,
      USERS,
      'u1',
      { attributes: { a: 1, b: 2, c: 3 } },
    );

    expect(TestingUserManager._users.get('u1')).toEqual(updated);
  });

  it('updateUserByUniqueIdentifier validates inputs and reroutes to updateUserById', async () => {
    // invalid args
    await expect(
      TestingUserManager.updateUserByUniqueIdentifier('', { x: 1 }),
    ).rejects.toThrow('Invalid uniqueIdentifier: ');

    await expect(
      TestingUserManager.updateUserByUniqueIdentifier('u', {
        uniqueIdentifier: 'nope',
      } as any),
    ).rejects.toThrow(
      'Cannot update uniqueIdentifier field using updateUserByUniqueIdentifier',
    );

    await expect(
      TestingUserManager.updateUserByUniqueIdentifier('u', {} as any),
    ).rejects.toThrow('Invalid updateData');

    // not found
    await expect(
      TestingUserManager.updateUserByUniqueIdentifier('missing', { a: 1 }),
    ).rejects.toThrow('User with uniqueIdentifier (missing) not found.');
  });

  it('modifyUserUniqueIdentifier validates and updates via DM; no-op if same value', async () => {
    // invalid new value
    await expect(
      TestingUserManager.modifyUserUniqueIdentifier('old', ''),
    ).rejects.toThrow('uniqueIdentifier must be a non-empty string.');

    // not found
    await expect(
      TestingUserManager.modifyUserUniqueIdentifier('missing', 'new'),
    ).rejects.toThrow('User with uniqueIdentifier (missing) not found.');

    // no-op when same value
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'same',
      attributes: {},
    } as any);

    await expect(
      TestingUserManager.modifyUserUniqueIdentifier('same', 'same'),
    ).resolves.toEqual({
      id: 'u1',
      uniqueIdentifier: 'same',
      attributes: {},
    });

    // real update path
    (dm.updateItemByIdInCollection as SinonStub).resolves({
      id: 'u1',
      uniqueIdentifier: 'new',
      attributes: {},
    });

    const updated = await TestingUserManager.modifyUserUniqueIdentifier(
      'same',
      'new',
    );

    expect(updated).toEqual({
      id: 'u1',
      uniqueIdentifier: 'new',
      attributes: {},
    });

    sinon.assert.calledWith(
      dm.updateItemByIdInCollection as SinonStub,
      USERS,
      'u1',
      { uniqueIdentifier: 'new' },
    );
  });

  it('deleteUserById removes from DB and cache on success', async () => {
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'a',
      attributes: {},
    } as any);

    (dm.removeItemFromCollection as SinonStub).resolves(true);

    const ok = await TestingUserManager.deleteUserById('u1');
    expect(ok).toBe(true);

    sinon.assert.calledWith(
      dm.removeItemFromCollection as SinonStub,
      USERS,
      'u1',
    );
    expect(TestingUserManager._users.has('u1')).toBe(false);
  });

  it('deleteUserByUniqueIdentifier finds id then deletes via deleteUserById', async () => {
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'uid-1',
      attributes: {},
    } as any);

    (dm.removeItemFromCollection as SinonStub).resolves(true);

    const ok = await TestingUserManager.deleteUserByUniqueIdentifier('uid-1');

    expect(ok).toBe(true);
    sinon.assert.calledOnce(dm.removeItemFromCollection as SinonStub);
    expect(TestingUserManager._users.has('u1')).toBe(false);
  });

  it('deleteAllUsers clears DB and cache', async () => {
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', { id: 'u1' } as any);

    await expect(TestingUserManager.deleteAllUsers()).resolves.toBeUndefined();

    sinon.assert.calledWith(dm.clearCollection as SinonStub, USERS);
    expect(TestingUserManager._users.size).toBe(0);
  });

  it('isIdentifierUnique validates input; returns false when exists; true otherwise', async () => {
    await expect(
      TestingUserManager.isIdentifierUnique(''),
    ).rejects.toThrow('Invalid unique identifier: ');
    await expect(
      TestingUserManager.isIdentifierUnique('   '),
    ).rejects.toThrow('Invalid unique identifier');

    // put a user in cache
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'exists',
      attributes: {},
    } as any);

    await expect(
      TestingUserManager.isIdentifierUnique('exists'),
    ).resolves.toBe(false);

    await expect(
      TestingUserManager.isIdentifierUnique('new-one'),
    ).resolves.toBe(true);
  });
});
