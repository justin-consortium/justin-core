import { DataManager, ChangeListenerManager, CollectionChangeTypeEnum } from '../data-manager';
import { checkInitialized, coreFailureResult, coreSuccess } from '../utils';
import { JustinErrorCode } from '../errors';
import { createLogger } from '../logger';
import { registerManager } from '../lifecycle';
import type {
  JUser,
  NewUserRecord,
  NamespacedAttributes,
  ProtectedAttributesRecord,
} from './types';
import type { CoreResult } from '../types';
import { isNonEmptyString } from './helpers';
import { USERS, PROTECTED_ATTRIBUTES } from './constants';
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
  getProtectedAttributes,
  getAllProtectedAttributes,
  setProtectedAttributes,
  setProtectedAttributeKeysByNamespace,
  deleteProtectedAttributeNamespaces,
  deleteAllProtectedAttributes,
  deleteProtectedAttributeKeysByNamespace,
} from './protected-attributes/crud';
import { setupUserChangeListeners } from './users/listeners';
import { setupProtectedAttributesChangeListeners } from './protected-attributes/listeners';

const Log = createLogger({ context: { source: 'user-manager' } });

const dm = DataManager.getInstance();
const clm = ChangeListenerManager.getInstance();

const _checkInit = (): void => checkInitialized(dm.getInitializationStatus(), 'UserManager');

/**
 * Resolves a `userId` to its `uniqueIdentifier` via the cache.
 * Returns `null` if the userId is invalid or the user is not found.
 *
 * @param userId - The user's primary key.
 */
const _resolveUniqueIdentifier = (userId: string): string | null => {
  if (!isNonEmptyString(userId)) return null;
  return getUserByIdFromCache(userId)?.uniqueIdentifier ?? null;
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialises the UserManager.
 *
 * Ensures the `users` and `protected_attributes` collections and their indexes
 * exist, populates the in-memory caches, and wires up change listeners so the
 * cache stays consistent with the database.
 *
 * Also registers the manager with the lifecycle system so {@link shutdownCore}
 * can tear it down gracefully without needing an explicit reference.
 *
 * Safe to call again after {@link shutdown} — useful for simulating restarts
 * in tests.
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

  // Auto-register so shutdownCore() can find this manager without an explicit reference.
  registerManager({ shutdown });
};

/**
 * Shuts down the UserManager by removing all change listeners and awaiting
 * full stream teardown.
 *
 * Must be awaited before re-initialising to avoid racing against still-closing
 * change streams — particularly important in tests.
 */
const shutdown = async (): Promise<void> => {
  await clm.removeChangeListener(USERS, CollectionChangeTypeEnum.INSERT);
  await clm.removeChangeListener(USERS, CollectionChangeTypeEnum.UPDATE);
  await clm.removeChangeListener(USERS, CollectionChangeTypeEnum.DELETE);

  await clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeTypeEnum.INSERT);
  await clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeTypeEnum.UPDATE);
  await clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeTypeEnum.DELETE);
};

// ---------------------------------------------------------------------------
// User — write
// ---------------------------------------------------------------------------

/**
 * Creates a user and optionally creates protected-attributes records in a
 * single call.
 *
 * Protected-attributes failures are logged but do not fail the overall user
 * creation — the user is returned regardless.
 *
 * @param record - New user data including optional protected attributes.
 * @returns A {@link CoreResult} containing the created {@link JUser} on success.
 */
const createUser = async (record: NewUserRecord): Promise<CoreResult<JUser>> => {
  _checkInit();

  const normalizedRecord: NewUserRecord = isNonEmptyString(record?.uniqueIdentifier)
    ? { ...record, uniqueIdentifier: record.uniqueIdentifier.trim() }
    : record;

  const userResult = await createUserRecord(normalizedRecord);
  if (!userResult.ok) return userResult;

  const user = userResult.successes[0];
  const items = Array.isArray(record?.protectedAttributes) ? record.protectedAttributes : [];
  if (items.length === 0) return coreSuccess([user]);

  const setPAResult = await setProtectedAttributes(
    user.uniqueIdentifier,
    items as NamespacedAttributes[],
  );
  if (!setPAResult.ok) {
    setPAResult.failures.forEach(({ code, reason, details }) => {
      Log.warn('createUser: protected attributes set failed', {
        uniqueIdentifier: user.uniqueIdentifier,
        code,
        reason,
        namespace: details?.namespace,
      });
    });
  }

  return coreSuccess([user]);
};

/**
 * Creates multiple users in a single call.
 *
 * Protected attributes on batch creation are not currently supported — use
 * {@link createUser} for individual creation when protected attributes are needed.
 *
 * @param records - Array of new user data.
 * @returns A {@link CoreResult} with per-record success and failure detail.
 */
