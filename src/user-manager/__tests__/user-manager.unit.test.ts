import {
  makeTestJUser,
  expectOk,
  expectFailed,
  expectFailedWithCode,
  makeCoreManagersSandbox,
  loggerSpies,
  resetGlobalLoggerState,
} from '../../testing';
import type { CoreManagersSandbox, LoggerSpies } from '../../testing';
import { JustinErrorCode } from '../../errors';
import { UserManager } from '../user-manager';
import { clearUsersCache, upsertUserInCache } from '../users/cache';
import {
  clearProtectedAttributesCache,
  upsertProtectedAttributesInCache,
} from '../protected-attributes/cache';
import type { ProtectedAttributesRecord } from '../types';

describe('UserManager unit tests', () => {
  let t: CoreManagersSandbox;
  let lg: LoggerSpies;

  beforeEach(() => {
    t?.restore();
    lg?.restore();
    t = makeCoreManagersSandbox();
    lg = loggerSpies();
    clearUsersCache();
    clearProtectedAttributesCache();
  });

  afterEach(() => {
    t?.restore();
    lg?.restore();
    resetGlobalLoggerState();
    clearUsersCache();
    clearProtectedAttributesCache();
  });

  function makePA(overrides: Partial<ProtectedAttributesRecord> = {}): ProtectedAttributesRecord {
    return {
      id: overrides.id ?? 'pa1',
      uniqueIdentifier: overrides.uniqueIdentifier ?? 'alice',
      namespace: overrides.namespace ?? 'health',
      protectedAttributes: overrides.protectedAttributes ?? { steps: 1000 },
    };
  }

  describe('init', () => {
    it('calls dm.init', async () => {
      await UserManager.init();
      expect((t.dm as any).init.calledOnce).toBe(true);
    });

    it('ensures stores for users and protected_attributes', async () => {
      await UserManager.init();
      expect((t.dm as any).ensureStore.calledWith('users')).toBe(true);
      expect((t.dm as any).ensureStore.calledWith('protected_attributes')).toBe(true);
    });

    it('sets up change listeners for users and protected_attributes', async () => {
      await UserManager.init();
      const collections = (t.clm as any).addChangeListener.args.map(([col]: [string]) => col);
      expect(collections).toContain('users');
      expect(collections).toContain('protected_attributes');
    });
  });

  describe('shutdown', () => {
    it('removes all change listeners', async () => {
      await UserManager.shutdown();
      expect((t.clm as any).removeChangeListener.callCount).toBe(6);
    });
  });

  describe('createUser — uniqueIdentifier trimming', () => {
    it('trims leading and trailing whitespace before delegating to crud', async () => {
      const user = makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' });
      (t.dm as any).addItemToCollection.resolves({ ok: true, successes: [user] });

      const result = await UserManager.createUser({
        uniqueIdentifier: '  alice  ',
        attributes: {},
      });

      expectOk(result);
      expect(result.successes[0].uniqueIdentifier).toBe('alice');
    });

    it('passes through unchanged when uniqueIdentifier has no extra whitespace', async () => {
      const user = makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' });
      (t.dm as any).addItemToCollection.resolves({ ok: true, successes: [user] });

      const result = await UserManager.createUser({
        uniqueIdentifier: 'alice',
        attributes: {},
      });

      expectOk(result);
    });

    it('returns ok:true even when protectedAttributes creation fails — user is still returned', async () => {
      const user = makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' });
      (t.dm as any).addItemToCollection.resolves({ ok: true, successes: [user] });
      (t.dm as any).findItemsInCollection.resolves([]);
      // Make PA creation fail
      (t.dm as any).addItemToCollection
        .onFirstCall()
        .resolves({ ok: true, successes: [user] })
        .onSecondCall()
        .resolves({
          ok: false,
          successes: [],
          failures: [{ code: 'DB_ERROR', reason: 'PA failed' }],
        });

      const result = await UserManager.createUser({
        uniqueIdentifier: 'alice',
        attributes: {},
        protectedAttributes: [{ namespace: 'health', protectedAttributes: { steps: 0 } }],
      });

      // User is returned even though PA failed
      expect(result.ok).toBe(true);
    });
  });

  describe('createUsers — uniqueIdentifier trimming', () => {
    it('trims each uniqueIdentifier before delegating to crud', async () => {
      const user = makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' });
      (t.dm as any).addItemToCollection.resolves({ ok: true, successes: [user] });

      const result = await UserManager.createUsers([
        { uniqueIdentifier: '  alice  ', attributes: {} },
      ]);

      expectOk(result);
    });

    it('returns ok:true with empty successes for empty input', async () => {
      const result = await UserManager.createUsers([]);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });
  });

  describe('deleteUserById', () => {
    it('returns VALIDATION_ERROR for empty userId', async () => {
      expectFailedWithCode(await UserManager.deleteUserById(''), JustinErrorCode.VALIDATION_ERROR);
    });

    it('returns NOT_FOUND when user is not in cache', async () => {
      expectFailedWithCode(await UserManager.deleteUserById('ghost'), JustinErrorCode.NOT_FOUND);
    });

    it('returns ok:true on successful deletion', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      (t.dm as any).removeItemFromCollection.resolves({ ok: true, successes: [null] });
      (t.dm as any).getAllInCollection.resolves([]);
      (t.dm as any).findItemsInCollection.resolves([]);

      const result = await UserManager.deleteUserById('u1');

      expectOk(result);
    });

    it('clears and refreshes the users cache after deletion', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      (t.dm as any).removeItemFromCollection.resolves({ ok: true, successes: [null] });
      (t.dm as any).getAllInCollection.resolves([]);
      (t.dm as any).findItemsInCollection.resolves([]);

      await UserManager.deleteUserById('u1');

      expect(UserManager.getUserById('u1')).toBeNull();
    });

    it('returns a failure when the DB remove fails', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      (t.dm as any).removeItemFromCollection.resolves({
        ok: false,
        successes: [],
        failures: [{ code: 'DB_ERROR', reason: 'failed' }],
      });
      (t.dm as any).findItemsInCollection.resolves([]);

      expectFailed(await UserManager.deleteUserById('u1'));
    });
  });

  describe('deleteUserByUniqueIdentifier', () => {
    it('returns VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await UserManager.deleteUserByUniqueIdentifier(''),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns NOT_FOUND when user is not in cache', async () => {
      expectFailedWithCode(
        await UserManager.deleteUserByUniqueIdentifier('nobody'),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('resolves uniqueIdentifier to id and delegates to deleteUserById', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      (t.dm as any).removeItemFromCollection.resolves({ ok: true, successes: [null] });
      (t.dm as any).getAllInCollection.resolves([]);
      (t.dm as any).findItemsInCollection.resolves([]);

      const result = await UserManager.deleteUserByUniqueIdentifier('alice');

      expectOk(result);
    });
  });

  describe('deleteAllUsers', () => {
    it('returns ok:true and clears both collections and caches', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      upsertProtectedAttributesInCache(makePA());

      const result = await UserManager.deleteAllUsers();

      expectOk(result);
      expect(UserManager.getAllUsers()).toHaveLength(0);
      expect(UserManager.getAllProtectedAttributesForUser('u1')).toHaveLength(0);
      expect((t.dm as any).clearCollection.calledWith('users')).toBe(true);
      expect((t.dm as any).clearCollection.calledWith('protected_attributes')).toBe(true);
    });

    it('returns ok:false when the users collection clear fails', async () => {
      (t.dm as any).clearCollection.resolves({
        ok: false,
        successes: [],
        failures: [{ code: JustinErrorCode.DB_ERROR, reason: 'clear failed' }],
      });

      expectFailed(await UserManager.deleteAllUsers());
    });
  });

  describe('getAllProtectedAttributesForUser', () => {
    it('returns all PA records for a known user', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      upsertProtectedAttributesInCache(makePA({ uniqueIdentifier: 'alice', namespace: 'health' }));
      upsertProtectedAttributesInCache(
        makePA({ id: 'pa2', uniqueIdentifier: 'alice', namespace: 'fitness' }),
      );

      expect(UserManager.getAllProtectedAttributesForUser('u1')).toHaveLength(2);
    });

    it('returns empty array and logs a warning for an unknown userId', () => {
      const result = UserManager.getAllProtectedAttributesForUser('ghost');

      expect(result).toHaveLength(0);
      expect(lg.findByMessage('userId invalid or user not found')).toHaveLength(1);
    });
  });

  describe('getProtectedAttributesForUser', () => {
    it('returns only the requested namespaces for a known user', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      upsertProtectedAttributesInCache(makePA({ uniqueIdentifier: 'alice', namespace: 'health' }));
      upsertProtectedAttributesInCache(
        makePA({ id: 'pa2', uniqueIdentifier: 'alice', namespace: 'fitness' }),
      );

      const result = UserManager.getProtectedAttributesForUser('u1', ['health']);

      expect(result).toHaveLength(1);
      expect(result[0].namespace).toBe('health');
    });

    it('returns empty array and logs a warning for an unknown userId', () => {
      const result = UserManager.getProtectedAttributesForUser('ghost', ['health']);

      expect(result).toHaveLength(0);
      expect(lg.findByMessage('userId invalid or user not found')).toHaveLength(1);
    });
  });

  describe('setProtectedAttributesForUser', () => {
    it('returns NOT_FOUND for an unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.setProtectedAttributesForUser('ghost', {
          namespace: 'health',
          protectedAttributes: {},
        }),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('resolves userId to uniqueIdentifier and delegates to PA crud', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      const pa = makePA({ uniqueIdentifier: 'alice' });
      (t.dm as any).findItemsInCollection.resolves([]);
      (t.dm as any).addItemToCollection.resolves({ ok: true, successes: [pa] });

      const result = await UserManager.setProtectedAttributesForUser('u1', {
        namespace: 'health',
        protectedAttributes: { steps: 1000 },
      });

      expectOk(result);
    });
  });

  describe('updateProtectedAttributeForUser', () => {
    it('returns NOT_FOUND for an unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.updateProtectedAttributeForUser('ghost', 'health', 'steps', 1),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('resolves userId to uniqueIdentifier and delegates', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      const existing = makePA({ uniqueIdentifier: 'alice', protectedAttributes: { steps: 0 } });
      const updated = makePA({ uniqueIdentifier: 'alice', protectedAttributes: { steps: 42 } });
      (t.dm as any).findItemsInCollection.resolves([existing]);
      (t.dm as any).updateItemByIdInCollection.resolves({ ok: true, successes: [updated] });

      const result = await UserManager.updateProtectedAttributeForUser('u1', 'health', 'steps', 42);

      expectOk(result);
    });
  });

  describe('deleteProtectedAttributesForUser', () => {
    it('returns NOT_FOUND for an unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.deleteProtectedAttributesForUser('ghost', 'health'),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('resolves userId to uniqueIdentifier and delegates to PA crud', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      (t.dm as any).findItemsInCollection
        .onFirstCall()
        .resolves([makePA({ uniqueIdentifier: 'alice' })])
        .onSecondCall()
        .resolves([]);
      (t.dm as any).removeItemsFromCollection.resolves({ ok: true, successes: [{ id: 'pa1' }] });

      const result = await UserManager.deleteProtectedAttributesForUser('u1', 'health');

      expectOk(result);
    });
  });

  describe('deleteAllProtectedAttributesForUser', () => {
    it('returns NOT_FOUND for an unknown userId', async () => {
      const result = await UserManager.deleteAllProtectedAttributesForUser('ghost');

      expectFailedWithCode(result, JustinErrorCode.NOT_FOUND);
      expect((t.dm as any).findItemsInCollection.called).toBe(false);
    });

    it('returns ok:true and deletes all PA records for a known user', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      (t.dm as any).findItemsInCollection.resolves([makePA({ uniqueIdentifier: 'alice' })]);
      (t.dm as any).removeItemsFromCollection.resolves({ ok: true, successes: [{ id: 'pa1' }] });

      const result = await UserManager.deleteAllProtectedAttributesForUser('u1');

      expectOk(result);
    });

    it('returns ok:false when the DB removal fails', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      (t.dm as any).findItemsInCollection.resolves([makePA({ uniqueIdentifier: 'alice' })]);
      (t.dm as any).removeItemsFromCollection.resolves({
        ok: false,
        successes: [],
        failures: [{ code: JustinErrorCode.DB_ERROR, reason: 'write failed' }],
      });

      expectFailed(await UserManager.deleteAllProtectedAttributesForUser('u1'));
    });
  });

  describe('deleteProtectedAttributeForUser', () => {
    it('returns NOT_FOUND for an unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.deleteProtectedAttributeForUser('ghost', 'health', 'steps'),
        JustinErrorCode.NOT_FOUND,
      );
    });
  });

  describe('deleteProtectedAttributesFromNamespaceForUser', () => {
    it('returns NOT_FOUND for an unknown userId', async () => {
      expectFailedWithCode(
        await UserManager.deleteProtectedAttributesFromNamespaceForUser('ghost', 'health', [
          'steps',
        ]),
        JustinErrorCode.NOT_FOUND,
      );
    });
  });
});
