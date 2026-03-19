import {
  DataManager,
  ChangeListenerManager,
  PROTECTED_ATTRIBUTES,
  USERS,
  CollectionChangeType,
} from '../data-manager';
import { checkInitialized, coreFailureResult, coreSuccess } from '../utils';
import { JustinErrorCode } from '../errors';
import { createLogger } from '../logger';
import { JUser, NewUserRecord, NamespacedAttributes, ProtectedAttributesRecord } from './types';
import type { CoreResult } from '../types';
import { isNonEmptyString } from './helpers';
import {
  clearUsersCache,
  refreshUsersCache,
  getUserByIdFromCache,
  getUserByUniqueIdentifierFromCache,
} from './users/cache';
import {
  clearProtectedAttributesCache,
  refreshProtectedAttributesCache,
  deleteProtectedAttributesByUniqueIdentifierFromCache,
} from './protected-attributes/cache';
import {
  createUserRecord,
  createUserRecords,
  getAllUsers,
  getUserById,
  getUserByUniqueIdentifier,
  updateUserById,
  updateUserByUniqueIdentifier,
  isIdentifierUnique,
} from './users/crud';
import {
  getProtectedAttributesByUniqueIdentifier,
  getAllProtectedAttributesByUniqueIdentifier,
  setProtectedAttributesByUniqueIdentifier,
  deleteProtectedAttributesByUniqueIdentifier,
  deleteAllProtectedAttributesByUniqueIdentifier,
  updateProtectedAttributeByUniqueIdentifier,
  updateProtectedAttributesByUniqueIdentifier,
  deleteProtectedAttributeByUniqueIdentifier,
  deleteProtectedAttributesFromNamespaceByUniqueIdentifier,
} from './protected-attributes/crud';
import { setupUserChangeListeners } from './users/listeners';
import { setupProtectedAttributesChangeListeners } from './protected-attributes/listeners';

const Log = createLogger({
  context: {
    source: 'user-manager',
  },
});

const dm = DataManager.getInstance();
const clm = ChangeListenerManager.getInstance();

const _checkInitialization = (): void => {
  checkInitialized(dm.getInitializationStatus(), 'UserManager');
};

/**
 * Resolves a userId to its uniqueIdentifier via the cache.
 * Returns null if the userId is invalid or the user is not found.
 *
 * @param userId - The user's id.
 * @returns The user's uniqueIdentifier or null.
 * @private
 */
const _resolveUniqueIdentifier = (userId: string): string | null => {
  if (!isNonEmptyString(userId)) return null;

  const user = getUserByIdFromCache(userId);
  return user?.uniqueIdentifier ?? null;
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initializes the UserManager:
 * - initializes DataManager
 * - ensures stores + indexes exist
 * - refreshes caches
 * - wires change listeners
 */
const init = async (): Promise<void> => {
  await dm.init();

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

  await refreshUsersCache();
  await refreshProtectedAttributesCache();

  setupUserChangeListeners((uniqueIdentifier: string) => {
    deleteProtectedAttributesByUniqueIdentifierFromCache(uniqueIdentifier);
  });

  setupProtectedAttributesChangeListeners();
};

/**
 * Shuts down the UserManager by removing all change listeners and awaiting
 * full stream teardown.
 *
 * Must be awaited before re-initializing to avoid racing against
 * still-closing Mongo change streams.
 *
 * @returns {Promise<void>}
 */
const shutdown = async (): Promise<void> => {
  await clm.removeChangeListener(USERS, CollectionChangeType.INSERT);
  await clm.removeChangeListener(USERS, CollectionChangeType.UPDATE);
  await clm.removeChangeListener(USERS, CollectionChangeType.DELETE);

  await clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.INSERT);
  await clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.UPDATE);
  await clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.DELETE);
};

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------

/**
 * Creates a user and optionally creates protected-attributes records.
 *
 * Protected-attributes failures are logged but do not fail user creation.
 *
 * @param record - New user record.
 * @returns The created user or null for invalid input.
 */
const createUser = async (record: NewUserRecord): Promise<CoreResult<JUser>> => {
  _checkInitialization();

  const userResult = await createUserRecord(record);
  if (!userResult.ok) return userResult;

  const user = userResult.successes[0];
  const uniqueIdentifier = user.uniqueIdentifier;

  const items = Array.isArray(record?.protectedAttributes) ? record.protectedAttributes : [];
  if (items.length === 0) return coreSuccess([user]);

  const setPAResult = await setProtectedAttributesByUniqueIdentifier(
    uniqueIdentifier,
    items as NamespacedAttributes[],
  );
  if (!setPAResult.ok) {
    setPAResult.failures.forEach(({ code, reason, details }) => {
      Log.warn('createUser: PA set failed', {
        uniqueIdentifier,
        code,
        reason,
        namespace: details?.namespace,
      });
    });
  }

  return coreSuccess([user]);
};

