import sinon from 'sinon';
import DataManager from '../../data-manager/data-manager';
import { ChangeListenerManager } from '../../data-manager/change-listener.manager';
import * as HelpersModule from '../../data-manager/data-manager.helpers';
import { USERS } from '../../data-manager/data-manager.constants';
import { CollectionChangeType } from '../../data-manager/data-manager.type';
import { UserManager, TestingUserManager } from '../user-manager';

describe('UserManager (unit)', () => {
  let sb: sinon.SinonSandbox;
  let dm: ReturnType<typeof DataManager.getInstance>;
  let clm: ChangeListenerManager;
  let handleDbErrorStub: sinon.SinonStub;

  beforeEach(() => {
    sb = sinon.createSandbox();

    dm = DataManager.getInstance();
    clm = ChangeListenerManager.getInstance();

    // DataManager stubs
    sb.stub(dm, 'init').resolves();
    sb.stub(dm, 'ensureStore').resolves();
    sb.stub(dm, 'ensureIndexes').resolves();
    sb.stub(dm, 'getInitializationStatus').returns(true);
    sb.stub(dm, 'getAllInCollection').resolves([]);
    sb.stub(dm, 'addItemToCollection').resolves(null as any);
    sb.stub(dm, 'updateItemByIdInCollection').resolves(null as any);
    sb.stub(dm, 'removeItemFromCollection').resolves(false);
    sb.stub(dm, 'clearCollection').resolves();

    // ChangeListenerManager stubs
    sb.stub(clm, 'addChangeListener');
    sb.stub(clm, 'removeChangeListener');
    sb.stub(clm, 'clearChangeListeners');

    /**
     * handleDbError stub
     *
     * We support both call styles:
     *   handleDbError(message, error)
     *   handleDbError(message, methodName, error)
     *
     * and always rethrow the underlying Error (if present), or a new Error(message).
     */
    handleDbErrorStub = sb
      .stub(HelpersModule, 'handleDbError')
      .callsFake((...args: unknown[]): never => {
        const [message, maybeMethod, maybeError] = args;
        const msg = String(message);
        const error = maybeError ?? maybeMethod;

        const err =
          error instanceof Error ? error : new Error(String(error ?? msg));

        (err as any).dbMessage = msg;
        throw err;
      });

    // Reset in-memory cache
    TestingUserManager._users.clear();
  });

  afterEach(() => {
    sb.restore();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('init: initializes DM, ensures store/indexes, refreshes cache, and sets up change listeners', async () => {
    // arrange a couple of docs for refreshCache
    (dm.getAllInCollection as sinon.SinonStub).resolves([
      { _id: 'u1', uniqueIdentifier: 'a', attributes: { x: 1 } },
    ]);

    await expect(UserManager.init()).resolves.toBeUndefined();

    sinon.assert.calledOnce(dm.init as sinon.SinonStub);
    sinon.assert.calledWith(dm.ensureStore as sinon.SinonStub, USERS);
    sinon.assert.calledWith(dm.ensureIndexes as sinon.SinonStub, USERS, [
      { name: 'uniq_user_identifier', key: { uniqueIdentifier: 1 }, unique: true },
    ]);

    // Change listeners registered for INSERT/UPDATE/DELETE
    sinon.assert.calledThrice(clm.addChangeListener as sinon.SinonStub);
  });

  it('shutdown: removes all user change listeners', () => {
    UserManager.shutdown();

    sinon.assert.calledWith(
      clm.removeChangeListener as sinon.SinonStub,
      USERS,
      CollectionChangeType.INSERT,
    );
    sinon.assert.calledWith(
      clm.removeChangeListener as sinon.SinonStub,
      USERS,
      CollectionChangeType.UPDATE,
    );
    sinon.assert.calledWith(
      clm.removeChangeListener as sinon.SinonStub,
      USERS,
      CollectionChangeType.DELETE,
    );
  });

  it('refreshCache: clears and repopulates cache with id transform', async () => {
    (dm.getAllInCollection as sinon.SinonStub).resolves([
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
    sinon.assert.calledWith(dm.getAllInCollection as sinon.SinonStub, USERS);
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
    (dm.addItemToCollection as sinon.SinonStub).resolves({
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
    sinon.assert.calledWith(dm.addItemToCollection as sinon.SinonStub, USERS, {
      uniqueIdentifier: 'new',
      attributes: { foo: 1 },
    });
    expect(TestingUserManager._users.get('n1')).toEqual(out);
  });

  it('addUser: on DM error calls handleDbError (throws)', async () => {
    (dm.addItemToCollection as sinon.SinonStub).rejects(
      new Error('fail-insert'),
    );

    await expect(
      UserManager.addUser({ uniqueIdentifier: 'x', initialAttributes: {} }),
    ).rejects.toThrow('fail-insert');

    // Support both 2-arg and 3-arg styles; we only care that:
    //  - message is "Failed to add users:"
    //  - an Error instance is passed somewhere after it
    sinon.assert.calledWithMatch(
      handleDbErrorStub,
      'Failed to add users:',
      sinon.match.any,
      sinon.match.instanceOf(Error),
    );
  });

  it('addUsers: rejects on empty input; otherwise iterates addUser and returns successful inserts', async () => {
    await expect(UserManager.addUsers([] as any)).rejects.toThrow(
      'No users provided for insertion.',
    );

    // Ready state for addUser path
    TestingUserManager._users.clear();

    // Seed one duplicate
    TestingUserManager._users.set('dupid', {
      id: 'dupid',
      uniqueIdentifier: 'dup',
      attributes: {},
    } as any);

    (dm.addItemToCollection as sinon.SinonStub)
      .onFirstCall()
      .resolves({
        id: 'u1',
        uniqueIdentifier: 'a',
        attributes: {},
      })
      .onSecondCall()
      .resolves({
        id: 'u2',
        uniqueIdentifier: 'b',
        attributes: {},
      });

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

    (dm.updateItemByIdInCollection as sinon.SinonStub).resolves({
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
      dm.updateItemByIdInCollection as sinon.SinonStub,
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
    ).rejects.toThrow(
      'User with uniqueIdentifier (missing) not found.',
    );

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
    (dm.updateItemByIdInCollection as sinon.SinonStub).resolves({
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
      dm.updateItemByIdInCollection as sinon.SinonStub,
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

    (dm.removeItemFromCollection as sinon.SinonStub).resolves(true);

    const ok = await TestingUserManager.deleteUserById('u1');
    expect(ok).toBe(true);
    sinon.assert.calledWith(
      dm.removeItemFromCollection as sinon.SinonStub,
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

    (dm.removeItemFromCollection as sinon.SinonStub).resolves(true);

    const ok =
      await TestingUserManager.deleteUserByUniqueIdentifier('uid-1');
    expect(ok).toBe(true);
    expect(TestingUserManager._users.has('u1')).toBe(false);
  });

  it('deleteAllUsers clears DB and cache', async () => {
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', { id: 'u1' } as any);

    await expect(
      TestingUserManager.deleteAllUsers(),
    ).resolves.toBeUndefined();

    sinon.assert.calledWith(
      dm.clearCollection as sinon.SinonStub,
      USERS,
    );
    expect(TestingUserManager._users.size).toBe(0);
  });

  it('isIdentifierUnique validates input; returns false when exists; true otherwise', async () => {
    await expect(
      TestingUserManager.isIdentifierUnique(''),
    ).rejects.toThrow('Invalid unique identifier: ');
    await expect(
      TestingUserManager.isIdentifierUnique('   '),
    ).rejects.toThrow('Invalid unique identifier');

    // existing
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'exists',
      attributes: {},
    } as any);

    await expect(
      TestingUserManager.isIdentifierUnique('exists'),
    ).resolves.toBe(false);

    // new
    await expect(
      TestingUserManager.isIdentifierUnique('new-one'),
    ).resolves.toBe(true);
  });
});
