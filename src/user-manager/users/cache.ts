import type { CacheManager } from '../../cache-manager';
import { createCacheManager } from '../../cache-manager';
import { DataManager } from '../../data-manager';
import { checkInitialized } from '../../utils';
import { createLogger } from '../../logger';
import type { JUser } from '../types';
import { USERS } from '../constants';

const Log = createLogger({ context: { source: 'users-cache' } });

const dm = DataManager.getInstance();

const _checkInit = (): void => checkInitialized(dm.getInitializationStatus(), 'UserManager');

/**
 * In-memory cache for user records.
 *
 * Indexed by `uniqueIdentifier` for O(1) reverse lookups without a DB
 * round-trip. The primary key is `id`.
 */
const _cache: CacheManager<JUser> = createCacheManager<JUser>().addIndex('uniqueIdentifier');

// ---------------------------------------------------------------------------
// Cache operations
// ---------------------------------------------------------------------------

/**
 * Loads all users from the database into the in-memory cache, replacing
 * whatever was there before.
 *
 * Malformed records (missing `id`) are skipped and logged as errors.
 */
const refreshUsersCache = async (): Promise<void> => {
  _checkInit();
  const docs = await dm.getAllInCollection<JUser>(USERS);
  const valid = docs.filter((u) => {
    if (!u?.id) {
      Log.error('refreshUsersCache: skipping malformed record — missing id', { record: u });
      return false;
    }
    return true;
  });
  _cache.refresh(valid);
};

/**
 * Clears all user records and index entries from the cache.
 */
const clearUsersCache = (): void => {
  _cache.clear();
};

/**
 * Inserts or replaces a single user in the cache, updating the
 * `uniqueIdentifier` index.
 *
 * @param user - User record to upsert.
 */
const upsertUserInCache = (user: JUser): void => {
  _checkInit();
  if (!user?.id) {
    Log.error('upsertUserInCache: skipping malformed user — missing id', { record: user });
    return;
  }
  _cache.upsert(user);
};

/**
 * Removes a user from the cache by `id`.
 *
 * @param userId - Primary key of the user to remove.
 * @returns The deleted user's `uniqueIdentifier` if found, or `null` if the user was not cached.
 */
const deleteUserFromCache = (userId: string): string | null => {
  _checkInit();
  const deleted = _cache.delete(userId);
  return deleted?.uniqueIdentifier ?? null;
};

/**
 * Returns all cached users as an array.
 */
const getAllUsersFromCache = (): JUser[] => {
  _checkInit();
  return _cache.getAll();
};

/**
 * Returns the cached user with the given `id`, or `null` if not found.
 *
 * @param userId - Primary key to look up.
 * @returns The matching {@link JUser}, or `null` if not found.
 */
const getUserByIdFromCache = (userId: string): JUser | null => {
  _checkInit();
  return _cache.getById(userId);
};

/**
 * Returns the cached user whose `uniqueIdentifier` matches, or `null`.
 *
 * @param uniqueIdentifier - Unique identifier to look up.
 * @returns The matching {@link JUser}, or `null` if not found.
 */
const getUserByUniqueIdentifierFromCache = (uniqueIdentifier: string): JUser | null => {
  _checkInit();
  return _cache.getByIndex('uniqueIdentifier', uniqueIdentifier);
};

/**
 * Returns the `id` of the user whose `uniqueIdentifier` matches, or `null`.
 *
 * @param uniqueIdentifier - Unique identifier to resolve.
 * @returns The user's `id` string, or `null` if not found.
 */
const getUserIdByUniqueIdentifierFromCache = (uniqueIdentifier: string): string | null => {
  _checkInit();
  return getUserByUniqueIdentifierFromCache(uniqueIdentifier)?.id ?? null;
};

/** @internal — exposed for testing only */
const __testing__usersCache = { _cache };

export {
  refreshUsersCache,
  clearUsersCache,
  upsertUserInCache,
  deleteUserFromCache,
  getAllUsersFromCache,
  getUserByIdFromCache,
  getUserByUniqueIdentifierFromCache,
  getUserIdByUniqueIdentifierFromCache,
  __testing__usersCache,
};