/**
 * Creates multiple users.
 *
 * Note: protected-attributes on batch creation are not currently supported.
 * Use {@link createUser} for individual creation with protected-attributes.
 *
 * @param records - New user records.
 * @returns A {@link CoreResult} with per-record success and failure detail.
 */
const createUsers = async (records: NewUserRecord[]): Promise<CoreResult<JUser>> => {
  _checkInitialization();

  if (!Array.isArray(records) || records.length === 0) {
    return coreSuccess([]);
  }

  return await createUserRecords(records);
};

/**
 * Deletes a user by id and cascades protected-attributes deletion.
 *
 * @param userId - The user's id.
 * @returns True if the user was deleted.
 */
const deleteUserById = async (userId: string): Promise<CoreResult<null>> => {
  _checkInitialization();

  if (!isNonEmptyString(userId))
    return coreFailureResult(
      'deleteUserById',
      JustinErrorCode.VALIDATION_ERROR,
      'userId must be a non-empty string',
      { id: userId },
    );

  const existing = getUserByIdFromCache(userId);
  if (!existing?.uniqueIdentifier)
    return coreFailureResult(
      'deleteUserById',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
    );

  await deleteAllProtectedAttributesByUniqueIdentifier(existing.uniqueIdentifier);

  const removeResult = await dm.removeItemFromCollection(USERS, userId);
  if (!removeResult.ok) return removeResult;

  clearUsersCache();
  await refreshUsersCache();
  return coreSuccess([null]);
};

/**
 * Deletes a user by uniqueIdentifier and cascades protected-attributes deletion.
 *
 * @param uniqueIdentifier - The user's unique identifier.
 * @returns True if the user was deleted.
 */
const deleteUserByUniqueIdentifier = async (
  uniqueIdentifier: string,
): Promise<CoreResult<null>> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier))
    return coreFailureResult(
      'deleteUserByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier },
    );

  const existing = getUserByUniqueIdentifierFromCache(uniqueIdentifier);
  if (!existing)
    return coreFailureResult(
      'deleteUserByUniqueIdentifier',
      JustinErrorCode.NOT_FOUND,
      `user (${uniqueIdentifier}) not found`,
      { uniqueIdentifier },
    );

  return await deleteUserById(existing.id);
};

/**
 * Deletes all users and all protected attributes (full reset).
 */
const deleteAllUsers = async (): Promise<void> => {
  _checkInitialization();

  await dm.clearCollection(USERS);
  await dm.clearCollection(PROTECTED_ATTRIBUTES);

  clearUsersCache();
  clearProtectedAttributesCache();
};

// ---------------------------------------------------------------------------
// Protected attributes — read
// ---------------------------------------------------------------------------

/**
 * Returns all protected-attributes records for a user across every namespace.
 * Served from cache — no DB round-trip.
 *
 * @param userId - The user's id.
 * @returns All protected-attributes records for the user (may be empty).
 */
const getAllProtectedAttributesForUser = (userId: string): ProtectedAttributesRecord[] => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid) {
    Log.warn('getAllProtectedAttributesForUser: userId invalid or user not found', {
      userId,
      code: JustinErrorCode.NOT_FOUND,
    });
    return [];
  }

  return getAllProtectedAttributesByUniqueIdentifier(uid);
};

/**
 * Returns protected-attributes records for a user filtered to the requested namespaces.
 * Served from cache — no DB round-trip.
 *
 * @param userId - The user's id.
 * @param namespaces - One or more namespaces to retrieve.
 * @returns Matching protected-attributes records (may be empty).
 */
const getProtectedAttributesForUser = (
  userId: string,
  namespaces: string[],
): ProtectedAttributesRecord[] => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid) {
    Log.warn('getProtectedAttributesForUser: userId invalid or user not found', {
      userId,
      code: JustinErrorCode.NOT_FOUND,
    });
    return [];
  }

  return getProtectedAttributesByUniqueIdentifier(uid, namespaces);
};

// ---------------------------------------------------------------------------
// Protected attributes — upsert
// ---------------------------------------------------------------------------

/**
 * Upserts one or more namespace-scoped protected-attributes records for a user.
 *
 * @param userId - The user's id.
 * @param input - A single {@link NamespacedAttributes} or an array of them.
 * @returns Result with succeeded and failed records per namespace.
 */
const setProtectedAttributesForUser = async (
  userId: string,
  input: NamespacedAttributes | NamespacedAttributes[],
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid)
    return coreFailureResult(
      'setProtectedAttributesForUser',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
    );

  return await setProtectedAttributesByUniqueIdentifier(uid, input);
};

// ---------------------------------------------------------------------------
// Protected attributes — key-level patch
// ---------------------------------------------------------------------------