const createUsers = async (records: NewUserRecord[]): Promise<CoreResult<JUser>> => {
  _checkInit();
  if (!Array.isArray(records) || records.length === 0) return coreSuccess([]);

  const normalizedRecords = records.map((record) =>
    isNonEmptyString(record?.uniqueIdentifier)
      ? { ...record, uniqueIdentifier: record.uniqueIdentifier.trim() }
      : record,
  );

  return createUserRecords(normalizedRecords);
};

/**
 * Deletes a user by `id` and cascades the deletion to all their protected
 * attributes.
 *
 * @param userId - Primary key of the user to delete.
 * @returns A {@link CoreResult} with `successes: [null]` on success.
 */
const deleteUserById = async (userId: string): Promise<CoreResult<null>> => {
  _checkInit();

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

  const paResult = await deleteAllProtectedAttributes(existing.uniqueIdentifier);
  if (!paResult.ok) {
    paResult.failures.forEach(({ reason }) =>
      Log.warn('deleteUserById: protected attributes cleanup failed', {
        uniqueIdentifier: existing.uniqueIdentifier,
        reason,
      }),
    );
  }

  const removeResult = await dm.removeItemFromCollection(USERS, userId);
  if (!removeResult.ok) return removeResult;

  clearUsersCache();
  await refreshUsersCache();
  return coreSuccess([null]);
};

/**
 * Deletes a user by `uniqueIdentifier` and cascades the deletion to all their
 * protected attributes.
 *
 * @param uniqueIdentifier - Unique identifier of the user to delete.
 * @returns A {@link CoreResult} with `successes: [null]` on success.
 */
const deleteUserByUniqueIdentifier = async (
  uniqueIdentifier: string,
): Promise<CoreResult<null>> => {
  _checkInit();

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

  return deleteUserById(existing.id);
};

/**
 * Deletes all users and all protected attributes — a full reset of both
 * collections.
 *
 * Clears the in-memory caches after deletion. Returns `ok: false` if either
 * collection clear fails, with failure detail for the failing operation(s).
 *
 * @returns A {@link CoreResult} with `successes: [null]` on success.
 */
const deleteAllUsers = async (): Promise<CoreResult<null>> => {
  _checkInit();

  const usersResult = await dm.clearCollection(USERS);
  if (!usersResult.ok) return usersResult;

  const paResult = await dm.clearCollection(PROTECTED_ATTRIBUTES);
  if (!paResult.ok) return paResult;

  clearUsersCache();
  clearProtectedAttributesCache();
  return coreSuccess([null]);
};

// ---------------------------------------------------------------------------
// Protected attributes — read
// ---------------------------------------------------------------------------

/**
 * Returns all cached protected-attributes records for the given user across
 * every namespace. No DB round-trip.
 *
 * @param userId - Primary key of the user.
 * @returns All protected-attributes records for the user (may be empty).
 */
const getAllProtectedAttributesForUser = (userId: string): ProtectedAttributesRecord[] => {
  _checkInit();
  const uid = _resolveUniqueIdentifier(userId);
  if (!uid) {
    Log.warn('getAllProtectedAttributesForUser: userId invalid or user not found', {
      userId,
      code: JustinErrorCode.NOT_FOUND,
    });
    return [];
  }
  return getAllProtectedAttributes(uid);
};

/**
 * Returns cached protected-attributes records for the given user, filtered
 * to the specified namespaces. No DB round-trip.
 *
 * Empty-string or non-existent namespaces are silently skipped.
 *
 * @param userId - Primary key of the user.
 * @param namespaces - Namespaces to retrieve.
 * @returns Matching protected-attributes records (may be empty).
 */
const getProtectedAttributesForUser = (
  userId: string,
  namespaces: string[],
): ProtectedAttributesRecord[] => {
  _checkInit();
  const uid = _resolveUniqueIdentifier(userId);
  if (!uid) {
    Log.warn('getProtectedAttributesForUser: userId invalid or user not found', {
      userId,
      code: JustinErrorCode.NOT_FOUND,
    });
    return [];
  }
  return getProtectedAttributes(uid, namespaces);
};

// ---------------------------------------------------------------------------
// Protected attributes — upsert
// ---------------------------------------------------------------------------

/**
 * Upserts one or more namespace-scoped protected-attributes records for a user.
 *
 * For each namespace, if a record already exists its `protectedAttributes` are
 * shallow-merged; otherwise a new record is created.
 *
 * @param userId - Primary key of the user.
 * @param input - A single {@link NamespacedAttributes} or an array of them.
 * @returns A {@link CoreResult} with per-namespace success and failure detail.
 */
const setProtectedAttributesForUser = async (
  userId: string,
  input: NamespacedAttributes | NamespacedAttributes[],
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInit();
  const uid = _resolveUniqueIdentifier(userId);
  if (!uid)
    return coreFailureResult(
      'setProtectedAttributesForUser',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
    );
  return setProtectedAttributes(uid, input);
};

