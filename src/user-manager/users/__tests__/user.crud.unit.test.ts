import {
  makeTestJUser,
  makeTestNewUserRecord,
  expectOk,
  expectFailed,
  expectFailedWithCode,
  makeCoreManagersSandbox,
  loggerSpies,
  resetGlobalLoggerState,
} from '../../../testing';
import type { CoreManagersSandbox, LoggerSpies } from '../../../testing';
import { JustinErrorCode } from '../../../errors';
import {
  clearUsersCache,
  upsertUserInCache,
  __testing__usersCache,
  getUserByIdFromCache,
} from '../../users/cache';
import {
  isIdentifierUnique,
  createUserRecord,
  createUserRecords,
  getAllUsers,
  getUserById,
  getUserByUniqueIdentifier,
  updateUserById,
  updateUserByUniqueIdentifier,
} from '../../users/crud';

describe('users crud unit tests', () => {
  let t: CoreManagersSandbox;
  let lg: LoggerSpies;

  beforeEach(() => {
    t?.restore();
    lg?.restore();
    t = makeCoreManagersSandbox();
    lg = loggerSpies();
    clearUsersCache();
  });

  afterEach(() => {
    t?.restore();
    lg?.restore();
    resetGlobalLoggerState();
    clearUsersCache();
  });

  describe('isIdentifierUnique', () => {
    it('returns true when no user with that identifier exists', () => {
      expect(isIdentifierUnique('brand-new')).toBe(true);
    });

    it('returns false when a user with that identifier is in cache', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'taken' }));

      expect(isIdentifierUnique('taken')).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isIdentifierUnique('')).toBe(false);
    });

    it('returns false for a whitespace-only string', () => {
      expect(isIdentifierUnique('   ')).toBe(false);
    });
  });

  describe('createUserRecord', () => {
    it('returns ok:true with the created user on success', async () => {
      (t.dm as any).addItemToCollection.resolves({
        ok: true,
        successes: [makeTestJUser({ id: 'db-id', uniqueIdentifier: 'alice' })],
      });

      const result = await createUserRecord(makeTestNewUserRecord({ uniqueIdentifier: 'alice' }));

      expectOk(result);
    });

    it('stores the new user in the cache on success', async () => {
      const user = makeTestJUser({ id: 'db-id', uniqueIdentifier: 'alice' });
      (t.dm as any).addItemToCollection.resolves({ ok: true, successes: [user] });

      await createUserRecord(makeTestNewUserRecord({ uniqueIdentifier: 'alice' }));

      expect(__testing__usersCache._cache.getById('db-id')).not.toBeNull();
    });

    it('returns VALIDATION_ERROR for a null record', async () => {
      const result = await createUserRecord(null as any);
      expectFailedWithCode(result, JustinErrorCode.VALIDATION_ERROR);
    });

    it('returns VALIDATION_ERROR for an empty uniqueIdentifier', async () => {
      const result = await createUserRecord(makeTestNewUserRecord({ uniqueIdentifier: '' }));
      expectFailedWithCode(result, JustinErrorCode.VALIDATION_ERROR);
    });

    it('returns VALIDATION_ERROR when attributes is not a plain object', async () => {
      const result = await createUserRecord({ uniqueIdentifier: 'alice', attributes: null as any });
      expectFailedWithCode(result, JustinErrorCode.VALIDATION_ERROR);
    });

    it('returns VALIDATION_ERROR when attributes contains reserved key "id"', async () => {
      const result = await createUserRecord(makeTestNewUserRecord({ attributes: { id: 'hack' } }));
      expectFailedWithCode(result, JustinErrorCode.VALIDATION_ERROR);
    });

    it('returns VALIDATION_ERROR when attributes contains reserved key "uniqueIdentifier"', async () => {
      const result = await createUserRecord(
        makeTestNewUserRecord({ attributes: { uniqueIdentifier: 'hack' } }),
      );
      expectFailedWithCode(result, JustinErrorCode.VALIDATION_ERROR);
    });

    it('returns VALIDATION_ERROR when uniqueIdentifier is already taken', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));

      const result = await createUserRecord(makeTestNewUserRecord({ uniqueIdentifier: 'alice' }));

      expectFailedWithCode(result, JustinErrorCode.VALIDATION_ERROR);
    });

    it('returns a failure when the DB write fails', async () => {
      (t.dm as any).addItemToCollection.resolves({
        ok: false,
        successes: [],
        failures: [{ code: JustinErrorCode.DB_ERROR, reason: 'write failed' }],
      });

      const result = await createUserRecord(makeTestNewUserRecord({ uniqueIdentifier: 'alice' }));

      expectFailed(result);
    });
  });

  describe('createUserRecords', () => {
    it('returns ok:true with all created users when all succeed', async () => {
      (t.dm as any).addItemToCollection
        .onFirstCall()
        .resolves({ ok: true, successes: [makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' })] })
        .onSecondCall()
        .resolves({ ok: true, successes: [makeTestJUser({ id: 'u2', uniqueIdentifier: 'bob' })] });

      const result = await createUserRecords([
        makeTestNewUserRecord({ uniqueIdentifier: 'alice' }),
        makeTestNewUserRecord({ uniqueIdentifier: 'bob' }),
      ]);

      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(2);
    });

    it('returns ok:true with empty successes for empty input', async () => {
      const result = await createUserRecords([]);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });

    it('returns partial failures when some records are invalid', async () => {
      (t.dm as any).addItemToCollection.resolves({
        ok: true,
        successes: [makeTestJUser({ id: 'u1', uniqueIdentifier: 'valid' })],
      });

      const result = await createUserRecords([
        makeTestNewUserRecord({ uniqueIdentifier: 'valid' }),
        null as any,
      ]);

      expect(result.ok).toBe(false);
      expect(result.successes).toHaveLength(1);
      if (!result.ok) expect(result.failures).toHaveLength(1);
    });

    it('returns VALIDATION_ERROR for duplicate uniqueIdentifiers within the batch', async () => {
      (t.dm as any).addItemToCollection.resolves({
        ok: true,
        successes: [makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' })],
      });

      const result = await createUserRecords([
        makeTestNewUserRecord({ uniqueIdentifier: 'alice' }),
        makeTestNewUserRecord({ uniqueIdentifier: 'alice' }),
      ]);

      expect(result.ok).toBe(false);
      expect(result.successes).toHaveLength(1);
      if (!result.ok) expect(result.failures[0].code).toBe(JustinErrorCode.VALIDATION_ERROR);
    });
  });

  describe('getAllUsers', () => {
    it('returns all cached users', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      upsertUserInCache(makeTestJUser({ id: 'u2', uniqueIdentifier: 'bob' }));

      expect(getAllUsers()).toHaveLength(2);
    });

    it('returns an empty array when the cache is empty', () => {
      expect(getAllUsers()).toEqual([]);
    });
  });

  describe('getUserById', () => {
    it('returns the user for a known id', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));

      expect(getUserById('u1')).toMatchObject({ id: 'u1' });
    });

    it('returns null for an unknown id', () => {
      expect(getUserById('nonexistent')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(getUserById('')).toBeNull();
    });
  });

  describe('getUserByUniqueIdentifier', () => {
    it('returns the user for a known uniqueIdentifier', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));

      expect(getUserByUniqueIdentifier('alice')).toMatchObject({ uniqueIdentifier: 'alice' });
    });

    it('returns null for an unknown uniqueIdentifier', () => {
      expect(getUserByUniqueIdentifier('nobody')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(getUserByUniqueIdentifier('')).toBeNull();
    });
  });

  describe('updateUserById', () => {
    it('returns ok:true with the updated user on success', async () => {
      const user = makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice', score: 10 });
      upsertUserInCache(user);
      (t.dm as any).updateItemByIdInCollection.resolves({
        ok: true,
        successes: [{ ...user, score: 99 }],
      });

      const result = await updateUserById('u1', { score: 99 });

      expectOk(result);
    });

    it('updates the cache on success', async () => {
      const user = makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice', score: 10 });
      upsertUserInCache(user);
      (t.dm as any).updateItemByIdInCollection.resolves({
        ok: true,
        successes: [{ ...user, score: 99 }],
      });

      await updateUserById('u1', { score: 99 });

      expect((getUserByIdFromCache('u1') as any)?.score).toBe(99);
    });

    it('returns VALIDATION_ERROR for an empty userId', async () => {
      expectFailedWithCode(
        await updateUserById('', { score: 1 }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR when attributesToUpdate is not a plain object', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      expectFailedWithCode(
        await updateUserById('u1', null as any),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR for reserved key "id"', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      expectFailedWithCode(
        await updateUserById('u1', { id: 'hack' }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR for reserved key "uniqueIdentifier"', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      expectFailedWithCode(
        await updateUserById('u1', { uniqueIdentifier: 'hack' }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns NOT_FOUND when the user is not in cache', async () => {
      expectFailedWithCode(await updateUserById('ghost', { score: 1 }), JustinErrorCode.NOT_FOUND);
    });

    it('returns a failure when the DB write fails', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      (t.dm as any).updateItemByIdInCollection.resolves({
        ok: false,
        successes: [],
        failures: [{ code: JustinErrorCode.DB_ERROR, reason: 'write failed' }],
      });

      expectFailed(await updateUserById('u1', { score: 1 }));
    });
  });

  describe('updateUserByUniqueIdentifier', () => {
    it('returns ok:true with the updated user on success', async () => {
      const user = makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice', score: 10 });
      upsertUserInCache(user);
      (t.dm as any).updateItemByIdInCollection.resolves({
        ok: true,
        successes: [{ ...user, score: 50 }],
      });

      const result = await updateUserByUniqueIdentifier('alice', { score: 50 });

      expectOk(result);
    });

    it('returns VALIDATION_ERROR for an empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await updateUserByUniqueIdentifier('', { score: 1 }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns NOT_FOUND for an unknown uniqueIdentifier', async () => {
      expectFailedWithCode(
        await updateUserByUniqueIdentifier('nobody', { score: 1 }),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('returns VALIDATION_ERROR for reserved key "uniqueIdentifier"', async () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      expectFailedWithCode(
        await updateUserByUniqueIdentifier('alice', { uniqueIdentifier: 'hack' }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });
  });
});
