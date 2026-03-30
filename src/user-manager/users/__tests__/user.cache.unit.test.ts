import {
  makeTestJUser,
  makeCoreManagersSandbox,
  loggerSpies,
  resetGlobalLoggerState,
} from '../../../testing';
import type { CoreManagersSandbox, LoggerSpies } from '../../../testing';
import {
  refreshUsersCache,
  clearUsersCache,
  upsertUserInCache,
  deleteUserFromCache,
  getAllUsersFromCache,
  getUserByIdFromCache,
  getUserByUniqueIdentifierFromCache,
  getUserIdByUniqueIdentifierFromCache,
  __testing__usersCache,
} from '../cache';

describe('users cache unit tests', () => {
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

  describe('refreshUsersCache', () => {
    it('loads all users from the DB into the cache', async () => {
      const users = [
        makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }),
        makeTestJUser({ id: 'u2', uniqueIdentifier: 'bob' }),
      ];
      (t.dm as any).getAllInCollection.resolves(users);

      await refreshUsersCache();

      expect(getUserByIdFromCache('u1')).toMatchObject({ uniqueIdentifier: 'alice' });
      expect(getUserByIdFromCache('u2')).toMatchObject({ uniqueIdentifier: 'bob' });
    });

    it('replaces any existing cache contents', async () => {
      upsertUserInCache(makeTestJUser({ id: 'old', uniqueIdentifier: 'old-user' }));
      (t.dm as any).getAllInCollection.resolves([
        makeTestJUser({ id: 'new', uniqueIdentifier: 'new-user' }),
      ]);

      await refreshUsersCache();

      expect(getUserByIdFromCache('old')).toBeNull();
      expect(getUserByIdFromCache('new')).not.toBeNull();
    });

    it('skips malformed records missing id and logs an error', async () => {
      (t.dm as any).getAllInCollection.resolves([{ uniqueIdentifier: 'no-id' } as any]);

      await refreshUsersCache();

      expect(__testing__usersCache._cache.size()).toBe(0);
      expect(lg.findByMessage('skipping malformed record')).toHaveLength(1);
    });

    it('loads the uniqueIdentifier index so lookups work after refresh', async () => {
      (t.dm as any).getAllInCollection.resolves([
        makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }),
      ]);

      await refreshUsersCache();

      expect(getUserByUniqueIdentifierFromCache('alice')).not.toBeNull();
    });
  });

  describe('clearUsersCache', () => {
    it('removes all records from the cache', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      clearUsersCache();

      expect(getUserByIdFromCache('u1')).toBeNull();
      expect(getAllUsersFromCache()).toHaveLength(0);
    });

    it('clears the uniqueIdentifier index', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      clearUsersCache();

      expect(getUserByUniqueIdentifierFromCache('alice')).toBeNull();
    });

    it('is safe to call on an empty cache', () => {
      expect(() => clearUsersCache()).not.toThrow();
    });
  });

  describe('upsertUserInCache', () => {
    it('inserts a new user into the cache', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));

      expect(getUserByIdFromCache('u1')).not.toBeNull();
    });

    it('makes the user findable by uniqueIdentifier', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));

      expect(getUserByUniqueIdentifierFromCache('alice')).not.toBeNull();
    });

    it('replaces an existing record with the same id', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice', score: 10 }));
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice', score: 99 }));

      expect((getUserByIdFromCache('u1') as any)?.score).toBe(99);
      expect(__testing__usersCache._cache.size()).toBe(1);
    });

    it('updates the uniqueIdentifier index when a record is replaced', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice-old' }));
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice-new' }));

      expect(getUserByUniqueIdentifierFromCache('alice-old')).toBeNull();
      expect(getUserByUniqueIdentifierFromCache('alice-new')).not.toBeNull();
    });

    it('skips and logs an error for a user missing id', () => {
      upsertUserInCache({ uniqueIdentifier: 'alice' } as any);

      expect(__testing__usersCache._cache.size()).toBe(0);
      expect(lg.findByMessage('skipping malformed user')).toHaveLength(1);
    });
  });

  describe('deleteUserFromCache', () => {
    it('removes the user from the cache', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      deleteUserFromCache('u1');

      expect(getUserByIdFromCache('u1')).toBeNull();
    });

    it('removes the user from the uniqueIdentifier index', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      deleteUserFromCache('u1');

      expect(getUserByUniqueIdentifierFromCache('alice')).toBeNull();
    });

    it('returns the deleted user uniqueIdentifier', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));

      expect(deleteUserFromCache('u1')).toBe('alice');
    });

    it('returns null for an unknown id', () => {
      expect(deleteUserFromCache('nonexistent')).toBeNull();
    });

    it('does not affect other cached users', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      upsertUserInCache(makeTestJUser({ id: 'u2', uniqueIdentifier: 'bob' }));
      deleteUserFromCache('u1');

      expect(getUserByIdFromCache('u2')).not.toBeNull();
    });
  });

  describe('getAllUsersFromCache', () => {
    it('returns all cached users', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      upsertUserInCache(makeTestJUser({ id: 'u2', uniqueIdentifier: 'bob' }));

      expect(getAllUsersFromCache()).toHaveLength(2);
    });

    it('returns an empty array when the cache is empty', () => {
      expect(getAllUsersFromCache()).toEqual([]);
    });
  });

  describe('getUserByIdFromCache', () => {
    it('returns the user for a known id', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));

      expect(getUserByIdFromCache('u1')).toMatchObject({ id: 'u1' });
    });

    it('returns null for an unknown id', () => {
      expect(getUserByIdFromCache('nonexistent')).toBeNull();
    });
  });

  describe('getUserByUniqueIdentifierFromCache', () => {
    it('returns the user for a known uniqueIdentifier', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));

      expect(getUserByUniqueIdentifierFromCache('alice')).toMatchObject({
        uniqueIdentifier: 'alice',
      });
    });

    it('returns null for an unknown uniqueIdentifier', () => {
      expect(getUserByUniqueIdentifierFromCache('nobody')).toBeNull();
    });
  });

  describe('getUserIdByUniqueIdentifierFromCache', () => {
    it('returns the id for a known uniqueIdentifier', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));

      expect(getUserIdByUniqueIdentifierFromCache('alice')).toBe('u1');
    });

    it('returns null for an unknown uniqueIdentifier', () => {
      expect(getUserIdByUniqueIdentifierFromCache('nobody')).toBeNull();
    });
  });
});
