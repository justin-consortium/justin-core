import { DataManager, USERS } from '../../data-manager';
import { checkInitialized } from '../../utils';
import { JUser } from '../types';
import { isNonEmptyString } from '../helpers';
import { createLogger } from '../../logger';

const dm = DataManager.getInstance();

const Log = createLogger({ context: { source: 'users-cache' } });

const _checkInitialization = (): void => {
  checkInitialized(dm.getInitializationStatus(), 'UserManager');
};

/**
 * In-memory cache for user data.
 * Key: userId / Value: JUser
 * @private
 */
const _users: Map<string, JUser> = new Map();

/**
 * Reverse lookup for users by uniqueIdentifier.
 * Key: uniqueIdentifier / Value: userId
 * @private
 */
const _userIdByUniqueIdentifier: Map<string, string> = new Map();

/**
 * Clears the users cache.
 */
const clearUsersCache = (): void => {
  _users.clear();
  _userIdByUniqueIdentifier.clear();
};

/**
 * Loads all users from the database into the in-memory cache.
 *
 * @returns {Promise<void>} Resolves when users are loaded into the cache.
 */
const refreshUsersCache = async (): Promise<void> => {
  _checkInitialization();
  clearUsersCache();

  const userDocs = await dm.getAllInCollection<JUser>(USERS);
  userDocs.forEach((jUser: any) => {
    if (!jUser?.id) {
      Log.error('refreshUsersCache: skipping malformed record — missing id', { record: jUser });
      return;
    }

    _users.set(jUser.id, jUser);

    if (jUser?.uniqueIdentifier) {
      _userIdByUniqueIdentifier.set(jUser.uniqueIdentifier, jUser.id);
    }
  });
};

/**
 * Retrieves all cached users.
 *
 * @returns {JUser[]} An array of all cached users.
 */
const getAllUsersFromCache = (): JUser[] => {
  _checkInitialization();
  return Array.from(_users.values());
};

/**
 * Retrieves a user by their id from the cache.
 *
 * @param {string} userId - The user's id.
 * @returns {JUser | null} The cached user or null.
 */
const getUserByIdFromCache = (userId: string): JUser | null => {
  _checkInitialization();
  return (_users.get(userId) as JUser) ?? null;
};

/**
 * Retrieves a user's id by their uniqueIdentifier from the reverse-lookup cache.
 *
 * @param {string} uniqueIdentifier - The user's uniqueIdentifier.
 * @returns {string | null} The userId or null if not found.
 */
const getUserIdByUniqueIdentifierFromCache = (uniqueIdentifier: string): string | null => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return null;

  return _userIdByUniqueIdentifier.get(uniqueIdentifier) ?? null;
};

/**
 * Retrieves a user by their uniqueIdentifier from the cache.
 *
 * @param {string} uniqueIdentifier - The user's uniqueIdentifier.
 * @returns {JUser | null} The cached user or null.
 */
const getUserByUniqueIdentifierFromCache = (uniqueIdentifier: string): JUser | null => {
  _checkInitialization();

  const userId = getUserIdByUniqueIdentifierFromCache(uniqueIdentifier);
  if (!userId) return null;

  return (_users.get(userId) as JUser) ?? null;
};

/**
 * Upserts a user into the in-memory caches.
 *
 * @param {JUser} jUser - The user to cache.
 */
const upsertUserInCache = (jUser: JUser): void => {
  _checkInitialization();

  if (!jUser?.id) {
    Log.error('upsertUserInCache: skipping malformed user — missing id', { record: jUser });
    return;
  }

  _users.set(jUser.id, jUser);

  if (jUser?.uniqueIdentifier) {
    _userIdByUniqueIdentifier.set(jUser.uniqueIdentifier, jUser.id);
  }
};

/**
 * Deletes a user from the in-memory caches.
 *
 * @param {string} userId - The user id to delete.
 * @returns {string | null} The deleted user's uniqueIdentifier (if known).
 */
const deleteUserFromCache = (userId: string): string | null => {
  _checkInitialization();

  const existingUser = _users.get(userId) as any;
  const uniqueIdentifier = existingUser?.uniqueIdentifier ?? null;

  _users.delete(userId);

  if (uniqueIdentifier) {
    _userIdByUniqueIdentifier.delete(uniqueIdentifier);
  }

  return uniqueIdentifier;
};

export {
  clearUsersCache,
  refreshUsersCache,
  getAllUsersFromCache,
  getUserByIdFromCache,
  getUserIdByUniqueIdentifierFromCache,
  getUserByUniqueIdentifierFromCache,
  upsertUserInCache,
  deleteUserFromCache,
};

/**
 * Testing exports for cache internals.
 * @private
 */
export const __testing__usersCache = {
  _checkInitialization,
  _users,
  _userIdByUniqueIdentifier,
};