/**
 * Updates a single nested key path within a namespace-scoped protected-attributes record.
 *
 * @param userId - The user's id.
 * @param namespace - The namespace of the record to patch.
 * @param keyPath - Dot-notated path of the key to set.
 * @param value - The value to set at the path.
 * @returns The updated record, or null if not found, input is invalid, or the operation fails.
 */
const updateProtectedAttributeForUser = async (
  userId: string,
  namespace: string,
  keyPath: string,
  value: any,
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid)
    return coreFailureResult(
      'updateProtectedAttributeForUser',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
      { namespace, keyPath },
    );

  return await updateProtectedAttributeByUniqueIdentifier(uid, namespace, keyPath, value);
};

/**
 * Updates multiple nested key paths within a namespace-scoped protected-attributes record.
 *
 * @param userId - The user's id.
 * @param namespace - The namespace of the record to patch.
 * @param updates - An object whose keys are dot-notated paths and values are the values to set.
 * @returns A {@link CoreResult} with the updated record and any skipped-path failures.
 */
const updateProtectedAttributesForUser = async (
  userId: string,
  namespace: string,
  updates: Record<string, any>,
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid)
    return coreFailureResult(
      'updateProtectedAttributesForUser',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
      { namespace },
    );

  return await updateProtectedAttributesByUniqueIdentifier(uid, namespace, updates);
};

// ---------------------------------------------------------------------------
// Protected attributes — delete
// ---------------------------------------------------------------------------

/**
 * Deletes one or more namespace-scoped protected-attributes records for a user.
 *
 * @param userId - The user's id.
 * @param namespaces - A single namespace string or an array of namespace strings to delete.
 * @returns True if at least one record was deleted.
 */
const deleteProtectedAttributesForUser = async (
  userId: string,
  namespaces: string | string[],
): Promise<CoreResult<null>> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid)
    return coreFailureResult(
      'deleteProtectedAttributesForUser',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
    );

  return await deleteProtectedAttributesByUniqueIdentifier(uid, namespaces);
};

/**
 * Deletes all protected-attributes records for a user across every namespace.
 *
 * @param userId - The user's id.
 */
const deleteAllProtectedAttributesForUser = async (userId: string): Promise<void> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid) {
    Log.warn('deleteAllProtectedAttributesForUser: userId invalid or user not found', {
      userId,
      code: JustinErrorCode.NOT_FOUND,
    });
    return;
  }

  await deleteAllProtectedAttributesByUniqueIdentifier(uid);
};

/**
 * Deletes a single nested key path within a namespace-scoped protected-attributes record.
 *
 * @param userId - The user's id.
 * @param namespace - The namespace of the record to patch.
 * @param keyPath - Dot-notated path of the key to delete.
 * @returns The updated record, or null if not found, input is invalid, or the operation fails.
 */
const deleteProtectedAttributeForUser = async (
  userId: string,
  namespace: string,
  keyPath: string,
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid)
    return coreFailureResult(
      'deleteProtectedAttributeForUser',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
      { namespace, keyPath },
    );

  return await deleteProtectedAttributeByUniqueIdentifier(uid, namespace, keyPath);
};

/**
 * Deletes multiple nested key paths within a namespace-scoped protected-attributes record.
 *
 * @param userId - The user's id.
 * @param namespace - The namespace of the record to patch.
 * @param keyPaths - A single dot-notated path string or an array of them.
 * @returns A {@link CoreResult} with the updated record and any skipped-path failures.
 */
const deleteProtectedAttributesFromNamespaceForUser = async (
  userId: string,
  namespace: string,
  keyPaths: string | string[],
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid)
    return coreFailureResult(
      'deleteProtectedAttributesFromNamespaceForUser',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
      { namespace },
    );

  return await deleteProtectedAttributesFromNamespaceByUniqueIdentifier(uid, namespace, keyPaths);
};

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

const UserManager = {
  init,
  shutdown,

  // users
  createUser,
  createUsers,
  getAllUsers,
  getUserById,
  getUserByUniqueIdentifier,
  updateUserById,
  updateUserByUniqueIdentifier,
  deleteUserById,
  deleteUserByUniqueIdentifier,
  deleteAllUsers,
  isIdentifierUnique,

  // protected attributes
  getAllProtectedAttributesForUser,
  getProtectedAttributesForUser,
  setProtectedAttributesForUser,
  updateProtectedAttributeForUser,
  updateProtectedAttributesForUser,
  deleteProtectedAttributesForUser,
  deleteAllProtectedAttributesForUser,
  deleteProtectedAttributeForUser,
  deleteProtectedAttributesFromNamespaceForUser,
};

const TestingUserManager = {
  ...UserManager,
  refreshUsersCache,
  refreshProtectedAttributesCache,
  clearUsersCache,
  clearProtectedAttributesCache,
};

export { UserManager, TestingUserManager };
