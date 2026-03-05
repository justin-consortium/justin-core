import sinon from 'sinon';
import { makeCoreManagersSandbox, type CoreManagersSandbox } from '../../testing';
import DataManager from '../../data-manager/data-manager';
import { PROTECTED_ATTRIBUTES, USERS } from '../../data-manager/data-manager.constants';
import { CollectionChangeType } from '../../data-manager/data-manager.type';
import { UserManager, TestingUserManager } from '../user-manager';
import { __testing__usersCache } from '../users/user-cache';
import { __testing__protectedAttributesCache } from '../protected-attributes/protected-attributes-cache';

describe('UserManager (unit)', () => {
  let cm: CoreManagersSandbox;
  let dm: ReturnType<typeof DataManager.getInstance>;

  beforeEach(() => {
    cm = makeCoreManagersSandbox();
    dm = cm.dm;

    // Reset in-memory caches
    TestingUserManager.clearUsersCache();
    TestingUserManager.clearProtectedAttributesCache();
  });

  afterEach(() => {
    cm.restore();
  });

  it('init: initializes DM, ensures stores/indexes, refreshes caches, and sets up change listeners', async () => {
    // arrange docs for refreshUsersCache + refreshProtectedAttributesCache
    (dm.getAllInCollection as sinon.SinonStub)
      .onFirstCall()
      .resolves([{ id: 'u1', uniqueIdentifier: 'test-1', preferredWakeUpTime: '07:00' }])
      .onSecondCall()
      .resolves([
        {
          id: 'pa1',
          uniqueIdentifier: 'test-1',
          namespace: 'pii',
          protectedAttributes: { email: 'x@example.com' },
        },
      ]);

    await expect(UserManager.init()).resolves.toBeUndefined();

    sinon.assert.calledOnce(dm.init as sinon.SinonStub);

    sinon.assert.calledWith(dm.ensureStore as sinon.SinonStub, USERS);
    sinon.assert.calledWith(dm.ensureIndexes as sinon.SinonStub, USERS, [
      { name: 'uniq_user_identifier', key: { uniqueIdentifier: 1 }, unique: true },
    ]);

    sinon.assert.calledWith(dm.ensureStore as sinon.SinonStub, PROTECTED_ATTRIBUTES);
    sinon.assert.calledWith(dm.ensureIndexes as sinon.SinonStub, PROTECTED_ATTRIBUTES, [
      {
        name: 'uniq_protected_attributes_identifier_namespace',
        key: { uniqueIdentifier: 1, namespace: 1 },
        unique: true,
      },
    ]);

    // Cache refreshes executed
    sinon.assert.calledWith(dm.getAllInCollection as sinon.SinonStub, USERS);
    sinon.assert.calledWith(dm.getAllInCollection as sinon.SinonStub, PROTECTED_ATTRIBUTES);

    // Change listeners registered for USERS (3) + PROTECTED_ATTRIBUTES (3)
    sinon.assert.callCount(cm.clm.addChangeListener as sinon.SinonStub, 6);
  });

  it('shutdown: removes all change listeners', () => {
    UserManager.shutdown();

    // We expect both collections to have their INSERT/UPDATE/DELETE listeners removed.
    sinon.assert.calledWith(
      cm.clm.removeChangeListener as sinon.SinonStub,
      USERS,
      CollectionChangeType.INSERT,
    );
    sinon.assert.calledWith(
      cm.clm.removeChangeListener as sinon.SinonStub,
      USERS,
      CollectionChangeType.UPDATE,
    );
    sinon.assert.calledWith(
      cm.clm.removeChangeListener as sinon.SinonStub,
      USERS,
      CollectionChangeType.DELETE,
    );

    sinon.assert.calledWith(
      cm.clm.removeChangeListener as sinon.SinonStub,
      PROTECTED_ATTRIBUTES,
      CollectionChangeType.INSERT,
    );
    sinon.assert.calledWith(
      cm.clm.removeChangeListener as sinon.SinonStub,
      PROTECTED_ATTRIBUTES,
      CollectionChangeType.UPDATE,
    );
    sinon.assert.calledWith(
      cm.clm.removeChangeListener as sinon.SinonStub,
      PROTECTED_ATTRIBUTES,
      CollectionChangeType.DELETE,
    );
  });

  it('refreshUsersCache: clears and repopulates cache', async () => {
    (dm.getAllInCollection as sinon.SinonStub).resolves([
      { id: 'x1', uniqueIdentifier: 'test-1', preferredWakeUpTime: '07:00' },
      { id: 'x2', uniqueIdentifier: 'test-2', preferredBedtime: '22:30' },
    ]);

    await TestingUserManager.refreshUsersCache();

    expect(__testing__usersCache._users.size).toBe(2);
    expect(__testing__usersCache._users.get('x1')).toEqual({
      id: 'x1',
      uniqueIdentifier: 'test-1',
      preferredWakeUpTime: '07:00',
    });
    expect(__testing__usersCache._users.get('x2')).toEqual({
      id: 'x2',
      uniqueIdentifier: 'test-2',
      preferredBedtime: '22:30',
    });

    sinon.assert.calledWith(dm.getAllInCollection as sinon.SinonStub, USERS);
  });

  it('refreshProtectedAttributesCache: clears and repopulates cache', async () => {
    (dm.getAllInCollection as sinon.SinonStub).resolves([
      {
        id: 'pa1',
        uniqueIdentifier: 'test-1',
        namespace: 'pii',
        protectedAttributes: { email: 'x@example.com' },
      },
      {
        id: 'pa2',
        uniqueIdentifier: 'test-1',
        namespace: 'fitbit',
        protectedAttributes: { accessToken: 'tok', refreshToken: 'ref' },
      },
    ]);

    await TestingUserManager.refreshProtectedAttributesCache();

    const byNs = __testing__protectedAttributesCache._protectedAttributes.get('test-1');
    expect(byNs?.get('pii')).toMatchObject({ id: 'pa1', namespace: 'pii' });
    expect(byNs?.get('fitbit')).toMatchObject({ id: 'pa2', namespace: 'fitbit' });

    sinon.assert.calledWith(dm.getAllInCollection as sinon.SinonStub, PROTECTED_ATTRIBUTES);
  });

  it('createUser: validates input; enforces uniqueness; inserts user; best-effort creates protected attributes', async () => {
    // invalid shapes -> null
    await expect(UserManager.createUser(null as any)).resolves.toBeNull();
    await expect(UserManager.createUser({} as any)).resolves.toBeNull();
    await expect(
      UserManager.createUser({ uniqueIdentifier: 'test-1', attributes: null } as any),
    ).resolves.toBeNull();

    // seed cache with an existing user (duplicate uniqueIdentifier)
    __testing__usersCache._users.set('u1', { id: 'u1', uniqueIdentifier: 'test-dup' } as any);
    __testing__usersCache._userIdByUniqueIdentifier.set('test-dup', 'u1');

    await expect(
      UserManager.createUser({ uniqueIdentifier: 'test-dup', attributes: {} }),
    ).resolves.toBeNull();

    // success path:
    // - USERS insert
    // - PROTECTED_ATTRIBUTES: for each namespace, findItems ([]) then addItem
    (dm.addItemToCollection as sinon.SinonStub)
      .onFirstCall()
      .resolves({
        id: 'n1',
        uniqueIdentifier: 'test-1',
        preferredWakeUpTime: '07:00',
        preferredBedtime: '22:30',
      })
      .onSecondCall()
      .resolves({
        id: 'pa1',
        uniqueIdentifier: 'test-1',
        namespace: 'pii',
        protectedAttributes: { email: 'x@example.com' },
      });

    (dm.findItemsInCollection as sinon.SinonStub).resolves([]);

    const out = await UserManager.createUser({
      uniqueIdentifier: 'test-1',
      attributes: {
        preferredWakeUpTime: '07:00',
        preferredBedtime: '22:30',
      },
      protectedAttributes: [
        { namespace: 'pii', protectedAttributes: { email: 'x@example.com' } },
      ],
    });

    expect(out).toEqual({
      id: 'n1',
      uniqueIdentifier: 'test-1',
      preferredWakeUpTime: '07:00',
      preferredBedtime: '22:30',
    });

    sinon.assert.calledWith(dm.addItemToCollection as sinon.SinonStub, USERS, {
      uniqueIdentifier: 'test-1',
      preferredWakeUpTime: '07:00',
      preferredBedtime: '22:30',
    });

    sinon.assert.calledWith(dm.findItemsInCollection as sinon.SinonStub, PROTECTED_ATTRIBUTES, {
      uniqueIdentifier: 'test-1',
      namespace: 'pii',
    });

    sinon.assert.calledWith(dm.addItemToCollection as sinon.SinonStub, PROTECTED_ATTRIBUTES, {
      uniqueIdentifier: 'test-1',
      namespace: 'pii',
      protectedAttributes: { email: 'x@example.com' },
    });

    // cached user
    expect(__testing__usersCache._users.get('n1')).toEqual(out);

    // cached protected attributes
    const paMap = __testing__protectedAttributesCache._protectedAttributes.get('test-1');
    expect(paMap?.get('pii')).toMatchObject({
      id: 'pa1',
      uniqueIdentifier: 'test-1',
      namespace: 'pii',
      protectedAttributes: { email: 'x@example.com' },
    });
  });

  it('createUsers: rejects on empty input; otherwise iterates createUser and returns successful inserts', async () => {
    await expect(UserManager.createUsers([] as any)).rejects.toThrow('No users provided for insertion.');

    (dm.addItemToCollection as sinon.SinonStub)
      .onFirstCall()
      .resolves({ id: 'u1', uniqueIdentifier: 'test-1', preferredWakeUpTime: '07:00' })
      .onSecondCall()
      .resolves({ id: 'u2', uniqueIdentifier: 'test-2', preferredWakeUpTime: '06:45' });

    const res = await UserManager.createUsers([
      { uniqueIdentifier: 'test-1', attributes: { preferredWakeUpTime: '07:00' } },
      { uniqueIdentifier: 'test-2', attributes: { preferredWakeUpTime: '06:45' } },
    ]);

    expect(res).toEqual([
      { id: 'u1', uniqueIdentifier: 'test-1', preferredWakeUpTime: '07:00' },
      { id: 'u2', uniqueIdentifier: 'test-2', preferredWakeUpTime: '06:45' },
    ]);
  });

  it('getAllUsers returns cached list', () => {
    __testing__usersCache._users.set('x', { id: 'x', uniqueIdentifier: 'test-1' } as any);
    __testing__usersCache._userIdByUniqueIdentifier.set('test-1', 'x');

    expect(UserManager.getAllUsers()).toEqual([{ id: 'x', uniqueIdentifier: 'test-1' }]);
  });

  it('getUserByUniqueIdentifier finds a user or null', () => {
    __testing__usersCache._users.set('a', { id: 'a', uniqueIdentifier: 'test-1' } as any);
    __testing__usersCache._userIdByUniqueIdentifier.set('test-1', 'a');

    expect(UserManager.getUserByUniqueIdentifier('test-1')).toEqual({
      id: 'a',
      uniqueIdentifier: 'test-1',
    });
    expect(UserManager.getUserByUniqueIdentifier('nope')).toBeNull();
  });

  it('updateUserById merges data, writes via DM, updates cache', async () => {
    __testing__usersCache._users.set('u1', {
      id: 'u1',
      uniqueIdentifier: 'test-1',
      preferredWakeUpTime: '07:00',
      preferredBedtime: '22:30',
    } as any);
    __testing__usersCache._userIdByUniqueIdentifier.set('test-1', 'u1');

    (dm.updateItemByIdInCollection as sinon.SinonStub).resolves({
      id: 'u1',
      uniqueIdentifier: 'test-1',
      preferredWakeUpTime: '06:30',
      preferredBedtime: '22:30',
    });

    const updated = await UserManager.updateUserById('u1', {
      preferredWakeUpTime: '06:30',
    });

    expect(updated).toEqual({
      id: 'u1',
      uniqueIdentifier: 'test-1',
      preferredWakeUpTime: '06:30',
      preferredBedtime: '22:30',
    });

    sinon.assert.calledWith(dm.updateItemByIdInCollection as sinon.SinonStub, USERS, 'u1', {
      preferredWakeUpTime: '06:30',
      preferredBedtime: '22:30',
    });

    expect(__testing__usersCache._users.get('u1')).toEqual(updated);
  });

  it('updateUserByUniqueIdentifier returns null when not found; throws when attempting to update reserved fields', async () => {
    await expect(UserManager.updateUserByUniqueIdentifier('missing', { x: 1 } as any)).resolves.toBeNull();

    __testing__usersCache._users.set('u1', { id: 'u1', uniqueIdentifier: 'test-1' } as any);
    __testing__usersCache._userIdByUniqueIdentifier.set('test-1', 'u1');

    await expect(
      UserManager.updateUserByUniqueIdentifier('test-1', { uniqueIdentifier: 'nope' } as any),
    ).rejects.toThrow();
  });

  it('deleteUserById: deletes protected attributes (cascade) then user; returns true on success', async () => {
    // seed cache
    __testing__usersCache._users.set('u1', { id: 'u1', uniqueIdentifier: 'test-1' } as any);
    __testing__usersCache._userIdByUniqueIdentifier.set('test-1', 'u1');

    // protected docs exist
    (dm.findItemsInCollection as sinon.SinonStub).resolves([
      { id: 'pa1', uniqueIdentifier: 'test-1', namespace: 'pii', protectedAttributes: {} },
      { id: 'pa2', uniqueIdentifier: 'test-1', namespace: 'fitbit', protectedAttributes: {} },
    ]);

    // remove protected docs + remove user doc
    (dm.removeItemFromCollection as sinon.SinonStub)
      .onFirstCall()
      .resolves(true) // pa1
      .onSecondCall()
      .resolves(true) // pa2
      .onThirdCall()
      .resolves(true); // user u1

    // refreshUsersCache after deletion
    (dm.getAllInCollection as sinon.SinonStub).resolves([]);

    const ok = await UserManager.deleteUserById('u1');
    expect(ok).toBe(true);

    sinon.assert.calledWith(dm.findItemsInCollection as sinon.SinonStub, PROTECTED_ATTRIBUTES, {
      uniqueIdentifier: 'test-1',
    });

    sinon.assert.calledWith(dm.removeItemFromCollection as sinon.SinonStub, PROTECTED_ATTRIBUTES, 'pa1');
    sinon.assert.calledWith(dm.removeItemFromCollection as sinon.SinonStub, PROTECTED_ATTRIBUTES, 'pa2');
    sinon.assert.calledWith(dm.removeItemFromCollection as sinon.SinonStub, USERS, 'u1');
  });

  it('deleteUserByUniqueIdentifier finds id then deletes via deleteUserById', async () => {
    __testing__usersCache._users.set('u1', { id: 'u1', uniqueIdentifier: 'test-1' } as any);
    __testing__usersCache._userIdByUniqueIdentifier.set('test-1', 'u1');

    (dm.findItemsInCollection as sinon.SinonStub).resolves([]);
    (dm.removeItemFromCollection as sinon.SinonStub).resolves(true);
    (dm.getAllInCollection as sinon.SinonStub).resolves([]);

    const ok = await UserManager.deleteUserByUniqueIdentifier('test-1');
    expect(ok).toBe(true);

    sinon.assert.calledWith(dm.removeItemFromCollection as sinon.SinonStub, USERS, 'u1');
  });

  it('deleteAllUsers clears both collections and clears caches', async () => {
    __testing__usersCache._users.set('u1', { id: 'u1', uniqueIdentifier: 'test-1' } as any);
    __testing__usersCache._userIdByUniqueIdentifier.set('test-1', 'u1');

    __testing__protectedAttributesCache._protectedAttributes.set(
      'test-1',
      new Map([['pii', { id: 'pa1', uniqueIdentifier: 'test-1', namespace: 'pii', protectedAttributes: {} } as any]]),
    );

    await expect(UserManager.deleteAllUsers()).resolves.toBeUndefined();

    sinon.assert.calledWith(dm.clearCollection as sinon.SinonStub, USERS);
    sinon.assert.calledWith(dm.clearCollection as sinon.SinonStub, PROTECTED_ATTRIBUTES);

    expect(__testing__usersCache._users.size).toBe(0);
    expect(__testing__usersCache._userIdByUniqueIdentifier.size).toBe(0);
    expect(__testing__protectedAttributesCache._protectedAttributes.size).toBe(0);
  });

  it('isIdentifierUnique validates input; returns false when exists; true otherwise', async () => {
    await expect(UserManager.isIdentifierUnique('' as any)).rejects.toThrow();
    await expect(UserManager.isIdentifierUnique('   ' as any)).rejects.toThrow();

    __testing__usersCache._users.set('u1', { id: 'u1', uniqueIdentifier: 'test-exists' } as any);
    __testing__usersCache._userIdByUniqueIdentifier.set('test-exists', 'u1');

    await expect(UserManager.isIdentifierUnique('test-exists')).resolves.toBe(false);
    await expect(UserManager.isIdentifierUnique('test-new')).resolves.toBe(true);
  });
});
