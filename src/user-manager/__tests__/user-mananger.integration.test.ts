/**
 * UserManager integration tests.
 *
 * Verifies collaboration between internal components:
 *   - cache refresh functions loading from real DB
 *   - PA crud functions (called directly, not through UserManager)
 *   - change listener pipeline (Mongo → ChangeListenerManager → cache)
 *   - shutdownCore lifecycle wiring
 *   - DB / cache agreement after mutations and restarts
 *
 * These tests use real Mongo (MongoMemoryReplSet) and import internal
 * modules directly. They do not call the UserManager public API.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import sinon from 'sinon';

import { configureDB, shutdownCore, clearManagerRegistry } from '../../lifecycle';
import {
  DataManager,
  DBType,
  ChangeListenerManager,
  CollectionChangeTypeEnum,
} from '../../data-manager';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import { USERS, PROTECTED_ATTRIBUTES } from '../constants';
import { waitForMongoReady, silenceLogger, expectOk, waitForCondition } from '../../testing';
import { JustinErrorCode } from '../../errors';

// Internal cache functions
import {
  refreshUsersCache,
  clearUsersCache,
  upsertUserInCache,
  getAllUsersFromCache,
  getUserByIdFromCache,
  getUserByUniqueIdentifierFromCache,
} from '../users/cache';
import {
  refreshProtectedAttributesCache,
  clearProtectedAttributesCache,
  getAllProtectedAttributesByUniqueIdentifier,
  getProtectedAttributesByUniqueIdentifier,
} from '../protected-attributes/cache';

// Internal crud functions
import {
  setProtectedAttributes,
  setProtectedAttributeKeysByNamespace,
  deleteProtectedAttributeNamespaces,
  deleteAllProtectedAttributes,
  deleteProtectedAttributeKeysByNamespace,
  getAllProtectedAttributes,
} from '../protected-attributes/crud';

// Internal listener functions
import { setupUserChangeListeners, removeUserChangeListeners } from '../users/listeners';
import {
  setupProtectedAttributesChangeListeners,
  removeProtectedAttributesChangeListeners,
} from '../protected-attributes/listeners';

import type { JUser, ProtectedAttributesRecord } from '../types';

jest.setTimeout(120_000);

// ---------------------------------------------------------------------------
// Shared infrastructure
// ---------------------------------------------------------------------------

let repl: MongoMemoryReplSet;
let dm: DataManager;
let sb: sinon.SinonSandbox;
let silenceLogs: { restore: () => void };

beforeAll(async () => {
  silenceLogs = silenceLogger();
  sb = sinon.createSandbox();

  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = repl.getUri();
  await waitForMongoReady(uri);

  const realInit = MongoDBManager.init.bind(MongoDBManager);
  sb.stub(MongoDBManager, 'init').callsFake(() => realInit(uri, 'user-manager-integration'));

  configureDB({ dbType: DBType.MONGO, uri });
  dm = DataManager.getInstance();
  await dm.init();

  // Ensure collections and indexes exist (mirrors UserManager.init internals)
  await dm.ensureStore(USERS);
  await dm.ensureIndexes(USERS, [
    { name: 'uniq_user_identifier', key: { uniqueIdentifier: 1 }, unique: true },
  ]);
  await dm.ensureStore(PROTECTED_ATTRIBUTES);
  await dm.ensureIndexes(PROTECTED_ATTRIBUTES, [
    {
      name: 'uniq_protected_attributes_identifier_namespace',
      key: { uniqueIdentifier: 1, namespace: 1 },
      unique: true,
    },
  ]);
});

afterAll(async () => {
  try {
    await dm.close();
  } catch {}
  try {
    await repl.stop();
  } catch {}
  try {
    sb.restore();
  } catch {}
  silenceLogs.restore();
});

beforeEach(async () => {
  clearUsersCache();
  clearProtectedAttributesCache();
  await dm.clearCollection(USERS);
  await dm.clearCollection(PROTECTED_ATTRIBUTES);
});

// Write directly to Mongo bypassing UserManager entirely
async function insertRawUser(
  uniqueIdentifier: string,
  extra: Record<string, any> = {},
): Promise<JUser> {
  const result = await dm.addItemToCollection<any>(USERS, { uniqueIdentifier, ...extra });
  return expectOk(result) as unknown as JUser;
}

async function insertRawPA(
  uniqueIdentifier: string,
  namespace: string,
  protectedAttributes: Record<string, any>,
): Promise<ProtectedAttributesRecord> {
  const result = await dm.addItemToCollection<any>(PROTECTED_ATTRIBUTES, {
    uniqueIdentifier,
    namespace,
    protectedAttributes,
  });
  return expectOk(result) as unknown as ProtectedAttributesRecord;
}

// ---------------------------------------------------------------------------
// refreshUsersCache
// ---------------------------------------------------------------------------

describe('refreshUsersCache', () => {
  it('loads all users from DB into cache', async () => {
    await insertRawUser('alice', { score: 10 });
    await insertRawUser('bob', { score: 20 });

    await refreshUsersCache();

    const users = getAllUsersFromCache();
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.uniqueIdentifier).sort()).toEqual(['alice', 'bob']);
  });

  it('makes users findable by id and uniqueIdentifier after load', async () => {
    const raw = await insertRawUser('alice');

    await refreshUsersCache();

    expect(getUserByIdFromCache(raw.id)).not.toBeNull();
    expect(getUserByUniqueIdentifierFromCache('alice')).not.toBeNull();
  });

  it('replaces stale cache state on re-call', async () => {
    await insertRawUser('alice');
    await refreshUsersCache();
    expect(getAllUsersFromCache()).toHaveLength(1);

    await dm.clearCollection(USERS);
    await insertRawUser('bob');
    await refreshUsersCache();

    const users = getAllUsersFromCache();
    expect(users).toHaveLength(1);
    expect(users[0].uniqueIdentifier).toBe('bob');
  });

  it('results in empty cache when DB is empty', async () => {
    upsertUserInCache({ id: 'stale', uniqueIdentifier: 'stale' } as JUser);
    await refreshUsersCache();
    expect(getAllUsersFromCache()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// refreshProtectedAttributesCache
// ---------------------------------------------------------------------------

describe('refreshProtectedAttributesCache', () => {
  it('loads all PA records from DB into cache', async () => {
    await insertRawPA('alice', 'health', { steps: 1000 });
    await insertRawPA('alice', 'fitness', { calories: 500 });
    await insertRawPA('bob', 'health', { steps: 2000 });

    await refreshProtectedAttributesCache();

    expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(2);
    expect(getAllProtectedAttributesByUniqueIdentifier('bob')).toHaveLength(1);
  });

  it('makes records findable by namespace after load', async () => {
    await insertRawPA('alice', 'health', { steps: 1000 });
    await refreshProtectedAttributesCache();

    const results = getProtectedAttributesByUniqueIdentifier('alice', ['health']);
    expect(results).toHaveLength(1);
    expect(results[0].protectedAttributes.steps).toBe(1000);
  });

  it('replaces stale cache on re-call', async () => {
    await insertRawPA('alice', 'health', { steps: 1000 });
    await refreshProtectedAttributesCache();

    await dm.clearCollection(PROTECTED_ATTRIBUTES);
    await insertRawPA('alice', 'fitness', { calories: 200 });
    await refreshProtectedAttributesCache();

    const records = getAllProtectedAttributesByUniqueIdentifier('alice');
    expect(records).toHaveLength(1);
    expect(records[0].namespace).toBe('fitness');
  });

  it('results in empty cache when DB is empty', async () => {
    await insertRawPA('alice', 'health', { steps: 1000 });
    await refreshProtectedAttributesCache();
    await dm.clearCollection(PROTECTED_ATTRIBUTES);
    await refreshProtectedAttributesCache();
    expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PA crud — setProtectedAttributes
// ---------------------------------------------------------------------------

describe('setProtectedAttributes', () => {
  it('creates a namespace record in DB and cache', async () => {
    const result = await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { steps: 8000 },
    });

    expect(result.ok).toBe(true);

    const dbDocs = await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES);
    expect(dbDocs).toHaveLength(1);
    expect(dbDocs[0].protectedAttributes.steps).toBe(8000);
    expect(getAllProtectedAttributes('alice')).toHaveLength(1);
  });

  it('shallow-merges into an existing namespace — DB and cache stay in sync', async () => {
    await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { steps: 1000, weight: 70 },
    });
    await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { steps: 2000 },
    });

    const cached = getAllProtectedAttributes('alice');
    expect(cached[0].protectedAttributes.steps).toBe(2000);
    expect(cached[0].protectedAttributes.weight).toBe(70);

    const dbDocs = await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES);
    expect(dbDocs).toHaveLength(1);
    expect(dbDocs[0].protectedAttributes.steps).toBe(2000);
    expect(dbDocs[0].protectedAttributes.weight).toBe(70);
  });

  it('creates multiple namespaces — each gets its own DB record', async () => {
    await setProtectedAttributes('alice', [
      { namespace: 'health', protectedAttributes: { steps: 1000 } },
      { namespace: 'fitness', protectedAttributes: { calories: 500 } },
      { namespace: 'pii', protectedAttributes: { ssn: '***' } },
    ]);

    expect(await dm.getAllInCollection(PROTECTED_ATTRIBUTES)).toHaveLength(3);
    expect(getAllProtectedAttributes('alice')).toHaveLength(3);
  });

  it('records for different users do not collide', async () => {
    await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { steps: 1000 },
    });
    await setProtectedAttributes('bob', {
      namespace: 'health',
      protectedAttributes: { steps: 2000 },
    });

    expect(getAllProtectedAttributes('alice')[0].protectedAttributes.steps).toBe(1000);
    expect(getAllProtectedAttributes('bob')[0].protectedAttributes.steps).toBe(2000);
    expect(await dm.getAllInCollection(PROTECTED_ATTRIBUTES)).toHaveLength(2);
  });

  it('returns VALIDATION_ERROR for reserved key without writing to DB', async () => {
    const result = await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { id: 'hack' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0].code).toBe(JustinErrorCode.VALIDATION_ERROR);
    expect(await dm.getAllInCollection(PROTECTED_ATTRIBUTES)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PA crud — setProtectedAttributeKeysByNamespace
// ---------------------------------------------------------------------------

describe('setProtectedAttributeKeysByNamespace', () => {
  it('creates namespace when it does not exist — one DB record', async () => {
    const result = await setProtectedAttributeKeysByNamespace('alice', 'health', {
      steps: 8000,
      heartRate: 72,
    });

    expect(result.ok).toBe(true);
    expect(result.successes[0].protectedAttributes).toMatchObject({ steps: 8000, heartRate: 72 });
    expect(await dm.getAllInCollection(PROTECTED_ATTRIBUTES)).toHaveLength(1);
  });

  it('create then update leaves exactly one DB record with merged keys', async () => {
    await setProtectedAttributeKeysByNamespace('alice', 'health', { steps: 1000 });
    await setProtectedAttributeKeysByNamespace('alice', 'health', { heartRate: 72 });

    const dbDocs = await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES);
    expect(dbDocs).toHaveLength(1);
    expect(dbDocs[0].protectedAttributes).toMatchObject({ steps: 1000, heartRate: 72 });
  });

  it('updates specific keys leaving untouched keys intact — DB and cache agree', async () => {
    await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { steps: 1000, weight: 70 },
    });

    await setProtectedAttributeKeysByNamespace('alice', 'health', { steps: 9000 });

    const cached = getAllProtectedAttributes('alice');
    expect(cached[0].protectedAttributes.steps).toBe(9000);
    expect(cached[0].protectedAttributes.weight).toBe(70);

    const dbDoc = (await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES))[0];
    expect(dbDoc.protectedAttributes.steps).toBe(9000);
    expect(dbDoc.protectedAttributes.weight).toBe(70);
  });

  it('supports dot-notation to create nested structure', async () => {
    await setProtectedAttributeKeysByNamespace('alice', 'fitness', {
      'daily.steps': 10000,
      'daily.calories': 500,
    });

    const cached = getAllProtectedAttributes('alice');
    expect(cached[0].protectedAttributes.daily).toMatchObject({ steps: 10000, calories: 500 });
  });

  it('skips reserved keyPaths — partial failure with valid successes in DB', async () => {
    const result = await setProtectedAttributeKeysByNamespace('alice', 'health', {
      id: 'hack',
      steps: 1000,
    });

    expect(result.ok).toBe(false);
    expect(result.successes).toHaveLength(1);
    expect(result.successes[0].protectedAttributes.steps).toBe(1000);
    expect(result.successes[0].protectedAttributes).not.toHaveProperty('id');
    if (!result.ok) expect(result.failures[0].code).toBe(JustinErrorCode.VALIDATION_ERROR);

    const dbDoc = (await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES))[0];
    expect(dbDoc.protectedAttributes.steps).toBe(1000);
    expect(dbDoc.protectedAttributes).not.toHaveProperty('id');
  });
});

// ---------------------------------------------------------------------------
// PA crud — deleteProtectedAttributeNamespaces
// ---------------------------------------------------------------------------

describe('deleteProtectedAttributeNamespaces', () => {
  it('removes a namespace from DB and cache — leaves other namespaces intact', async () => {
    await setProtectedAttributes('alice', [
      { namespace: 'health', protectedAttributes: { steps: 1000 } },
      { namespace: 'fitness', protectedAttributes: { calories: 500 } },
    ]);

    await deleteProtectedAttributeNamespaces('alice', 'health');

    expect(await dm.getAllInCollection(PROTECTED_ATTRIBUTES)).toHaveLength(1);
    expect(getAllProtectedAttributes('alice')).toHaveLength(1);
    expect(getAllProtectedAttributes('alice')[0].namespace).toBe('fitness');
  });

  it('removes multiple namespaces in one call', async () => {
    await setProtectedAttributes('alice', [
      { namespace: 'ns1', protectedAttributes: {} },
      { namespace: 'ns2', protectedAttributes: {} },
      { namespace: 'ns3', protectedAttributes: {} },
    ]);

    await deleteProtectedAttributeNamespaces('alice', ['ns1', 'ns2']);

    expect(await dm.getAllInCollection(PROTECTED_ATTRIBUTES)).toHaveLength(1);
    expect(getAllProtectedAttributes('alice')[0].namespace).toBe('ns3');
  });

  it('does not affect other users records', async () => {
    await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { steps: 1000 },
    });
    await setProtectedAttributes('bob', {
      namespace: 'health',
      protectedAttributes: { steps: 2000 },
    });

    await deleteProtectedAttributeNamespaces('alice', 'health');

    const dbDocs = await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES);
    expect(dbDocs).toHaveLength(1);
    expect(dbDocs[0].uniqueIdentifier).toBe('bob');
  });
});

// ---------------------------------------------------------------------------
// PA crud — deleteAllProtectedAttributes
// ---------------------------------------------------------------------------

describe('deleteAllProtectedAttributes', () => {
  it('removes all namespace records for a user from DB and cache', async () => {
    await setProtectedAttributes('alice', [
      { namespace: 'health', protectedAttributes: { steps: 1000 } },
      { namespace: 'fitness', protectedAttributes: { calories: 500 } },
    ]);
    await setProtectedAttributes('bob', [
      { namespace: 'health', protectedAttributes: { steps: 2000 } },
    ]);

    await deleteAllProtectedAttributes('alice');

    expect(getAllProtectedAttributes('alice')).toHaveLength(0);
    const dbDocs = await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES);
    expect(dbDocs).toHaveLength(1);
    expect(dbDocs[0].uniqueIdentifier).toBe('bob');
  });

  it('returns ok:true when user has no records', async () => {
    const result = await deleteAllProtectedAttributes('alice');
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PA crud — deleteProtectedAttributeKeysByNamespace
// ---------------------------------------------------------------------------

describe('deleteProtectedAttributeKeysByNamespace', () => {
  it('removes a key from protectedAttributes — DB and cache agree', async () => {
    await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { steps: 8000, weight: 70 },
    });

    await deleteProtectedAttributeKeysByNamespace('alice', 'health', 'weight');

    const cached = getAllProtectedAttributes('alice');
    expect(cached[0].protectedAttributes).not.toHaveProperty('weight');
    expect(cached[0].protectedAttributes.steps).toBe(8000);

    const dbDoc = (await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES))[0];
    expect(dbDoc.protectedAttributes).not.toHaveProperty('weight');
    expect(dbDoc.protectedAttributes.steps).toBe(8000);
  });

  it('removes a nested key via dot-notation leaving siblings intact', async () => {
    await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { daily: { steps: 8000, calories: 500 } },
    });

    await deleteProtectedAttributeKeysByNamespace('alice', 'health', 'daily.calories');

    const cached = getAllProtectedAttributes('alice');
    expect(cached[0].protectedAttributes.daily).not.toHaveProperty('calories');
    expect(cached[0].protectedAttributes.daily.steps).toBe(8000);
  });

  it('skips reserved keyPaths — partial failure, valid keys still deleted from DB', async () => {
    await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { steps: 8000 },
    });

    const result = await deleteProtectedAttributeKeysByNamespace('alice', 'health', [
      'id',
      'steps',
    ]);

    expect(result.ok).toBe(false);
    expect(result.successes).toHaveLength(1);
    if (!result.ok) expect(result.failures[0].code).toBe(JustinErrorCode.VALIDATION_ERROR);

    const dbDoc = (await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES))[0];
    expect(dbDoc.protectedAttributes).not.toHaveProperty('steps');
  });
});

// ---------------------------------------------------------------------------
// Change listener pipeline
// ---------------------------------------------------------------------------

describe('change listener pipeline', () => {
  afterEach(async () => {
    await removeUserChangeListeners();
    await removeProtectedAttributesChangeListeners();
  });

  describe('users — INSERT', () => {
    it('writing a user directly to DB updates the cache via change stream', async () => {
      setupUserChangeListeners();

      const raw = await insertRawUser('alice', { score: 42 });

      await waitForCondition(() => getUserByIdFromCache(raw.id) !== null);

      const cached = getUserByIdFromCache(raw.id);
      expect(cached).not.toBeNull();
      expect(cached!.uniqueIdentifier).toBe('alice');
      expect((cached as any).score).toBe(42);
    });
  });

  describe('users — UPDATE', () => {
    it('updating a user directly in DB reflects in cache via change stream', async () => {
      const raw = await insertRawUser('alice', { score: 1 });
      upsertUserInCache(raw as unknown as JUser);

      setupUserChangeListeners();

      await dm.updateItemByIdInCollection(USERS, raw.id, { score: 99 });

      await waitForCondition(() => {
        const u = getUserByIdFromCache(raw.id);
        return u !== null && (u as any).score === 99;
      });

      expect((getUserByIdFromCache(raw.id) as any).score).toBe(99);
    });
  });

  describe('users — DELETE', () => {
    it('deleting a user directly from DB removes them from cache via change stream', async () => {
      const raw = await insertRawUser('alice');
      upsertUserInCache(raw as unknown as JUser);

      setupUserChangeListeners();

      await dm.removeItemFromCollection(USERS, raw.id);

      await waitForCondition(() => getUserByIdFromCache(raw.id) === null);

      expect(getUserByIdFromCache(raw.id)).toBeNull();
      expect(getUserByUniqueIdentifierFromCache('alice')).toBeNull();
    });

    it('onUserDeletedByUniqueIdentifier hook fires with the correct uniqueIdentifier', async () => {
      const raw = await insertRawUser('alice');
      upsertUserInCache(raw as unknown as JUser);

      let deletedUid: string | null = null;
      setupUserChangeListeners((uid) => {
        deletedUid = uid;
      });

      await dm.removeItemFromCollection(USERS, raw.id);

      await waitForCondition(() => deletedUid !== null);

      expect(deletedUid).toBe('alice');
    });
  });

  describe('protected attributes — INSERT', () => {
    it('writing a PA record directly to DB updates the cache via change stream', async () => {
      setupProtectedAttributesChangeListeners();

      await insertRawPA('alice', 'health', { steps: 8000 });

      await waitForCondition(() => getAllProtectedAttributesByUniqueIdentifier('alice').length > 0);

      const cached = getProtectedAttributesByUniqueIdentifier('alice', ['health']);
      expect(cached).toHaveLength(1);
      expect(cached[0].protectedAttributes.steps).toBe(8000);
    });
  });

  describe('protected attributes — UPDATE', () => {
    it('updating a PA record directly in DB reflects in cache via change stream', async () => {
      const raw = await insertRawPA('alice', 'health', { steps: 1000 });
      await refreshProtectedAttributesCache();

      setupProtectedAttributesChangeListeners();

      await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, raw.id, {
        protectedAttributes: { steps: 9999 },
      });

      await waitForCondition(() => {
        const cached = getProtectedAttributesByUniqueIdentifier('alice', ['health']);
        return cached.length > 0 && cached[0].protectedAttributes.steps === 9999;
      });

      expect(
        getProtectedAttributesByUniqueIdentifier('alice', ['health'])[0].protectedAttributes.steps,
      ).toBe(9999);
    });
  });

  describe('protected attributes — DELETE', () => {
    it('deleting a PA record directly from DB removes it from cache via change stream', async () => {
      const raw = await insertRawPA('alice', 'health', { steps: 1000 });
      await refreshProtectedAttributesCache();

      setupProtectedAttributesChangeListeners();

      await dm.removeItemFromCollection(PROTECTED_ATTRIBUTES, raw.id);

      await waitForCondition(
        () => getAllProtectedAttributesByUniqueIdentifier('alice').length === 0,
      );

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// DB / cache consistency after mutations and restarts
// ---------------------------------------------------------------------------

describe('DB / cache consistency', () => {
  it('cache and DB agree after interleaved setProtectedAttributes and setProtectedAttributeKeysByNamespace', async () => {
    await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { steps: 1000, weight: 70 },
    });

    await setProtectedAttributeKeysByNamespace('alice', 'health', { heartRate: 72 });

    await setProtectedAttributes('alice', {
      namespace: 'health',
      protectedAttributes: { steps: 5000 },
    });

    const expected = { steps: 5000, weight: 70, heartRate: 72 };

    expect(getAllProtectedAttributes('alice')[0].protectedAttributes).toMatchObject(expected);

    const dbDoc = (await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES))[0];
    expect(dbDoc.protectedAttributes).toMatchObject(expected);
    expect(await dm.getAllInCollection(PROTECTED_ATTRIBUTES)).toHaveLength(1);
  });

  it('cache reflects DB state after refreshUsersCache called following direct DB writes', async () => {
    await insertRawUser('alice', { score: 42 });
    await insertRawUser('bob', { score: 10 });

    clearUsersCache();
    expect(getAllUsersFromCache()).toHaveLength(0);

    await refreshUsersCache();

    expect(getAllUsersFromCache()).toHaveLength(2);
    expect(getUserByUniqueIdentifierFromCache('alice')).not.toBeNull();
    expect((getUserByUniqueIdentifierFromCache('alice') as any).score).toBe(42);
  });

  it('cache reflects DB state after refreshProtectedAttributesCache following direct DB writes', async () => {
    await insertRawPA('alice', 'health', { steps: 1000 });
    await insertRawPA('alice', 'fitness', { calories: 500 });

    clearProtectedAttributesCache();
    expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(0);

    await refreshProtectedAttributesCache();

    expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// shutdownCore lifecycle wiring
// ---------------------------------------------------------------------------

describe('shutdownCore', () => {
  it('removes all UserManager change listeners and closes DataManager', async () => {
    // @ts-ignore
    const { UserManager } = await import('../user-manager');
    await UserManager.init();

    const clm = ChangeListenerManager.getInstance();
    expect(clm.hasChangeListener(USERS, CollectionChangeTypeEnum.INSERT)).toBe(true);
    expect(clm.hasChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeTypeEnum.INSERT)).toBe(true);

    await shutdownCore();

    expect(clm.hasChangeListener(USERS, CollectionChangeTypeEnum.INSERT)).toBe(false);
    expect(clm.hasChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeTypeEnum.INSERT)).toBe(
      false,
    );
    expect(dm.getInitializationStatus()).toBe(false);

    // Re-init for subsequent tests
    await dm.init();
    clearManagerRegistry();
  });

  it('clearManagerRegistry prevents registered managers from being shut down again', async () => {
    // @ts-ignore
    const { UserManager } = await import('../user-manager');
    await UserManager.init();

    clearManagerRegistry();

    // shutdownCore with empty registry should not throw
    await expect(shutdownCore()).resolves.not.toThrow();

    // Re-init for subsequent tests
    await dm.init();
  });
});
