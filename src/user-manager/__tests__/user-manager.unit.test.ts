describe('UserManager (unit)', () => {
  function makeDmMock() {
    return {
      init: jest.fn(async () => {}),
      ensureStore: jest.fn(async () => {}),
      ensureIndexes: jest.fn(async () => {}),
      getInitializationStatus: jest.fn<boolean, []>(() => true),

      // CRUD
      getAllInCollection: jest.fn(),
      addItemToCollection: jest.fn(),
      updateItemByIdInCollection: jest.fn(),
      removeItemFromCollection: jest.fn(),
      clearCollection: jest.fn(async () => {}),

      // change streams passthrough
      getChangeStream: jest.fn(),
    };
  }

  function makeClmMock() {
    return {
      addChangeListener: jest.fn(),
      removeChangeListener: jest.fn(),
      clearChangeListeners: jest.fn(),
    };
  }

  function installModuleMocks(dmp = makeDmMock(), clmp = makeClmMock()) {
    // DataManager singleton
    jest.doMock('../../data-manager/data-manager', () => ({
      __esModule: true,
      default: {
        getInstance: () => dmp,
      },
    }));

    // ChangeListener singleton
    jest.doMock('../../data-manager/change-listener.manager', () => ({
      __esModule: true,
      ChangeListenerManager: {
        getInstance: () => clmp,
      },
    }));

    // handleDbError: callable for assertions
    jest.doMock('../../data-manager/data-manager.helpers', () => {
      const impl = (message: string, method: string, error: unknown): never => {
        const err = error instanceof Error ? error : new Error(String(error ?? message));

        (err as any).dbMessage = message;
        (err as any).dbMethod = method;

        throw err;
      };

      return {
        __esModule: true,
        handleDbError: jest.fn(impl),
      };
    });

    return { dm: dmp, clm: clmp };
  }

  function loadSut() {
    let out!: {
      UserManager: (typeof import('../user-manager'))['UserManager'];
      TestingUserManager: (typeof import('../user-manager'))['TestingUserManager'];
      USERS: (typeof import('../../data-manager/data-manager.constants'))['USERS'];
      handleDbError: jest.Mock;
    };

    jest.isolateModules(() => {
      const userMod = require('../user-manager') as typeof import('../user-manager');
      const constants =
        require('../../data-manager/data-manager.constants') as typeof import('../../data-manager/data-manager.constants');
      const helpersMod = require('../../data-manager/data-manager.helpers') as any;

      out = {
        UserManager: userMod.UserManager,
        TestingUserManager: userMod.TestingUserManager,
        USERS: constants.USERS,
        handleDbError: helpersMod.handleDbError as jest.Mock,
      };
    });

    return out;
  }

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('init: initializes DM, ensures store/indexes, refreshes cache, and sets up change listeners', async () => {
    const dm = makeDmMock();
    const clm = makeClmMock();
    const { dm: dmm, clm: clmm } = installModuleMocks(dm, clm);

    const { UserManager, USERS } = loadSut();

    // Seed getAllInCollection for refreshCache (with _id -> id transform)
    dmm.getAllInCollection.mockResolvedValueOnce([
      { _id: 'u1', uniqueIdentifier: 'a', attributes: { x: 1 } },
    ]);

    await expect(UserManager.init()).resolves.toBeUndefined();

    expect(dmm.init).toHaveBeenCalledTimes(1);
    expect(dmm.ensureStore).toHaveBeenCalledWith(USERS);
    expect(dmm.ensureIndexes).toHaveBeenCalledWith(USERS, [
      { name: 'uniq_user_identifier', key: { uniqueIdentifier: 1 }, unique: true },
    ]);

    // Change listeners were registered for INSERT/UPDATE/DELETE
    expect(clmm.addChangeListener).toHaveBeenCalledTimes(3);
  });

  it('shutdown: removes all user change listeners', () => {
    const dm = makeDmMock();
    const clm = makeClmMock();
    installModuleMocks(dm, clm);

    const { UserManager, USERS } = loadSut();

    UserManager.shutdown();

    expect(clm.removeChangeListener).toHaveBeenCalledWith(USERS, expect.stringMatching(/INSERT/i));
    expect(clm.removeChangeListener).toHaveBeenCalledWith(USERS, expect.stringMatching(/UPDATE/i));
    expect(clm.removeChangeListener).toHaveBeenCalledWith(USERS, expect.stringMatching(/DELETE/i));
  });

  it('refreshCache: clears and repopulates cache with id transform', async () => {
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { TestingUserManager, USERS } = loadSut();

    // Ready state for _checkInitialization
    dm.getInitializationStatus.mockReturnValue(true);
    dm.getAllInCollection.mockResolvedValueOnce([
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
    expect(dm.getAllInCollection).toHaveBeenCalledWith(USERS);
  });

  it('addUser: validates payload and uniqueness; inserts and caches result', async () => {
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { UserManager, TestingUserManager, USERS } = loadSut();

    dm.getInitializationStatus.mockReturnValue(true);

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
    dm.addItemToCollection.mockResolvedValueOnce({
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
    expect(dm.addItemToCollection).toHaveBeenCalledWith(USERS, {
      uniqueIdentifier: 'new',
      attributes: { foo: 1 },
    });
    expect(TestingUserManager._users.get('n1')).toEqual(out);
  });

  it('addUser: on DM error calls handleDbError (throws)', async () => {
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { UserManager, handleDbError } = loadSut();

    dm.getInitializationStatus.mockReturnValue(true);
    dm.addItemToCollection.mockRejectedValueOnce(new Error('fail-insert'));

    await expect(
      UserManager.addUser({ uniqueIdentifier: 'x', initialAttributes: {} }),
    ).rejects.toThrow('fail-insert');

    expect(handleDbError).toHaveBeenCalledWith(
      'Failed to add users:',
      'addUser',
      expect.any(Error),
    );
  });

  it('addUsers: rejects on empty input; otherwise iterates addUser and returns successful inserts', async () => {
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { UserManager, TestingUserManager } = loadSut();

    await expect(UserManager.addUsers([] as any)).rejects.toThrow(
      'No users provided for insertion.',
    );

    dm.getInitializationStatus.mockReturnValue(true);

    // seed cache with one duplicate
    TestingUserManager._users.clear();
    TestingUserManager._users.set('dupid', {
      id: 'dupid',
      uniqueIdentifier: 'dup',
      attributes: {},
    } as any);

    dm.addItemToCollection
      .mockResolvedValueOnce({
        id: 'u1',
        uniqueIdentifier: 'a',
        attributes: {},
      })
      .mockResolvedValueOnce({
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

  it('getAllUsers returns cached list (requires init)', async () => {
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { TestingUserManager } = loadSut();

    dm.getInitializationStatus.mockReturnValue(true);
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
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { TestingUserManager } = loadSut();

    dm.getInitializationStatus.mockReturnValue(true);
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
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { TestingUserManager, USERS } = loadSut();

    dm.getInitializationStatus.mockReturnValue(true);
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'a',
      attributes: { a: 1, b: 1 },
    } as any);

    dm.updateItemByIdInCollection.mockResolvedValueOnce({
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

    expect(dm.updateItemByIdInCollection).toHaveBeenCalledWith(USERS, 'u1', {
      attributes: { a: 1, b: 2, c: 3 },
    });

    expect(TestingUserManager._users.get('u1')).toEqual(updated);
  });

  it('updateUserByUniqueIdentifier validates inputs and reroutes to updateUserById', async () => {
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { TestingUserManager } = loadSut();

    // invalid args
    await expect(TestingUserManager.updateUserByUniqueIdentifier('', { x: 1 })).rejects.toThrow(
      'Invalid uniqueIdentifier: ',
    );

    await expect(
      TestingUserManager.updateUserByUniqueIdentifier('u', {
        uniqueIdentifier: 'nope',
      } as any),
    ).rejects.toThrow('Cannot update uniqueIdentifier field using updateUserByUniqueIdentifier');

    await expect(TestingUserManager.updateUserByUniqueIdentifier('u', {} as any)).rejects.toThrow(
      'Invalid updateData',
    );

    // not found
    await expect(
      TestingUserManager.updateUserByUniqueIdentifier('missing', { a: 1 }),
    ).rejects.toThrow('User with uniqueIdentifier (missing) not found.');
  });

  it('modifyUserUniqueIdentifier validates and updates via DM; no-op if same value', async () => {
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { TestingUserManager, USERS } = loadSut();

    dm.getInitializationStatus.mockReturnValue(true);

    // invalid new value
    await expect(TestingUserManager.modifyUserUniqueIdentifier('old', '')).rejects.toThrow(
      'uniqueIdentifier must be a non-empty string.',
    );

    // not found
    await expect(TestingUserManager.modifyUserUniqueIdentifier('missing', 'new')).rejects.toThrow(
      'User with uniqueIdentifier (missing) not found.',
    );

    // no-op when same value
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'same',
      attributes: {},
    } as any);
    await expect(TestingUserManager.modifyUserUniqueIdentifier('same', 'same')).resolves.toEqual({
      id: 'u1',
      uniqueIdentifier: 'same',
      attributes: {},
    });

    // real update path
    dm.updateItemByIdInCollection.mockResolvedValueOnce({
      id: 'u1',
      uniqueIdentifier: 'new',
      attributes: {},
    });

    const updated = await TestingUserManager.modifyUserUniqueIdentifier('same', 'new');
    expect(updated).toEqual({
      id: 'u1',
      uniqueIdentifier: 'new',
      attributes: {},
    });
    expect(dm.updateItemByIdInCollection).toHaveBeenCalledWith(USERS, 'u1', {
      uniqueIdentifier: 'new',
    });
  });

  it('deleteUserById removes from DB and cache on success', async () => {
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { TestingUserManager, USERS } = loadSut();

    dm.getInitializationStatus.mockReturnValue(true);
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'a',
      attributes: {},
    } as any);

    dm.removeItemFromCollection.mockResolvedValueOnce(true);

    const ok = await TestingUserManager.deleteUserById('u1');
    expect(ok).toBe(true);
    expect(dm.removeItemFromCollection).toHaveBeenCalledWith(USERS, 'u1');
    expect(TestingUserManager._users.has('u1')).toBe(false);
  });

  it('deleteUserByUniqueIdentifier finds id then deletes via deleteUserById', async () => {
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { TestingUserManager } = loadSut();

    dm.getInitializationStatus.mockReturnValue(true);
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'uid-1',
      attributes: {},
    } as any);

    const dmRemove = jest.fn().mockResolvedValue(true);
    dm.removeItemFromCollection = dmRemove;

    const ok = await TestingUserManager.deleteUserByUniqueIdentifier('uid-1');
    expect(ok).toBe(true);
    expect(dmRemove).toHaveBeenCalled();
    expect(TestingUserManager._users.has('u1')).toBe(false);
  });

  it('deleteAllUsers clears DB and cache', async () => {
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { TestingUserManager, USERS } = loadSut();

    dm.getInitializationStatus.mockReturnValue(true);
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', { id: 'u1' } as any);

    await expect(TestingUserManager.deleteAllUsers()).resolves.toBeUndefined();
    expect(dm.clearCollection).toHaveBeenCalledWith(USERS);
    expect(TestingUserManager._users.size).toBe(0);
  });

  it('isIdentifierUnique validates input; returns false when exists; true otherwise', async () => {
    const dm = makeDmMock();
    installModuleMocks(dm, makeClmMock());

    const { TestingUserManager } = loadSut();

    await expect(TestingUserManager.isIdentifierUnique('')).rejects.toThrow(
      'Invalid unique identifier: ',
    );
    await expect(TestingUserManager.isIdentifierUnique('   ')).rejects.toThrow(
      'Invalid unique identifier',
    );

    // put a user in cache
    TestingUserManager._users.clear();
    TestingUserManager._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'exists',
      attributes: {},
    } as any);

    await expect(TestingUserManager.isIdentifierUnique('exists')).resolves.toBe(false);

    await expect(TestingUserManager.isIdentifierUnique('new-one')).resolves.toBe(true);
  });
});
