import { MongoMemoryReplSet } from 'mongodb-memory-server';
import sinon from 'sinon';

import { configureDB } from '../../lifecycle';
import { DataManager, DBType } from '../../data-manager';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import { UserManager, TestingUserManager } from '../../user-manager/user-manager';
import { USERS, PROTECTED_ATTRIBUTES } from '../../user-manager/constants';
import {
  waitForMongoReady,
  expectOk,
  expectFailed,
  expectFailedWithCode,
  silenceLogger,
} from '../../testing';
import type { JUser } from '../../user-manager/types';

jest.setTimeout(120_000);

describe('UserManager public API — e2e', () => {
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
    sb.stub(MongoDBManager, 'init').callsFake(() => realInit(uri, 'user-manager-e2e'));

    configureDB({ dbType: DBType.MONGO, uri });

    dm = DataManager.getInstance();
    await UserManager.init();
  });

  afterAll(async () => {
    try {
      await UserManager.shutdown();
    } catch {}
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
    await dm.clearCollection(USERS);
    await dm.clearCollection(PROTECTED_ATTRIBUTES);
    await TestingUserManager.refreshUsersCache();
    await TestingUserManager.refreshProtectedAttributesCache();
  });

  async function createUser(
    uniqueIdentifier: string,
    attributes: Record<string, any> = {},
  ): Promise<JUser> {
    const result = await UserManager.createUser({ uniqueIdentifier, attributes });
    return expectOk(result);
  }

  describe('createUser', () => {
    it('returns ok:true with the created user', async () => {
      const result = await UserManager.createUser({
        uniqueIdentifier: 'u1',
        attributes: { name: 'Alice' },
      });

      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(1);
      const user = result.successes[0];
      expect(user.id).toEqual(expect.any(String));
      expect(user.uniqueIdentifier).toBe('u1');
      expect(user.name).toBe('Alice');
    });

    it('persists the user to DB', async () => {
      await createUser('u1');
      const all = await dm.getAllInCollection<any>(USERS);
      expect(all).toHaveLength(1);
      expect(all[0].uniqueIdentifier).toBe('u1');
    });

    it('does not expose _id — only id', async () => {
      const result = await UserManager.createUser({ uniqueIdentifier: 'u1', attributes: {} });
      const user = expectOk(result);
      expect((user as any)._id).toBeUndefined();
      expect(user.id).toEqual(expect.any(String));
    });

    it('returns ok:false with VALIDATION_ERROR for duplicate uniqueIdentifier', async () => {
      await createUser('u1');
      const duplicate = await UserManager.createUser({ uniqueIdentifier: 'u1', attributes: {} });
      const failure = expectFailedWithCode(duplicate, 'VALIDATION_ERROR');
      expect(failure.uniqueIdentifier).toBe('u1');
      if (!duplicate.ok) expect(duplicate.successes).toHaveLength(0);
    });

    it('returns ok:false for null input', async () => {
      // @ts-expect-error intentional
      expectFailed(await UserManager.createUser(null));
    });

    it('returns ok:false with VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await UserManager.createUser({ uniqueIdentifier: '', attributes: {} }),
        'VALIDATION_ERROR',
      );
    });

    it('returns ok:false with VALIDATION_ERROR for reserved attribute key "id"', async () => {
      expectFailedWithCode(
        await UserManager.createUser({ uniqueIdentifier: 'u1', attributes: { id: 'hack' } }),
        'VALIDATION_ERROR',
      );
    });

    it('returns ok:false with VALIDATION_ERROR for reserved attribute key "uniqueIdentifier"', async () => {
      expectFailedWithCode(
        await UserManager.createUser({
          uniqueIdentifier: 'u1',
          attributes: { uniqueIdentifier: 'hack' },
        }),
        'VALIDATION_ERROR',
      );
    });

    it('preserves internal spaces in uniqueIdentifier', async () => {
      const user = await createUser('test mark');
      expect(user.uniqueIdentifier).toBe('test mark');
    });

    it('trims leading and trailing whitespace from uniqueIdentifier before storing', async () => {
      const user = await createUser('  test mark  ');
      expect(user.uniqueIdentifier).toBe('test mark');
    });

    it('treats leading/trailing whitespace variants as the same identifier', async () => {
      await createUser('  test mark  ');
      const duplicate = await UserManager.createUser({
        uniqueIdentifier: 'test mark',
        attributes: {},
      });
      expectFailedWithCode(duplicate, 'VALIDATION_ERROR');
    });

    it('creates user with protected attributes in one call', async () => {
      const result = await UserManager.createUser({
        uniqueIdentifier: 'u-with-pa',
        attributes: { name: 'Bob' },
        protectedAttributes: [{ namespace: 'health', protectedAttributes: { steps: 1000 } }],
      });

      const user = expectOk(result);
      const pa = UserManager.getAllProtectedAttributesForUser(user.id);
      expect(pa).toHaveLength(1);
      expect(pa[0].namespace).toBe('health');
      expect(pa[0].protectedAttributes).toMatchObject({ steps: 1000 });
    });
  });

  describe('createUsers', () => {
    it('returns ok:true with all created users when all succeed', async () => {
      const result = await UserManager.createUsers([
        { uniqueIdentifier: 'bulk-1', attributes: { x: 1 } },
        { uniqueIdentifier: 'bulk-2', attributes: { x: 2 } },
        { uniqueIdentifier: 'bulk-3', attributes: { x: 3 } },
      ]);

      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(3);
      expect(result.successes.map((u) => u.uniqueIdentifier).sort()).toEqual([
        'bulk-1',
        'bulk-2',
        'bulk-3',
      ]);
    });

    it('returns ok:false with partial successes when some records are invalid', async () => {
      const result = await UserManager.createUsers([
        { uniqueIdentifier: 'valid-1', attributes: {} },
        // @ts-expect-error intentional
        null,
        { uniqueIdentifier: 'valid-2', attributes: {} },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.successes).toHaveLength(2);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe('VALIDATION_ERROR');
      }
    });

    it('returns ok:true with empty successes for empty input', async () => {
      const result = await UserManager.createUsers([]);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });

    it('persists all created users to DB', async () => {
      await UserManager.createUsers([
        { uniqueIdentifier: 'p1', attributes: {} },
        { uniqueIdentifier: 'p2', attributes: {} },
      ]);
      expect(await dm.getAllInCollection<any>(USERS)).toHaveLength(2);
    });

    it('failure entries include uniqueIdentifier for traceability', async () => {
      await createUser('existing');

      const result = await UserManager.createUsers([
        { uniqueIdentifier: 'new-one', attributes: {} },
        { uniqueIdentifier: 'existing', attributes: {} },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.successes).toHaveLength(1);
        expect(result.failures[0].uniqueIdentifier).toBe('existing');
        expect(result.failures[0].code).toBe('VALIDATION_ERROR');
      }
    });

    it('trims uniqueIdentifier in bulk — stores trimmed value', async () => {
      const result = await UserManager.createUsers([
        { uniqueIdentifier: '  alice  ', attributes: {} },
      ]);

      expect(result.ok).toBe(true);
      expect(result.successes[0].uniqueIdentifier).toBe('alice');
    });

    it('treats whitespace variants as duplicates in bulk', async () => {
      const result = await UserManager.createUsers([
        { uniqueIdentifier: '  alice  ', attributes: {} },
        { uniqueIdentifier: 'alice', attributes: {} },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.successes).toHaveLength(1);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('getUserById / getUserByUniqueIdentifier / getAllUsers', () => {
    it('getUserById returns the user from cache', async () => {
      const user = await createUser('u1', { name: 'Alice' });
      const found = UserManager.getUserById(user.id);
      expect(found).not.toBeNull();
      expect(found!.uniqueIdentifier).toBe('u1');
    });

    it('getUserById returns null for unknown id', () => {
      expect(UserManager.getUserById('nonexistent-id')).toBeNull();
    });

    it('getUserById returns null for empty string', () => {
      expect(UserManager.getUserById('')).toBeNull();
    });

    it('getUserByUniqueIdentifier returns the user from cache', async () => {
      await createUser('u1', { name: 'Alice' });
      const found = UserManager.getUserByUniqueIdentifier('u1');
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
    });

    it('getUserByUniqueIdentifier returns null for unknown identifier', () => {
      expect(UserManager.getUserByUniqueIdentifier('nobody')).toBeNull();
    });

    it('getUserByUniqueIdentifier requires exact match — does not trim on lookup', async () => {
      await createUser('test mark');
      expect(UserManager.getUserByUniqueIdentifier('test mark')).not.toBeNull();
      expect(UserManager.getUserByUniqueIdentifier('testmark')).toBeNull();
      // stored as 'test mark' after trim — padded version does not match
      expect(UserManager.getUserByUniqueIdentifier(' test mark ')).toBeNull();
    });

    it('getAllUsers returns all cached users', async () => {
      await UserManager.createUsers([
        { uniqueIdentifier: 'a1', attributes: {} },
        { uniqueIdentifier: 'a2', attributes: {} },
      ]);
      expect(UserManager.getAllUsers()).toHaveLength(2);
    });

    it('getAllUsers returns empty array when no users exist', () => {
      expect(UserManager.getAllUsers()).toEqual([]);
    });
  });

  describe('isIdentifierUnique', () => {
    it('returns true for an identifier that does not exist', () => {
      expect(UserManager.isIdentifierUnique('brand-new')).toBe(true);
    });

    it('returns false after a user with that identifier is created', async () => {
      await createUser('taken');
      expect(UserManager.isIdentifierUnique('taken')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(UserManager.isIdentifierUnique('')).toBe(false);
    });
  });

  describe('updateUserById', () => {
    it('returns ok:true with the updated user', async () => {
      const user = await createUser('u1', { score: 10 });
      const updated = expectOk(await UserManager.updateUserById(user.id, { score: 20 }));
      expect(updated.score).toBe(20);
      expect(updated.uniqueIdentifier).toBe('u1');
    });

    it('merges attributes — does not wipe unrelated fields', async () => {
      const user = await createUser('u1', { a: 1, b: 2 });
      const updated = expectOk(await UserManager.updateUserById(user.id, { b: 99 }));
      expect(updated.a).toBe(1);
      expect(updated.b).toBe(99);
    });

    it('updates the cache so subsequent reads reflect the change', async () => {
      const user = await createUser('u1', { score: 10 });
      await UserManager.updateUserById(user.id, { score: 42 });
      expect(UserManager.getUserById(user.id)!.score).toBe(42);
    });

    it('persists the update to DB', async () => {
      const user = await createUser('u1', { score: 10 });
      await UserManager.updateUserById(user.id, { score: 99 });
      const all = await dm.getAllInCollection<any>(USERS);
      expect(all[0].score).toBe(99);
    });

    it('returns ok:false with VALIDATION_ERROR for empty userId', async () => {
      expectFailedWithCode(await UserManager.updateUserById('', { score: 1 }), 'VALIDATION_ERROR');
    });

    it('returns ok:false with NOT_FOUND for unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.updateUserById('nonexistent', { score: 1 }),
        'NOT_FOUND',
      );
    });

    it('returns ok:false with VALIDATION_ERROR for reserved field "id"', async () => {
      const user = await createUser('u1');
      expectFailedWithCode(
        await UserManager.updateUserById(user.id, { id: 'hack' }),
        'VALIDATION_ERROR',
      );
    });

    it('returns ok:false with VALIDATION_ERROR for reserved field "uniqueIdentifier"', async () => {
      const user = await createUser('u1');
      expectFailedWithCode(
        await UserManager.updateUserById(user.id, { uniqueIdentifier: 'hack' }),
        'VALIDATION_ERROR',
      );
    });

    it('failure entry carries id for traceability', async () => {
      const result = await UserManager.updateUserById('ghost-id', { score: 1 });
      if (!result.ok) expect(result.failures[0].id).toBe('ghost-id');
    });
  });

  describe('updateUserByUniqueIdentifier', () => {
    it('returns ok:true with the updated user', async () => {
      await createUser('u1', { score: 5 });
      const updated = expectOk(await UserManager.updateUserByUniqueIdentifier('u1', { score: 50 }));
      expect(updated.score).toBe(50);
    });

    it('returns ok:false with NOT_FOUND for unknown uniqueIdentifier', async () => {
      expectFailedWithCode(
        await UserManager.updateUserByUniqueIdentifier('nobody', { score: 1 }),
        'NOT_FOUND',
      );
    });

    it('returns ok:false with VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await UserManager.updateUserByUniqueIdentifier('', { score: 1 }),
        'VALIDATION_ERROR',
      );
    });

    it('lookup does not trim — padded identifier does not match trimmed stored value', async () => {
      await createUser('  test mark  ');
      // stored as 'test mark' after trim — padding does not match
      expectFailedWithCode(
        await UserManager.updateUserByUniqueIdentifier(' test mark ', { x: 1 }),
        'NOT_FOUND',
      );
      // exact trimmed value does match
      const updated = expectOk(
        await UserManager.updateUserByUniqueIdentifier('test mark', { x: 1 }),
      );
      expect(updated.uniqueIdentifier).toBe('test mark');
    });
  });

  describe('deleteUserById', () => {
    it('returns ok:true on successful deletion', async () => {
      const user = await createUser('u1');
      expect((await UserManager.deleteUserById(user.id)).ok).toBe(true);
    });

    it('removes user from cache after deletion', async () => {
      const user = await createUser('u1');
      await UserManager.deleteUserById(user.id);
      expect(UserManager.getUserById(user.id)).toBeNull();
      expect(UserManager.getUserByUniqueIdentifier('u1')).toBeNull();
    });

    it('removes user from DB after deletion', async () => {
      const user = await createUser('u1');
      await UserManager.deleteUserById(user.id);
      expect(await dm.getAllInCollection<any>(USERS)).toHaveLength(0);
    });

    it('cascades and deletes all protected attributes', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, [
        { namespace: 'ns1', protectedAttributes: { x: 1 } },
        { namespace: 'ns2', protectedAttributes: { y: 2 } },
      ]);

      await UserManager.deleteUserById(user.id);
      expect(await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES)).toHaveLength(0);
    });

    it('returns ok:false with NOT_FOUND for unknown userId', async () => {
      expectFailedWithCode(await UserManager.deleteUserById('nonexistent'), 'NOT_FOUND');
    });

    it('returns ok:false with VALIDATION_ERROR for empty userId', async () => {
      expectFailedWithCode(await UserManager.deleteUserById(''), 'VALIDATION_ERROR');
    });

    it('failure entry carries id for traceability', async () => {
      const result = await UserManager.deleteUserById('ghost-id');
      if (!result.ok) expect(result.failures[0].id).toBe('ghost-id');
    });
  });

  describe('deleteUserByUniqueIdentifier', () => {
    it('returns ok:true on successful deletion', async () => {
      await createUser('u1');
      expect((await UserManager.deleteUserByUniqueIdentifier('u1')).ok).toBe(true);
      expect(UserManager.getUserByUniqueIdentifier('u1')).toBeNull();
    });

    it('returns ok:false with NOT_FOUND for unknown uniqueIdentifier', async () => {
      expectFailedWithCode(await UserManager.deleteUserByUniqueIdentifier('nobody'), 'NOT_FOUND');
    });

    it('lookup does not trim — padded identifier does not match trimmed stored value', async () => {
      await createUser('  test mark  ');
      // stored as 'test mark' — padded version does not match
      expectFailedWithCode(
        await UserManager.deleteUserByUniqueIdentifier(' test mark '),
        'NOT_FOUND',
      );
      expect(UserManager.getUserByUniqueIdentifier('test mark')).not.toBeNull();
    });

    it('cascades protected attribute deletion', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, [
        { namespace: 'health', protectedAttributes: { steps: 500 } },
      ]);

      await UserManager.deleteUserByUniqueIdentifier('u1');
      expect(await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES)).toHaveLength(0);
    });
  });

  describe('deleteAllUsers', () => {
    it('clears all users and protected attributes, empties the cache', async () => {
      const u1 = await createUser('u1');
      const u2 = await createUser('u2');

      await UserManager.setProtectedAttributesForUser(u1.id, [
        { namespace: 'ns', protectedAttributes: { a: 1 } },
      ]);
      await UserManager.setProtectedAttributesForUser(u2.id, [
        { namespace: 'ns', protectedAttributes: { b: 2 } },
      ]);

      const result = await UserManager.deleteAllUsers();

      expect(result.ok).toBe(true);
      expect(UserManager.getAllUsers()).toHaveLength(0);
      expect(await dm.getAllInCollection<any>(USERS)).toHaveLength(0);
      expect(await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES)).toHaveLength(0);
    });
  });

  describe('setProtectedAttributesForUser', () => {
    it('returns ok:true with the created record', async () => {
      const user = await createUser('u1');
      const result = await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'health',
        protectedAttributes: { steps: 1000 },
      });

      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(1);
      expect(result.successes[0].namespace).toBe('health');
      expect(result.successes[0].protectedAttributes).toMatchObject({ steps: 1000 });
    });

    it('shallow-merges into existing record', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'health',
        protectedAttributes: { steps: 1000, weight: 70 },
      });
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'health',
        protectedAttributes: { steps: 2000 },
      });

      const pa = UserManager.getProtectedAttributesForUser(user.id, ['health']);
      expect(pa[0].protectedAttributes).toMatchObject({ steps: 2000, weight: 70 });
    });

    it('creates multiple namespaces in one call', async () => {
      const user = await createUser('u1');
      const result = await UserManager.setProtectedAttributesForUser(user.id, [
        { namespace: 'ns1', protectedAttributes: { a: 1 } },
        { namespace: 'ns2', protectedAttributes: { b: 2 } },
      ]);

      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(2);
      expect(UserManager.getAllProtectedAttributesForUser(user.id)).toHaveLength(2);
    });

    it('persists to DB', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { secret: 'abc' },
      });

      const all = await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES);
      expect(all).toHaveLength(1);
      expect(all[0].protectedAttributes).toMatchObject({ secret: 'abc' });
    });

    it('returns ok:false with NOT_FOUND for unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.setProtectedAttributesForUser('nonexistent', {
          namespace: 'ns',
          protectedAttributes: { x: 1 },
        }),
        'NOT_FOUND',
      );
    });

    it('returns ok:false with partial successes when some namespaces are invalid', async () => {
      const user = await createUser('u1');
      const result = await UserManager.setProtectedAttributesForUser(user.id, [
        { namespace: '', protectedAttributes: { x: 1 } },
        { namespace: 'valid', protectedAttributes: { y: 2 } },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.successes).toHaveLength(1);
        expect(result.successes[0].namespace).toBe('valid');
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe('VALIDATION_ERROR');
      }
    });

    it('preserves namespace with internal spaces exactly as provided', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'my namespace',
        protectedAttributes: { x: 1 },
      });
      expect(UserManager.getProtectedAttributesForUser(user.id, ['my namespace'])).toHaveLength(1);
    });

    it('returns ok:false with VALIDATION_ERROR for reserved key — failure carries namespace in details', async () => {
      const user = await createUser('u1');
      const result = await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { id: 'hack' },
      });
      const failure = expectFailedWithCode(result, 'VALIDATION_ERROR');
      expect(failure.details?.namespace).toBe('ns');
    });
  });

  describe('getProtectedAttributesForUser / getAllProtectedAttributesForUser', () => {
    it('returns only requested namespaces', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, [
        { namespace: 'ns1', protectedAttributes: { a: 1 } },
        { namespace: 'ns2', protectedAttributes: { b: 2 } },
        { namespace: 'ns3', protectedAttributes: { c: 3 } },
      ]);

      const pa = UserManager.getProtectedAttributesForUser(user.id, ['ns1', 'ns3']);
      expect(pa).toHaveLength(2);
      expect(pa.map((r) => r.namespace).sort()).toEqual(['ns1', 'ns3']);
    });

    it('getAllProtectedAttributesForUser returns every namespace', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, [
        { namespace: 'a', protectedAttributes: {} },
        { namespace: 'b', protectedAttributes: {} },
        { namespace: 'c', protectedAttributes: {} },
      ]);
      expect(UserManager.getAllProtectedAttributesForUser(user.id)).toHaveLength(3);
    });

    it('returns empty array for user with no protected attributes', async () => {
      const user = await createUser('u1');
      expect(UserManager.getAllProtectedAttributesForUser(user.id)).toEqual([]);
    });

    it('returns empty array for unknown userId', () => {
      expect(UserManager.getProtectedAttributesForUser('nobody', ['ns'])).toEqual([]);
      expect(UserManager.getAllProtectedAttributesForUser('nobody')).toEqual([]);
    });

    it('filters out invalid namespaces silently', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'real',
        protectedAttributes: { x: 1 },
      });
      const pa = UserManager.getProtectedAttributesForUser(user.id, ['real', '', 'nonexistent']);
      expect(pa).toHaveLength(1);
      expect(pa[0].namespace).toBe('real');
    });
  });

  describe('setProtectedAttributeKeysByNamespaceForUser', () => {
    it('returns ok:true — sets a top-level key', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { a: 1, b: 2 },
      });

      const updated = expectOk(
        await UserManager.setProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', { a: 99 }),
      );
      expect(updated.protectedAttributes).toMatchObject({ a: 99, b: 2 });
    });

    it('sets a nested key via dot notation', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { daily: { steps: 100 } },
      });

      const updated = expectOk(
        await UserManager.setProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', {
          'daily.steps': 9999,
        }),
      );
      expect(updated.protectedAttributes.daily.steps).toBe(9999);
    });

    it('creates intermediate objects for deep paths', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: {},
      });

      const updated = expectOk(
        await UserManager.setProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', {
          'a.b.c': 'deep',
        }),
      );
      expect(updated.protectedAttributes.a.b.c).toBe('deep');
    });

    it('updates the cache', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { x: 0 },
      });

      await UserManager.setProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', { x: 42 });
      expect(
        UserManager.getProtectedAttributesForUser(user.id, ['ns'])[0].protectedAttributes.x,
      ).toBe(42);
    });

    it('returns ok:false with NOT_FOUND for unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.setProtectedAttributeKeysByNamespaceForUser('nonexistent', 'ns', {
          x: 1,
        }),
        'NOT_FOUND',
      );
    });

    it('creates the namespace when it does not exist', async () => {
      const user = await createUser('u1');
      const result = await UserManager.setProtectedAttributeKeysByNamespaceForUser(
        user.id,
        'no-such-ns',
        { x: 1 },
      );
      expect(result.ok).toBe(true);
      expect(result.successes[0].namespace).toBe('no-such-ns');
      expect(result.successes[0].protectedAttributes.x).toBe(1);
    });

    it('returns ok:false with VALIDATION_ERROR for reserved keyPath — failure carries namespace and keyPath in details', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: {},
      });

      const result = await UserManager.setProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', {
        id: 'hack',
      });
      const failure = expectFailedWithCode(result, 'VALIDATION_ERROR');
      expect(failure.details?.namespace).toBe('ns');
      expect(failure.details?.keyPath).toBe('id');
    });

    it('returns ok:false with VALIDATION_ERROR for reserved keyPath "namespace"', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: {},
      });
      expectFailedWithCode(
        await UserManager.setProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', {
          namespace: 'hack',
        }),
        'VALIDATION_ERROR',
      );
    });

    it('returns ok:true — updates multiple key paths in one call', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { a: 1, b: 2, c: 3 },
      });

      const updated = expectOk(
        await UserManager.setProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', {
          a: 10,
          b: 20,
        }),
      );
      expect(updated.protectedAttributes).toMatchObject({ a: 10, b: 20, c: 3 });
    });

    it('supports dot-notation paths', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { daily: { steps: 0, calories: 0 } },
      });

      const updated = expectOk(
        await UserManager.setProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', {
          'daily.steps': 5000,
          'daily.calories': 200,
        }),
      );
      expect(updated.protectedAttributes.daily).toMatchObject({ steps: 5000, calories: 200 });
    });

    it('returns ok:false with NOT_FOUND for unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.setProtectedAttributeKeysByNamespaceForUser('nobody', 'ns', { x: 1 }),
        'NOT_FOUND',
      );
    });

    it('creates the namespace when it does not exist', async () => {
      const user = await createUser('u1');
      const result = await UserManager.setProtectedAttributeKeysByNamespaceForUser(
        user.id,
        'new-ns',
        { a: 1, b: 2 },
      );
      expect(result.ok).toBe(true);
      expect(result.successes[0].namespace).toBe('new-ns');
      expect(result.successes[0].protectedAttributes).toMatchObject({ a: 1, b: 2 });
    });

    it('skips reserved keyPaths, applies valid ones — returns ok:false with partial successes', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { safe: 0 },
      });

      const result = await UserManager.setProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', {
        id: 'hack',
        safe: 99,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.successes).toHaveLength(1);
        expect(result.successes[0].protectedAttributes.safe).toBe(99);
        expect(result.successes[0].protectedAttributes).not.toHaveProperty('id');
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe('VALIDATION_ERROR');
        expect(result.failures[0].details?.keyPath).toBe('id');
      }
    });
  });

  describe('deleteProtectedAttributeNamespacesForUser', () => {
    it('returns ok:true — deletes a single namespace', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, [
        { namespace: 'ns1', protectedAttributes: { a: 1 } },
        { namespace: 'ns2', protectedAttributes: { b: 2 } },
      ]);

      expect((await UserManager.deleteProtectedAttributeNamespacesForUser(user.id, 'ns1')).ok).toBe(
        true,
      );
      const remaining = UserManager.getAllProtectedAttributesForUser(user.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].namespace).toBe('ns2');
    });

    it('deletes multiple namespaces at once', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, [
        { namespace: 'ns1', protectedAttributes: {} },
        { namespace: 'ns2', protectedAttributes: {} },
        { namespace: 'ns3', protectedAttributes: {} },
      ]);

      await UserManager.deleteProtectedAttributeNamespacesForUser(user.id, ['ns1', 'ns2']);
      const remaining = UserManager.getAllProtectedAttributesForUser(user.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].namespace).toBe('ns3');
    });

    it('updates cache after deletion', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { x: 1 },
      });
      await UserManager.deleteProtectedAttributeNamespacesForUser(user.id, 'ns');
      expect(UserManager.getProtectedAttributesForUser(user.id, ['ns'])).toEqual([]);
    });

    it('removes from DB', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: {},
      });
      await UserManager.deleteProtectedAttributeNamespacesForUser(user.id, 'ns');
      expect(await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES)).toHaveLength(0);
    });

    it('returns ok:false with NOT_FOUND for unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.deleteProtectedAttributeNamespacesForUser('nobody', 'ns'),
        'NOT_FOUND',
      );
    });

    it('returns ok:false with NOT_FOUND when namespace does not exist', async () => {
      const user = await createUser('u1');
      expectFailedWithCode(
        await UserManager.deleteProtectedAttributeNamespacesForUser(user.id, 'no-such-ns'),
        'NOT_FOUND',
      );
    });
  });

  describe('deleteAllProtectedAttributesForUser', () => {
    it('deletes all namespaces for the user', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, [
        { namespace: 'ns1', protectedAttributes: {} },
        { namespace: 'ns2', protectedAttributes: {} },
      ]);

      const result = await UserManager.deleteAllProtectedAttributesForUser(user.id);
      expect(result.ok).toBe(true);
      expect(UserManager.getAllProtectedAttributesForUser(user.id)).toHaveLength(0);
      expect(await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES)).toHaveLength(0);
    });

    it('returns ok:true for a user with no protected attributes', async () => {
      const user = await createUser('u1');
      const result = await UserManager.deleteAllProtectedAttributesForUser(user.id);
      expect(result.ok).toBe(true);
    });

    it('does not affect other users protected attributes', async () => {
      const u1 = await createUser('u1');
      const u2 = await createUser('u2');

      await UserManager.setProtectedAttributesForUser(u1.id, {
        namespace: 'ns',
        protectedAttributes: { a: 1 },
      });
      await UserManager.setProtectedAttributesForUser(u2.id, {
        namespace: 'ns',
        protectedAttributes: { b: 2 },
      });

      await UserManager.deleteAllProtectedAttributesForUser(u1.id);
      expect(UserManager.getAllProtectedAttributesForUser(u2.id)).toHaveLength(1);
    });
  });

  describe('deleteProtectedAttributeKeysByNamespaceForUser', () => {
    it('returns ok:true — removes a top-level key', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { a: 1, b: 2 },
      });

      const updated = expectOk(
        await UserManager.deleteProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', 'a'),
      );
      expect(updated.protectedAttributes).not.toHaveProperty('a');
      expect(updated.protectedAttributes.b).toBe(2);
    });

    it('removes a nested key via dot notation', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { daily: { steps: 100, calories: 200 } },
      });

      const updated = expectOk(
        await UserManager.deleteProtectedAttributeKeysByNamespaceForUser(
          user.id,
          'ns',
          'daily.steps',
        ),
      );
      expect(updated.protectedAttributes.daily).not.toHaveProperty('steps');
      expect(updated.protectedAttributes.daily.calories).toBe(200);
    });

    it('updates cache after key deletion', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { x: 1, y: 2 },
      });

      await UserManager.deleteProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', 'x');
      expect(
        UserManager.getProtectedAttributesForUser(user.id, ['ns'])[0].protectedAttributes,
      ).not.toHaveProperty('x');
    });

    it('returns ok:false with NOT_FOUND for unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.deleteProtectedAttributeKeysByNamespaceForUser('nobody', 'ns', 'x'),
        'NOT_FOUND',
      );
    });

    it('returns ok:false with NOT_FOUND for nonexistent namespace', async () => {
      const user = await createUser('u1');
      expectFailedWithCode(
        await UserManager.deleteProtectedAttributeKeysByNamespaceForUser(user.id, 'no-ns', 'x'),
        'NOT_FOUND',
      );
    });

    it('returns ok:false with VALIDATION_ERROR for reserved keyPath "id"', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: {},
      });
      expectFailedWithCode(
        await UserManager.deleteProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', 'id'),
        'VALIDATION_ERROR',
      );
    });

    it('returns ok:true — removes multiple key paths from a namespace', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { a: 1, b: 2, c: 3 },
      });

      const updated = expectOk(
        await UserManager.deleteProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', ['a', 'b']),
      );
      expect(updated.protectedAttributes).not.toHaveProperty('a');
      expect(updated.protectedAttributes).not.toHaveProperty('b');
      expect(updated.protectedAttributes.c).toBe(3);
    });

    it('accepts a single string path as well as an array', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { x: 1, y: 2 },
      });

      const updated = expectOk(
        await UserManager.deleteProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', 'x'),
      );
      expect(updated.protectedAttributes).not.toHaveProperty('x');
      expect(updated.protectedAttributes.y).toBe(2);
    });

    it('returns ok:false with partial successes when some paths are reserved', async () => {
      const user = await createUser('u1');
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { safe: 1 },
      });

      const result = await UserManager.deleteProtectedAttributeKeysByNamespaceForUser(
        user.id,
        'ns',
        ['id', 'safe'],
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.successes).toHaveLength(1);
        expect(result.successes[0].protectedAttributes).not.toHaveProperty('safe');
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe('VALIDATION_ERROR');
        expect(result.failures[0].details?.keyPath).toBe('id');
      }
    });

    it('returns ok:false with NOT_FOUND for unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.deleteProtectedAttributeKeysByNamespaceForUser('nobody', 'ns', ['x']),
        'NOT_FOUND',
      );
    });

    it('returns ok:false with NOT_FOUND for nonexistent namespace', async () => {
      const user = await createUser('u1');
      expectFailedWithCode(
        await UserManager.deleteProtectedAttributeKeysByNamespaceForUser(user.id, 'no-ns', ['x']),
        'NOT_FOUND',
      );
    });
  });

  describe('cache vs DB consistency', () => {
    it('cache reflects DB state after a simulated restart (re-init)', async () => {
      await UserManager.createUsers([
        { uniqueIdentifier: 'r1', attributes: { val: 1 } },
        { uniqueIdentifier: 'r2', attributes: { val: 2 } },
      ]);
      const u1 = UserManager.getUserByUniqueIdentifier('r1')!;
      await UserManager.setProtectedAttributesForUser(u1.id, {
        namespace: 'ns',
        protectedAttributes: { secret: 'xyz' },
      });

      await UserManager.shutdown();
      await UserManager.init();

      expect(UserManager.getAllUsers()).toHaveLength(2);
      expect(UserManager.getUserByUniqueIdentifier('r1')).not.toBeNull();

      const reloaded = UserManager.getUserByUniqueIdentifier('r1')!;
      const pa = UserManager.getAllProtectedAttributesForUser(reloaded.id);
      expect(pa).toHaveLength(1);
      expect(pa[0].protectedAttributes).toMatchObject({ secret: 'xyz' });
    });

    it('DB and cache agree after a series of mutations', async () => {
      const user = await createUser('u1', { score: 0 });

      await UserManager.updateUserById(user.id, { score: 10 });
      await UserManager.setProtectedAttributesForUser(user.id, {
        namespace: 'ns',
        protectedAttributes: { key: 'value' },
      });
      await UserManager.setProtectedAttributeKeysByNamespaceForUser(user.id, 'ns', {
        key: 'updated',
      });

      expect(UserManager.getUserById(user.id)!.score).toBe(10);
      expect(
        UserManager.getProtectedAttributesForUser(user.id, ['ns'])[0].protectedAttributes.key,
      ).toBe('updated');

      const dbUsers = await dm.getAllInCollection<any>(USERS);
      expect(dbUsers[0].score).toBe(10);
      const dbPa = await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES);
      expect(dbPa[0].protectedAttributes.key).toBe('updated');
    });

    it('CoreResult shape is consistent across single and bulk operations', async () => {
      const single = await UserManager.createUser({
        uniqueIdentifier: 'shape-test',
        attributes: {},
      });
      expect(single).toHaveProperty('ok');
      expect(single).toHaveProperty('successes');
      if (!single.ok) expect(single).toHaveProperty('failures');

      const bulk = await UserManager.createUsers([
        { uniqueIdentifier: 'bulk-shape-1', attributes: {} },
        { uniqueIdentifier: 'bulk-shape-2', attributes: {} },
      ]);
      expect(bulk).toHaveProperty('ok');
      expect(bulk).toHaveProperty('successes');
      if (!bulk.ok) expect(bulk).toHaveProperty('failures');
    });
  });
});
