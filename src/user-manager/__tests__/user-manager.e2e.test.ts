import { MongoMemoryReplSet } from 'mongodb-memory-server';
import sinon from 'sinon';

import DataManager from '../../data-manager/data-manager';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import { UserManager, TestingUserManager } from '../index';
import { DBType, USERS, PROTECTED_ATTRIBUTES } from '../../data-manager/data-manager.constants';
import { waitForMongoReady } from '../../testing';


/**
 * UserManager end-to-end tests
 *
 * Goals:
 * - Exercise every public UserManager API against real Mongo infrastructure.
 * - Cover happy paths, edge cases, and error/invalid-input paths.
 * - Verify cache consistency after every mutation.
 * - Verify DB state directly via DataManager as a secondary assertion source.
 *
 */

jest.setTimeout(120_000);

describe('User Manager public API e2e', () => {

  let repl: MongoMemoryReplSet;
  let dm: DataManager;
  let sb: sinon.SinonSandbox;

  beforeAll(async () => {
    sb = sinon.createSandbox();

    repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = repl.getUri();
    await waitForMongoReady(uri);

    const realInit = MongoDBManager.init.bind(MongoDBManager);
    sb.stub(MongoDBManager, 'init').callsFake(() => realInit(uri, 'user-manager-e2e'));

    dm = DataManager.getInstance();
    await dm.init(DBType.MONGO);
    await UserManager.init();
  });

  afterAll(async () => {
    try { await UserManager.shutdown(); } catch {}
    try { await dm.close(); } catch {}
    try { await repl.stop(); } catch {}
    try { sb.restore(); } catch {}
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
  ) {
    return UserManager.createUser({ uniqueIdentifier, attributes });
  }

  describe("users", () => {

    describe('createUser', () => {
      it('creates a user and returns it with an id', async () => {
        const user = await createUser('u1', { name: 'Alice' });

        expect(user).not.toBeNull();
        expect(user!.id).toEqual(expect.any(String));
        expect(user!.uniqueIdentifier).toBe('u1');
        expect(user!.name).toBe('Alice');
      });

      it('persists the user to the DB', async () => {
        await createUser('u1');

        const all = await dm.getAllInCollection<any>(USERS);
        expect(all).toHaveLength(1);
        expect(all[0].uniqueIdentifier).toBe('u1');
      });

      it('does not expose _id — only id', async () => {
        const user = await createUser('u1');

        expect((user as any)._id).toBeUndefined();
        expect(user!.id).toEqual(expect.any(String));
      });

      it('returns null for duplicate uniqueIdentifier', async () => {
        await createUser('u1');
        const duplicate = await createUser('u1');

        expect(duplicate).toBeNull();
      });

      it('returns null for invalid input', async () => {
        // @ts-expect-error intentional
        expect(await UserManager.createUser(null)).toBeNull();
        // @ts-expect-error intentional
        expect(await UserManager.createUser({})).toBeNull();
        expect(await UserManager.createUser({ uniqueIdentifier: '', attributes: {} })).toBeNull();
      });

      it('throws if attributes contain reserved key "id"', async () => {
        await expect(
          UserManager.createUser({ uniqueIdentifier: 'u1', attributes: { id: 'hack' } }),
        ).rejects.toThrow();
      });

      it('throws if attributes contain reserved key "uniqueIdentifier"', async () => {
        await expect(
          UserManager.createUser({
            uniqueIdentifier: 'u1',
            attributes: { uniqueIdentifier: 'hack' },
          }),
        ).rejects.toThrow();
      });

      it('preserves uniqueIdentifier with spaces exactly as provided', async () => {
        const user = await createUser('test mark');

        expect(user).not.toBeNull();
        expect(user!.uniqueIdentifier).toBe('test mark');
      });

      it('creates user with protected attributes in one call', async () => {
        const user = await UserManager.createUser({
          uniqueIdentifier: 'u-with-pa',
          attributes: { name: 'Bob' },
          protectedAttributes: [
            { namespace: 'health', protectedAttributes: { steps: 1000 } },
          ],
        });

        expect(user).not.toBeNull();

        const pa = UserManager.getAllProtectedAttributesForUser(user!.id);
        expect(pa).toHaveLength(1);
        expect(pa[0].namespace).toBe('health');
        expect(pa[0].protectedAttributes).toMatchObject({ steps: 1000 });
      });
    });

    describe('createUsers', () => {
      it('creates multiple users and returns them all', async () => {
        const users = await UserManager.createUsers([
          { uniqueIdentifier: 'bulk-1', attributes: { x: 1 } },
          { uniqueIdentifier: 'bulk-2', attributes: { x: 2 } },
          { uniqueIdentifier: 'bulk-3', attributes: { x: 3 } },
        ]);

        expect(users).toHaveLength(3);
        expect(users.map((u) => u.uniqueIdentifier).sort()).toEqual(['bulk-1', 'bulk-2', 'bulk-3']);
      });

      it('skips invalid records and returns only valid ones', async () => {
        const users = await UserManager.createUsers([
          { uniqueIdentifier: 'valid-1', attributes: {} },
          // @ts-expect-error intentional
          null,
          { uniqueIdentifier: 'valid-2', attributes: {} },
        ]);

        expect(users).toHaveLength(2);
      });

      it('throws for empty array', async () => {
        await expect(UserManager.createUsers([])).rejects.toThrow();
      });

      it('persists all created users to DB', async () => {
        await UserManager.createUsers([
          { uniqueIdentifier: 'p1', attributes: {} },
          { uniqueIdentifier: 'p2', attributes: {} },
        ]);

        const all = await dm.getAllInCollection<any>(USERS);
        expect(all).toHaveLength(2);
      });
    });

    describe('getUserById / getUserByUniqueIdentifier / getAllUsers', () => {
      it('getUserById returns the user from cache', async () => {
        const created = await createUser('u1', { name: 'Alice' });

        const found = UserManager.getUserById(created!.id);
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

      it('getUserByUniqueIdentifier matches exactly — does not trim', async () => {
        await createUser('test mark');

        expect(UserManager.getUserByUniqueIdentifier('test mark')).not.toBeNull();
        expect(UserManager.getUserByUniqueIdentifier('testmark')).toBeNull();
        expect(UserManager.getUserByUniqueIdentifier(' test mark ')).toBeNull();
      });

      it('getAllUsers returns all cached users', async () => {
        await UserManager.createUsers([
          { uniqueIdentifier: 'a1', attributes: {} },
          { uniqueIdentifier: 'a2', attributes: {} },
        ]);

        const all = UserManager.getAllUsers();
        expect(all).toHaveLength(2);
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

      it('throws for empty string', () => {
        expect(() => UserManager.isIdentifierUnique('')).toThrow();
      });
    });

    describe('updateUserById', () => {
      it('updates user attributes and returns the updated user', async () => {
        const user = await createUser('u1', { score: 10 });

        const updated = await UserManager.updateUserById(user!.id, { score: 20 });
        expect(updated.score).toBe(20);
        expect(updated.uniqueIdentifier).toBe('u1');
      });

      it('merges attributes — does not wipe unrelated fields', async () => {
        const user = await createUser('u1', { a: 1, b: 2 });

        const updated = await UserManager.updateUserById(user!.id, { b: 99 });
        expect(updated.a).toBe(1);
        expect(updated.b).toBe(99);
      });

      it('updates the cache so subsequent reads reflect the change', async () => {
        const user = await createUser('u1', { score: 10 });
        await UserManager.updateUserById(user!.id, { score: 42 });

        const fromCache = UserManager.getUserById(user!.id);
        expect(fromCache!.score).toBe(42);
      });

      it('persists the update to DB', async () => {
        const user = await createUser('u1', { score: 10 });
        await UserManager.updateUserById(user!.id, { score: 99 });

        const all = await dm.getAllInCollection<any>(USERS);
        expect(all[0].score).toBe(99);
      });

      it('throws for invalid userId', async () => {
        await expect(UserManager.updateUserById('', { score: 1 })).rejects.toThrow();
      });

      it('throws if user is not found', async () => {
        await expect(UserManager.updateUserById('nonexistent', { score: 1 })).rejects.toThrow();
      });

      it('throws when trying to update reserved field "id"', async () => {
        const user = await createUser('u1');
        await expect(
          UserManager.updateUserById(user!.id, { id: 'hack' }),
        ).rejects.toThrow();
      });

      it('throws when trying to update reserved field "uniqueIdentifier"', async () => {
        const user = await createUser('u1');
        await expect(
          UserManager.updateUserById(user!.id, { uniqueIdentifier: 'hack' }),
        ).rejects.toThrow();
      });
    });

    describe('updateUserByUniqueIdentifier', () => {
      it('updates user attributes by uniqueIdentifier', async () => {
        await createUser('u1', { score: 5 });

        const updated = await UserManager.updateUserByUniqueIdentifier('u1', { score: 50 });
        expect(updated).not.toBeNull();
        expect(updated!.score).toBe(50);
      });

      it('returns null for unknown uniqueIdentifier', async () => {
        const result = await UserManager.updateUserByUniqueIdentifier('nobody', { score: 1 });
        expect(result).toBeNull();
      });

      it('returns null for empty uniqueIdentifier', async () => {
        const result = await UserManager.updateUserByUniqueIdentifier('', { score: 1 });
        expect(result).toBeNull();
      });

      it('does not match on trimmed version — exact match required', async () => {
        await createUser('test mark');

        const result = await UserManager.updateUserByUniqueIdentifier(' test mark ', { x: 1 });
        expect(result).toBeNull();
      });
    });

    describe('deleteUserById', () => {
      it('deletes the user and returns true', async () => {
        const user = await createUser('u1');
        const result = await UserManager.deleteUserById(user!.id);

        expect(result).toBe(true);
      });

      it('removes user from cache after deletion', async () => {
        const user = await createUser('u1');
        await UserManager.deleteUserById(user!.id);

        expect(UserManager.getUserById(user!.id)).toBeNull();
        expect(UserManager.getUserByUniqueIdentifier('u1')).toBeNull();
      });

      it('removes user from DB after deletion', async () => {
        const user = await createUser('u1');
        await UserManager.deleteUserById(user!.id);

        const all = await dm.getAllInCollection<any>(USERS);
        expect(all).toHaveLength(0);
      });

      it('cascades and deletes all protected attributes', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, [
          { namespace: 'ns1', protectedAttributes: { x: 1 } },
          { namespace: 'ns2', protectedAttributes: { y: 2 } },
        ]);

        await UserManager.deleteUserById(user!.id);

        const paDocs = await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES);
        expect(paDocs).toHaveLength(0);
      });

      it('returns false for unknown userId', async () => {
        const result = await UserManager.deleteUserById('nonexistent');
        expect(result).toBe(false);
      });

      it('returns false for empty userId', async () => {
        expect(await UserManager.deleteUserById('')).toBe(false);
      });
    });

    describe('deleteUserByUniqueIdentifier', () => {
      it('deletes user by uniqueIdentifier', async () => {
        await createUser('u1');
        const result = await UserManager.deleteUserByUniqueIdentifier('u1');

        expect(result).toBe(true);
        expect(UserManager.getUserByUniqueIdentifier('u1')).toBeNull();
      });

      it('returns false for unknown uniqueIdentifier', async () => {
        expect(await UserManager.deleteUserByUniqueIdentifier('nobody')).toBe(false);
      });

      it('requires exact match — does not trim', async () => {
        await createUser('test mark');
        const result = await UserManager.deleteUserByUniqueIdentifier(' test mark ');
        expect(result).toBe(false);

        // user still exists
        expect(UserManager.getUserByUniqueIdentifier('test mark')).not.toBeNull();
      });

      it('cascades protected attribute deletion', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, [
          { namespace: 'health', protectedAttributes: { steps: 500 } },
        ]);

        await UserManager.deleteUserByUniqueIdentifier('u1');

        const paDocs = await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES);
        expect(paDocs).toHaveLength(0);
      });
    });

    describe('deleteAllUsers', () => {
    it('clears all users and protected attributes', async () => {
      const u1 = await createUser('u1');
      const u2 = await createUser('u2');

      await UserManager.setProtectedAttributesForUser(u1!.id, [
        { namespace: 'ns', protectedAttributes: { a: 1 } },
      ]);
      await UserManager.setProtectedAttributesForUser(u2!.id, [
        { namespace: 'ns', protectedAttributes: { b: 2 } },
      ]);

      await UserManager.deleteAllUsers();

      expect(UserManager.getAllUsers()).toHaveLength(0);
      expect(await dm.getAllInCollection<any>(USERS)).toHaveLength(0);
      expect(await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES)).toHaveLength(0);
    });
  });
  })

  describe('ProtectedAttributes', () => {

    describe('setProtectedAttributesForUser', () => {
      it('creates a new protected attributes record', async () => {
        const user = await createUser('u1');

        const results = await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'health',
          protectedAttributes: { steps: 1000 },
        });

        expect(results).toHaveLength(1);
        expect(results[0].namespace).toBe('health');
        expect(results[0].protectedAttributes).toMatchObject({ steps: 1000 });
      });

      it('shallow-merges into existing record', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'health',
          protectedAttributes: { steps: 1000, weight: 70 },
        });

        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'health',
          protectedAttributes: { steps: 2000 },
        });

        const pa = UserManager.getProtectedAttributesForUser(user!.id, ['health']);
        expect(pa[0].protectedAttributes).toMatchObject({ steps: 2000, weight: 70 });
      });

      it('creates multiple namespaces in one call', async () => {
        const user = await createUser('u1');

        const results = await UserManager.setProtectedAttributesForUser(user!.id, [
          { namespace: 'ns1', protectedAttributes: { a: 1 } },
          { namespace: 'ns2', protectedAttributes: { b: 2 } },
        ]);

        expect(results).toHaveLength(2);
        const all = UserManager.getAllProtectedAttributesForUser(user!.id);
        expect(all).toHaveLength(2);
      });

      it('persists to DB', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { secret: 'abc' },
        });

        const all = await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES);
        expect(all).toHaveLength(1);
        expect(all[0].protectedAttributes).toMatchObject({ secret: 'abc' });
      });

      it('returns empty array for unknown userId', async () => {
        const result = await UserManager.setProtectedAttributesForUser('nonexistent', {
          namespace: 'ns',
          protectedAttributes: { x: 1 },
        });
        expect(result).toEqual([]);
      });

      it('skips items with invalid namespace', async () => {
        const user = await createUser('u1');

        const results = await UserManager.setProtectedAttributesForUser(user!.id, [
          { namespace: '', protectedAttributes: { x: 1 } },
          { namespace: 'valid', protectedAttributes: { y: 2 } },
        ]);

        expect(results).toHaveLength(1);
        expect(results[0].namespace).toBe('valid');
      });

      it('preserves namespace with spaces exactly as provided', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'my namespace',
          protectedAttributes: { x: 1 },
        });

        const pa = UserManager.getProtectedAttributesForUser(user!.id, ['my namespace']);
        expect(pa).toHaveLength(1);
      });

      it('throws if protectedAttributes contain reserved key', async () => {
        const user = await createUser('u1');

        await expect(
          UserManager.setProtectedAttributesForUser(user!.id, {
            namespace: 'ns',
            protectedAttributes: { id: 'hack' },
          }),
        ).rejects.toThrow();
      });
    });

    describe('getProtectedAttributesForUser / getAllProtectedAttributesForUser', () => {
      it('getProtectedAttributesForUser returns only requested namespaces', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, [
          { namespace: 'ns1', protectedAttributes: { a: 1 } },
          { namespace: 'ns2', protectedAttributes: { b: 2 } },
          { namespace: 'ns3', protectedAttributes: { c: 3 } },
        ]);

        const pa = UserManager.getProtectedAttributesForUser(user!.id, ['ns1', 'ns3']);
        expect(pa).toHaveLength(2);
        expect(pa.map((r) => r.namespace).sort()).toEqual(['ns1', 'ns3']);
      });

      it('getAllProtectedAttributesForUser returns every namespace', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, [
          { namespace: 'a', protectedAttributes: {} },
          { namespace: 'b', protectedAttributes: {} },
          { namespace: 'c', protectedAttributes: {} },
        ]);

        const all = UserManager.getAllProtectedAttributesForUser(user!.id);
        expect(all).toHaveLength(3);
      });

      it('returns empty array for user with no protected attributes', async () => {
        const user = await createUser('u1');
        expect(UserManager.getAllProtectedAttributesForUser(user!.id)).toEqual([]);
      });

      it('returns empty array for unknown userId', () => {
        expect(UserManager.getProtectedAttributesForUser('nobody', ['ns'])).toEqual([]);
        expect(UserManager.getAllProtectedAttributesForUser('nobody')).toEqual([]);
      });

      it('filters out invalid namespaces silently', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'real',
          protectedAttributes: { x: 1 },
        });

        const pa = UserManager.getProtectedAttributesForUser(user!.id, ['real', '', 'nonexistent']);
        expect(pa).toHaveLength(1);
        expect(pa[0].namespace).toBe('real');
      });
    });

    describe('updateProtectedAttributeForUser', () => {
      it('sets a top-level key', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { a: 1, b: 2 },
        });

        const updated = await UserManager.updateProtectedAttributeForUser(user!.id, 'ns', 'a', 99);
        expect(updated).not.toBeNull();
        expect(updated!.protectedAttributes).toMatchObject({ a: 99, b: 2 });
      });

      it('sets a nested key via dot notation', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { daily: { steps: 100 } },
        });

        const updated = await UserManager.updateProtectedAttributeForUser(
          user!.id,
          'ns',
          'daily.steps',
          9999,
        );
        expect(updated!.protectedAttributes.daily.steps).toBe(9999);
      });

      it('creates intermediate objects for deep paths', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: {},
        });

        const updated = await UserManager.updateProtectedAttributeForUser(
          user!.id,
          'ns',
          'a.b.c',
          'deep',
        );
        expect(updated!.protectedAttributes.a.b.c).toBe('deep');
      });

      it('updates the cache', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { x: 0 },
        });

        await UserManager.updateProtectedAttributeForUser(user!.id, 'ns', 'x', 42);

        const pa = UserManager.getProtectedAttributesForUser(user!.id, ['ns']);
        expect(pa[0].protectedAttributes.x).toBe(42);
      });

      it('returns null for unknown userId', async () => {
        const result = await UserManager.updateProtectedAttributeForUser(
          'nonexistent',
          'ns',
          'x',
          1,
        );
        expect(result).toBeNull();
      });

      it('returns null if namespace does not exist', async () => {
        const user = await createUser('u1');
        const result = await UserManager.updateProtectedAttributeForUser(
          user!.id,
          'nonexistent-ns',
          'x',
          1,
        );
        expect(result).toBeNull();
      });

      it('throws if path contains reserved key', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: {},
        });

        await expect(
          UserManager.updateProtectedAttributeForUser(user!.id, 'ns', 'id', 'hack'),
        ).rejects.toThrow();

        await expect(
          UserManager.updateProtectedAttributeForUser(user!.id, 'ns', 'namespace', 'hack'),
        ).rejects.toThrow();
      });
    });

    describe('updateProtectedAttributesForUser', () => {
      it('updates multiple key paths in one call', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { a: 1, b: 2, c: 3 },
        });

        const updated = await UserManager.updateProtectedAttributesForUser(user!.id, 'ns', {
          a: 10,
          'b': 20,
        });

        expect(updated!.protectedAttributes).toMatchObject({ a: 10, b: 20, c: 3 });
      });

      it('supports dot-notation paths in the updates object', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { daily: { steps: 0, calories: 0 } },
        });

        const updated = await UserManager.updateProtectedAttributesForUser(user!.id, 'ns', {
          'daily.steps': 5000,
          'daily.calories': 200,
        });

        expect(updated!.protectedAttributes.daily).toMatchObject({ steps: 5000, calories: 200 });
      });

      it('returns null for unknown userId', async () => {
        const result = await UserManager.updateProtectedAttributesForUser('nobody', 'ns', { x: 1 });
        expect(result).toBeNull();
      });

      it('returns null if namespace does not exist', async () => {
        const user = await createUser('u1');
        const result = await UserManager.updateProtectedAttributesForUser(user!.id, 'ns', { x: 1 });
        expect(result).toBeNull();
      });

      it('throws if any path contains a reserved key', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: {},
        });

        await expect(
          UserManager.updateProtectedAttributesForUser(user!.id, 'ns', { id: 'hack' }),
        ).rejects.toThrow();
      });
    });

    describe('deleteProtectedAttributesForUser', () => {
      it('deletes a single namespace', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, [
          { namespace: 'ns1', protectedAttributes: { a: 1 } },
          { namespace: 'ns2', protectedAttributes: { b: 2 } },
        ]);

        const result = await UserManager.deleteProtectedAttributesForUser(user!.id, 'ns1');
        expect(result).toBe(true);

        const remaining = UserManager.getAllProtectedAttributesForUser(user!.id);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].namespace).toBe('ns2');
      });

      it('deletes multiple namespaces at once', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, [
          { namespace: 'ns1', protectedAttributes: {} },
          { namespace: 'ns2', protectedAttributes: {} },
          { namespace: 'ns3', protectedAttributes: {} },
        ]);

        const result = await UserManager.deleteProtectedAttributesForUser(user!.id, ['ns1', 'ns2']);
        expect(result).toBe(true);

        const remaining = UserManager.getAllProtectedAttributesForUser(user!.id);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].namespace).toBe('ns3');
      });

      it('updates cache after deletion', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { x: 1 },
        });

        await UserManager.deleteProtectedAttributesForUser(user!.id, 'ns');

        expect(UserManager.getProtectedAttributesForUser(user!.id, ['ns'])).toEqual([]);
      });

      it('removes from DB', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: {},
        });

        await UserManager.deleteProtectedAttributesForUser(user!.id, 'ns');

        expect(await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES)).toHaveLength(0);
      });

      it('returns false for unknown userId', async () => {
        expect(await UserManager.deleteProtectedAttributesForUser('nobody', 'ns')).toBe(false);
      });

      it('returns false if namespace does not exist', async () => {
        const user = await createUser('u1');
        expect(await UserManager.deleteProtectedAttributesForUser(user!.id, 'no-such-ns')).toBe(false);
      });
    });

    describe('deleteAllProtectedAttributesForUser', () => {
      it('deletes all namespaces for the user', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, [
          { namespace: 'ns1', protectedAttributes: {} },
          { namespace: 'ns2', protectedAttributes: {} },
        ]);

        await UserManager.deleteAllProtectedAttributesForUser(user!.id);

        expect(UserManager.getAllProtectedAttributesForUser(user!.id)).toHaveLength(0);
        expect(await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES)).toHaveLength(0);
      });

      it('is a no-op for a user with no protected attributes', async () => {
        const user = await createUser('u1');
        await expect(
          UserManager.deleteAllProtectedAttributesForUser(user!.id),
        ).resolves.not.toThrow();
      });

      it('does not affect other users protected attributes', async () => {
        const u1 = await createUser('u1');
        const u2 = await createUser('u2');

        await UserManager.setProtectedAttributesForUser(u1!.id, {
          namespace: 'ns',
          protectedAttributes: { a: 1 },
        });
        await UserManager.setProtectedAttributesForUser(u2!.id, {
          namespace: 'ns',
          protectedAttributes: { b: 2 },
        });

        await UserManager.deleteAllProtectedAttributesForUser(u1!.id);

        expect(UserManager.getAllProtectedAttributesForUser(u2!.id)).toHaveLength(1);
      });
    });

    describe('deleteProtectedAttributeForUser', () => {
      it('removes a top-level key', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { a: 1, b: 2 },
        });

        const updated = await UserManager.deleteProtectedAttributeForUser(user!.id, 'ns', 'a');
        expect(updated!.protectedAttributes).not.toHaveProperty('a');
        expect(updated!.protectedAttributes.b).toBe(2);
      });

      it('removes a nested key via dot notation', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { daily: { steps: 100, calories: 200 } },
        });

        const updated = await UserManager.deleteProtectedAttributeForUser(
          user!.id,
          'ns',
          'daily.steps',
        );
        expect(updated!.protectedAttributes.daily).not.toHaveProperty('steps');
        expect(updated!.protectedAttributes.daily.calories).toBe(200);
      });

      it('updates cache after key deletion', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { x: 1, y: 2 },
        });

        await UserManager.deleteProtectedAttributeForUser(user!.id, 'ns', 'x');

        const pa = UserManager.getProtectedAttributesForUser(user!.id, ['ns']);
        expect(pa[0].protectedAttributes).not.toHaveProperty('x');
      });

      it('returns null for unknown userId', async () => {
        const result = await UserManager.deleteProtectedAttributeForUser('nobody', 'ns', 'x');
        expect(result).toBeNull();
      });

      it('returns null if namespace does not exist', async () => {
        const user = await createUser('u1');
        const result = await UserManager.deleteProtectedAttributeForUser(user!.id, 'no-ns', 'x');
        expect(result).toBeNull();
      });

      it('throws if path contains reserved key', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: {},
        });

        await expect(
          UserManager.deleteProtectedAttributeForUser(user!.id, 'ns', 'id'),
        ).rejects.toThrow();
      });
    });

    describe('deleteProtectedAttributesFromNamespaceForUser', () => {
      it('removes multiple key paths from a namespace', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { a: 1, b: 2, c: 3 },
        });

        const updated = await UserManager.deleteProtectedAttributesFromNamespaceForUser(
          user!.id,
          'ns',
          ['a', 'b'],
        );

        expect(updated!.protectedAttributes).not.toHaveProperty('a');
        expect(updated!.protectedAttributes).not.toHaveProperty('b');
        expect(updated!.protectedAttributes.c).toBe(3);
      });

      it('accepts a single string path as well as an array', async () => {
        const user = await createUser('u1');
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { x: 1, y: 2 },
        });

        const updated = await UserManager.deleteProtectedAttributesFromNamespaceForUser(
          user!.id,
          'ns',
          'x',
        );
        expect(updated!.protectedAttributes).not.toHaveProperty('x');
        expect(updated!.protectedAttributes.y).toBe(2);
      });

      it('returns null for unknown userId', async () => {
        const result = await UserManager.deleteProtectedAttributesFromNamespaceForUser(
          'nobody',
          'ns',
          ['x'],
        );
        expect(result).toBeNull();
      });

      it('returns null if namespace does not exist', async () => {
        const user = await createUser('u1');
        const result = await UserManager.deleteProtectedAttributesFromNamespaceForUser(
          user!.id,
          'no-ns',
          ['x'],
        );
        expect(result).toBeNull();
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

        // Simulate restart
        await UserManager.shutdown();
        await UserManager.init();

        // Users should be back in cache
        expect(UserManager.getAllUsers()).toHaveLength(2);
        expect(UserManager.getUserByUniqueIdentifier('r1')).not.toBeNull();

        // Protected attributes should be back in cache
        const reloadedU1 = UserManager.getUserByUniqueIdentifier('r1')!;
        const pa = UserManager.getAllProtectedAttributesForUser(reloadedU1.id);
        expect(pa).toHaveLength(1);
        expect(pa[0].protectedAttributes).toMatchObject({ secret: 'xyz' });
      });

      it('DB and cache agree after a series of mutations', async () => {
        const user = await createUser('u1', { score: 0 });

        await UserManager.updateUserById(user!.id, { score: 10 });
        await UserManager.setProtectedAttributesForUser(user!.id, {
          namespace: 'ns',
          protectedAttributes: { key: 'value' },
        });
        await UserManager.updateProtectedAttributeForUser(user!.id, 'ns', 'key', 'updated');

        // Cache
        const fromCache = UserManager.getUserById(user!.id);
        expect(fromCache!.score).toBe(10);
        const paFromCache = UserManager.getProtectedAttributesForUser(user!.id, ['ns']);
        expect(paFromCache[0].protectedAttributes.key).toBe('updated');

        // DB
        const dbUsers = await dm.getAllInCollection<any>(USERS);
        expect(dbUsers[0].score).toBe(10);
        const dbPa = await dm.getAllInCollection<any>(PROTECTED_ATTRIBUTES);
        expect(dbPa[0].protectedAttributes.key).toBe('updated');
      });
    });
  });
});
