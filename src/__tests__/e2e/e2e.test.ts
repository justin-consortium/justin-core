/**
 * @just-in/core public API e2e
 *
 * Goals:
 * - Exercise the same APIs a 3rd-party developer would use (DataManager + UserManager).
 * - Use MongoMemoryReplSet as real infrastructure.
 * - Ensure teardown is reliable (no hangs, no “not initialized” throws).
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import sinon from 'sinon';

import DataManager, { DBType, USERS, UserManager, shutdownCore } from '../../index';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import { loggerSpies } from '../testkit/logger.spies';

jest.setTimeout(120_000);

describe('@just-in/core public API e2e', () => {
  let repl: MongoMemoryReplSet;
  let dm: ReturnType<typeof DataManager.getInstance>;
  let logs: ReturnType<typeof loggerSpies>;
  let sb: sinon.SinonSandbox;

  beforeAll(async () => {
    sb = sinon.createSandbox();
    logs = loggerSpies();

    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });

    const uri = repl.getUri();

    // NOTE:
    // DataManager.init() calls MongoDBManager.init() with no args.
    // MongoDBManager.init() currently defaults to DEFAULT_MONGO_URI (127.0.0.1:27017),
    // so we stub it here to force the replset URI in e2e.
    const realInit = MongoDBManager.init.bind(MongoDBManager);
    sb.stub(MongoDBManager, 'init').callsFake((conn?: string, dbName?: string) => {
      return realInit(uri, 'core-public-e2e');
    });

    dm = DataManager.getInstance();
    await dm.init(DBType.MONGO);
    await dm.ensureStore(USERS);

    await UserManager.init();
  });

  beforeEach(async () => {
    await dm.clearCollection(USERS);
  });

  afterAll(async () => {
    // Teardown should never throw.
    try {
      // Prefer the single helper if present.
      try {
        if (typeof shutdownCore === 'function') {
          await shutdownCore();
        } else {
          // Fallback: shut down higher-level managers first
          try {
            UserManager.shutdown();
          } catch {}

          try {
            if (dm?.getInitializationStatus?.() === true) {
              await dm.close();
            }
          } catch {}
        }
      } catch {}

      try {
        if (repl) await repl.stop();
      } catch {}
    } finally {
      try {
        logs?.restore();
      } catch {}
      try {
        sb?.restore();
      } catch {}
    }
  });

  it('end-to-end user lifecycle: create -> read -> update -> delete', async () => {
    const created = await UserManager.addUser({
      uniqueIdentifier: 'e2e-u1',
      initialAttributes: { mood: 'ok', count: 1 },
    });

    expect(created).not.toBeNull();
    expect(created!.id).toEqual(expect.any(String));
    expect(created).toMatchObject({
      uniqueIdentifier: 'e2e-u1',
      attributes: { mood: 'ok', count: 1 },
    });

    const createdId = created!.id;
    const createdUniqueIdentifier = created!.uniqueIdentifier;

    // Read (DB-level invariant): record exists and uses `id` not `_id`
    const allFromDb = await dm.getAllInCollection<any>(USERS);
    expect(allFromDb).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdId,
          uniqueIdentifier: createdUniqueIdentifier,
        }),
      ]),
    );

    // Update (public API)
    const updated = await UserManager.updateUserByUniqueIdentifier(createdUniqueIdentifier, {
      count: 2,
    });

    expect(updated).not.toBeNull();
    expect(updated).toMatchObject({
      id: createdId,
      uniqueIdentifier: createdUniqueIdentifier,
      attributes: { mood: 'ok', count: 2 },
    });

    // Delete (public API)
    const deletedOk = await UserManager.deleteUserByUniqueIdentifier(createdUniqueIdentifier);
    expect(deletedOk).toBe(true);

    const afterDelete = await dm.getAllInCollection<any>(USERS);
    expect((afterDelete ?? []).some((u: any) => u.id === createdId)).toBe(false);
  });

  it('supports bulk creation and DB reflects all users', async () => {
    const added = await UserManager.addUsers([
      { uniqueIdentifier: 'bulk-1', initialAttributes: { foo: 1 } },
      { uniqueIdentifier: 'bulk-2', initialAttributes: { bar: 2 } },
    ]);

    expect(added).toHaveLength(2);
    expect(added).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uniqueIdentifier: 'bulk-1', id: expect.any(String) }),
        expect.objectContaining({ uniqueIdentifier: 'bulk-2', id: expect.any(String) }),
      ]),
    );

    const allFromDb = await dm.getAllInCollection<any>(USERS);
    expect(allFromDb).not.toBeNull();
    expect(allFromDb!.length).toBe(2);
  });

  it('rehydrates correctly after a “restart” (cache rebuild scenario)', async () => {
    const added = await UserManager.addUsers([
      { uniqueIdentifier: 'rehydrate-1', initialAttributes: { a: 1 } },
      { uniqueIdentifier: 'rehydrate-2', initialAttributes: { b: 2 } },
    ]);

    expect(added).toHaveLength(2);

    // Simulate restart: shutdown only the UserManager layer, keep DB up
    UserManager.shutdown();
    await UserManager.init();

    const allFromDb = await dm.getAllInCollection<any>(USERS);
    expect(allFromDb).not.toBeNull();
    expect(allFromDb!.length).toBe(2);
    expect(allFromDb).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uniqueIdentifier: 'rehydrate-1' }),
        expect.objectContaining({ uniqueIdentifier: 'rehydrate-2' }),
      ]),
    );
  });

  it('logs a warning for invalid user input (negative path sanity)', async () => {
    // @ts-expect-error intentional invalid input
    await UserManager.addUser(null);

    const warns = logs.captured.filter((c) => c.entry.severity === 'WARNING');
    expect(warns.length).toBeGreaterThan(0);
  });

  it('never leaks Mongo _id to callers (id normalization invariant)', async () => {
    const created = await UserManager.addUser({
      uniqueIdentifier: 'no-_id',
      initialAttributes: { ok: true },
    });

    expect(created).not.toBeNull();
    expect((created as any)._id).toBeUndefined();
    expect(created!.id).toEqual(expect.any(String));

    const all = await dm.getAllInCollection<any>(USERS);
    const row = all!.find((u: any) => u.uniqueIdentifier === 'no-_id');

    expect(row).toBeTruthy();
    expect(row._id).toBeUndefined();
    expect(row.id).toEqual(expect.any(String));
  });
});