// ---------------------------------------------------------------------------
// Protected attributes — key-level patch
// ---------------------------------------------------------------------------

/**
 * Updates one or more nested key paths within a namespace-scoped protected-attributes record.
 *
 * Pass a single `{ keyPath: value }` entry or multiple. Invalid or reserved paths are
 * skipped and reported as failures; valid paths are applied in a single DB write.
 *
 * @param userId - Primary key of the user.
 * @param namespace - Namespace of the record to patch.
 * @param updates - Object whose keys are dot-notated paths and values are the values to set.
 * @returns A {@link CoreResult} with the updated record and any skipped-path failures.
 */
const setProtectedAttributeKeysByNamespaceForUser = async (
  userId: string,
  namespace: string,
  updates: Record<string, unknown>,
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInit();
  const uid = _resolveUniqueIdentifier(userId);
  if (!uid)
    return coreFailureResult(
      'setProtectedAttributeKeysByNamespaceForUser',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
      { namespace },
    );
  return setProtectedAttributeKeysByNamespace(uid, namespace, updates);
};

// ---------------------------------------------------------------------------
// Protected attributes — delete
// ---------------------------------------------------------------------------

/**
 * Deletes one or more namespace-scoped protected-attributes records for a user.
 *
 * @param userId - Primary key of the user.
 * @param namespaces - A single namespace string or an array of namespace strings.
 * @returns A {@link CoreResult} with `successes: [null]` on success.
 */
const deleteProtectedAttributeNamespacesForUser = async (
  userId: string,
  namespaces: string | string[],
): Promise<CoreResult<null>> => {
  _checkInit();
  const uid = _resolveUniqueIdentifier(userId);
  if (!uid)
    return coreFailureResult(
      'deleteProtectedAttributeNamespacesForUser',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
    );
  return deleteProtectedAttributeNamespaces(uid, namespaces);
};

/**
 * Deletes all protected-attributes records for a user across every namespace.
 *
 * @param userId - Primary key of the user.
 * @returns A {@link CoreResult} with `successes: [null]` on success, or a failure
 *   with `NOT_FOUND` if the user does not exist.
 */
const deleteAllProtectedAttributesForUser = async (userId: string): Promise<CoreResult<null>> => {
  _checkInit();
  const uid = _resolveUniqueIdentifier(userId);
  if (!uid)
    return coreFailureResult(
      'deleteAllProtectedAttributesForUser',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
    );
  return deleteAllProtectedAttributes(uid);
};

/**
 * Deletes one or more nested key paths within a namespace-scoped protected-attributes record.
 *
 * Pass a single path string or an array. Invalid or reserved paths are skipped and reported
 * as failures; valid paths are deleted in a single DB write.
 *
 * @param userId - Primary key of the user.
 * @param namespace - Namespace of the record to patch.
 * @param keyPaths - A dot-notated path string or an array of them.
 * @returns A {@link CoreResult} with the updated record and any skipped-path failures.
 */
const deleteProtectedAttributeKeysByNamespaceForUser = async (
  userId: string,
  namespace: string,
  keyPaths: string | string[],
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInit();
  const uid = _resolveUniqueIdentifier(userId);
  if (!uid)
    return coreFailureResult(
      'deleteProtectedAttributeKeysByNamespaceForUser',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
      { namespace },
    );
  return deleteProtectedAttributeKeysByNamespace(uid, namespace, keyPaths);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const UserManager = {
  init,
  shutdown,

  // users — write
  createUser,
  createUsers,
  deleteUserById,
  deleteUserByUniqueIdentifier,
  deleteAllUsers,

  // users — read
  getAllUsers,
  getUserById,
  getUserByUniqueIdentifier,
  isIdentifierUnique,

  // users — update
  updateUserById,
  updateUserByUniqueIdentifier,

  // protected attributes — read
  getAllProtectedAttributesForUser,
  getProtectedAttributesForUser,

  // protected attributes — upsert
  setProtectedAttributesForUser,

  // protected attributes — key-level patch
  setProtectedAttributeKeysByNamespaceForUser,

  // protected attributes — delete
  deleteProtectedAttributeNamespacesForUser,
  deleteAllProtectedAttributesForUser,
  deleteProtectedAttributeKeysByNamespaceForUser,
};

/**
 * Extended UserManager surface for test environments only.
 *
 * Exposes cache refresh and clear methods so tests can drive cache state
 * directly without going through the full init/shutdown cycle.
 *
 * @internal
 */
const TestingUserManager = {
  ...UserManager,
  refreshUsersCache,
  refreshProtectedAttributesCache,
  clearUsersCache,
  clearProtectedAttributesCache,
};

export { UserManager, TestingUserManager };
