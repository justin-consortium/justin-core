import { MongoMemoryReplSet } from 'mongodb-memory-server';
import sinon from 'sinon';
import DataManager from '../../data-manager/data-manager';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import { USERS } from '../../data-manager/data-manager.constants';
import { loggerSpies } from '../../testing';
import { UserManager, TestingUserManager } from '../user-manager';
import type { JUser } from '../user.type';

describe('UserManager (integration)', () => {
  let repl: MongoMemoryReplSet;
  let uri: string;
  let dm: DataManager;
  let logs: ReturnType<typeof loggerSpies>;
  let sb: sinon.SinonSandbox;

  beforeAll(async () => {
    sb = sinon.createSandbox();
    logs = loggerSpies();

    repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = repl.getUri();

    const realInit = MongoDBManager.init.bind(MongoDBManager);
    sb.stub(MongoDBManager, 'init').callsFake(() => realInit(uri, 'user-manager-int-test'));

    dm = DataManager.getInstance();
    await dm.init();

    await UserManager.init();
  });

  afterAll(async () => {
    try {
      UserManager.shutdown();
    } catch {}

    await dm.close();
    await repl.stop();

    logs.restore();
    sb.restore();
  });

  beforeEach(async () => {
    // reset DB + cache between tests
    await dm.ensureStore(USERS);
    await dm.clearCollection(USERS);

    TestingUserManager._users.clear();
    await TestingUserManager.refreshCache();
  });

  it('init: ensures USERS + unique index, refreshes cache, and sets up listeners (smoke)', async () => {
    // init already called in beforeAll, but this is idempotent
    await expect(UserManager.init()).resolves.toBeUndefined();

    // with an empty DB, cache should be empty after refreshCache
    expect(TestingUserManager._users.size).toBe(0);
  });

  it('addUser: inserts a flattened user record and caches it', async () => {
    const created = await UserManager.addUser({
      uniqueIdentifier: 'u-1',
      initialAttributes: { name: 'Alice', role: 'admin', nested: { ok: true } },
    });

    expect(created).not.toBeNull();
    expect(created!.id).toEqual(expect.any(String));
    expect(created).toMatchObject({
      uniqueIdentifier: 'u-1',
      name: 'Alice',
      role: 'admin',
      nested: { ok: true },
    });

    // cache
    expect(TestingUserManager._users.get(created!.id)).toEqual(created);

    // DB read-back
    const all = await dm.getAllInCollection<JUser>(USERS);
    expect(all.length).toBe(1);
    expect(all[0]).toMatchObject({
      uniqueIdentifier: 'u-1',
      name: 'Alice',
      role: 'admin',
    });
    // No attributes field anymore; this catches regressions.
    expect((all[0] as any).attributes).toBeUndefined();
  });

  it('addUser: returns null for duplicate uniqueIdentifier (via cache uniqueness)', async () => {
    const a = await UserManager.addUser({
      uniqueIdentifier: 'dup',
      initialAttributes: { a: 1 },
    });
    expect(a).not.toBeNull();

    const b = await UserManager.addUser({
      uniqueIdentifier: 'dup',
      initialAttributes: { a: 2 },
    });
    expect(b).toBeNull();

    const all = await dm.getAllInCollection<JUser>(USERS);
    expect(all.length).toBe(1);
    expect(all[0]).toMatchObject({ uniqueIdentifier: 'dup', a: 1 });
  });

  it('addUsers: returns only successfully added users (skips duplicates)', async () => {
    const res = await UserManager.addUsers([
      { uniqueIdentifier: 'a', initialAttributes: { score: 1 } },
      { uniqueIdentifier: 'a', initialAttributes: { score: 2 } }, // dup -> skipped
      { uniqueIdentifier: 'b', initialAttributes: { score: 3 } },
    ]);

    expect(res.map((u) => u.uniqueIdentifier).sort()).toEqual(['a', 'b']);

    const all = await dm.getAllInCollection<JUser>(USERS);
    expect(all.map((u) => u.uniqueIdentifier).sort()).toEqual(['a', 'b']);
  });

  it('getAllUsers + getUserByUniqueIdentifier read from cache', async () => {
    await UserManager.addUser({
      uniqueIdentifier: 'u-1',
      initialAttributes: { name: 'Alice' },
    });
    await UserManager.addUser({
      uniqueIdentifier: 'u-2',
      initialAttributes: { name: 'Bob' },
    });

    const all = UserManager.getAllUsers();
    expect(all.length).toBe(2);

    const u1 = UserManager.getUserByUniqueIdentifier('u-1');
    expect(u1).toMatchObject({ uniqueIdentifier: 'u-1', name: 'Alice' });

    const missing = UserManager.getUserByUniqueIdentifier('nope');
    expect(missing).toBeNull();
  });

  it('updateUserByUniqueIdentifier: updates fields and does not allow uniqueIdentifier overwrite', async () => {
    const created = await UserManager.addUser({
      uniqueIdentifier: 'u-1',
      initialAttributes: { a: 1, b: 1 },
    });
    expect(created).not.toBeNull();

    const updated = await UserManager.updateUserByUniqueIdentifier('u-1', { b: 2, c: 3 });
    expect(updated).not.toBeNull();

    expect(updated).toMatchObject({
      id: created!.id,
      uniqueIdentifier: 'u-1',
      a: 1,
      b: 2,
      c: 3,
    });

    // ensure it actually persisted
    const all = await dm.getAllInCollection<JUser>(USERS);
    expect(all[0]).toMatchObject({ uniqueIdentifier: 'u-1', a: 1, b: 2, c: 3 });

    // attempting to change uniqueIdentifier through updateUserByUniqueIdentifier should throw
    await expect(
      UserManager.updateUserByUniqueIdentifier('u-1', { uniqueIdentifier: 'nope' } as any),
    ).rejects.toThrow('Cannot update uniqueIdentifier field using updateUserByUniqueIdentifier');
  });

  it('modifyUserUniqueIdentifier: updates uniqueIdentifier and cache', async () => {
    const created = await UserManager.addUser({
      uniqueIdentifier: 'old',
      initialAttributes: { x: 1 },
    });
    expect(created).not.toBeNull();

    const updated = await UserManager.modifyUserUniqueIdentifier('old', 'new');
    expect(updated).toMatchObject({
      id: created!.id,
      uniqueIdentifier: 'new',
      x: 1,
    });

    // cache lookup by new id works
    const byNew = UserManager.getUserByUniqueIdentifier('new');
    expect(byNew).toMatchObject({ id: created!.id, uniqueIdentifier: 'new' });

    // old no longer exists
    expect(UserManager.getUserByUniqueIdentifier('old')).toBeNull();

    // DB read-back
    const all = await dm.getAllInCollection<JUser>(USERS);
    expect(all[0]).toMatchObject({ uniqueIdentifier: 'new', x: 1 });
  });

  it('deleteUserByUniqueIdentifier: deletes from DB and cache', async () => {
    const created = await UserManager.addUser({
      uniqueIdentifier: 'u-1',
      initialAttributes: { x: 1 },
    });
    expect(created).not.toBeNull();

    const ok = await UserManager.deleteUserByUniqueIdentifier('u-1');
    expect(ok).toBe(true);

    expect(UserManager.getUserByUniqueIdentifier('u-1')).toBeNull();
    expect(TestingUserManager._users.has(created!.id)).toBe(false);

    const all = await dm.getAllInCollection<JUser>(USERS);
    expect(all).toEqual([]);
  });

  it('deleteAllUsers: clears DB and cache', async () => {
    await UserManager.addUser({ uniqueIdentifier: 'a', initialAttributes: { x: 1 } });
    await UserManager.addUser({ uniqueIdentifier: 'b', initialAttributes: { x: 2 } });

    expect(UserManager.getAllUsers().length).toBe(2);

    await expect(UserManager.deleteAllUsers()).resolves.toBeUndefined();

    expect(UserManager.getAllUsers()).toEqual([]);
    const all = await dm.getAllInCollection<JUser>(USERS);
    expect(all).toEqual([]);
  });

  it('refreshCache: repopulates cache from DB', async () => {
    // write directly via dm to simulate “cold start” / cache miss
    const inserted = await dm.addItemToCollection(USERS, {
      uniqueIdentifier: 'u-1',
      name: 'Alice',
    });
    expect(inserted).not.toBeNull();

    // cache is currently empty
    TestingUserManager._users.clear();
    expect(UserManager.getAllUsers()).toEqual([]);

    await TestingUserManager.refreshCache();

    const u1 = UserManager.getUserByUniqueIdentifier('u-1');
    expect(u1).toMatchObject({ uniqueIdentifier: 'u-1', name: 'Alice' });
  });
});
