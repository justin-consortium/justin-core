import DataManager from '../data-manager/data-manager';
import { ChangeListenerManager } from '../data-manager/change-listener.manager';
import { checkInitialized } from '../data-manager/data-manager.helpers';
import { PROTECTED_ATTRIBUTES, USERS } from '../data-manager/data-manager.constants';
import { CollectionChangeType } from '../data-manager/data-manager.type';
import { createLogger } from '../logger/logger';
import { JUser, NewUserRecord, NamespacedAttributes, ProtectedAttributesRecord } from './types';
import { isNonEmptyString } from './helpers';
import {
  clearUsersCache,
  refreshUsersCache,
  getUserByIdFromCache,
  getUserByUniqueIdentifierFromCache,
} from './users/user-cache';
import {
  clearProtectedAttributesCache,
  refreshProtectedAttributesCache,
  deleteProtectedAttributesByUniqueIdentifierFromCache,
} from './protected-attributes/protected-attributes-cache';
import {
  createUserRecord,
  createUserRecords,
  getAllUsers,
  getUserById,
  getUserByUniqueIdentifier,
  updateUserById,
  updateUserByUniqueIdentifier,
  isIdentifierUnique,
} from './users/user-crud';
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
} from './protected-attributes/protected-attributes-crud';
import { removeUserChangeListeners, setupUserChangeListeners } from './users/user-listeners';
import {
  removeProtectedAttributesChangeListeners,
  setupProtectedAttributesChangeListeners,
} from './protected-attributes/protected-attributes-listeners';

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
 * Shuts down the UserManager by removing all change listeners.
 */
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
const createUser = async (record: NewUserRecord): Promise<JUser | null> => {
  _checkInitialization();

  const user = await createUserRecord(record);
  if (!user) return null;

  const uniqueIdentifier = user.uniqueIdentifier;
  if (!isNonEmptyString(uniqueIdentifier)) return user;

  const items = Array.isArray(record?.protectedAttributes) ? record.protectedAttributes : [];
  if (items.length === 0) return user;

  try {
    await setProtectedAttributesByUniqueIdentifier(uniqueIdentifier, items as NamespacedAttributes[]);
  } catch (err) {
    Log.warn(`Failed to create protectedAttributes for user (${uniqueIdentifier}).`);
    Log.warn(String((err as any)?.message ?? err));
  }

  return user;
};

/**
 * Creates multiple users.
 *
 * Note: protected-attributes on batch creation are not currently supported.
 * Use {@link createUser} for individual creation with protected-attributes.
 *
 * @param records - New user records.
 * @returns Successfully created users (may be empty).
 * @throws {Error} If no records are provided.
 */
const createUsers = async (records: NewUserRecord[]): Promise<JUser[]> => {
  _checkInitialization();

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('No users provided for insertion.');
  }

  return await createUserRecords(records);
};

/**
 * Deletes a user by id and cascades protected-attributes deletion.
 *
 * @param userId - The user's id.
 * @returns True if the user was deleted.
 */
const deleteUserById = async (userId: string): Promise<boolean> => {
  _checkInitialization();

  if (!isNonEmptyString(userId)) return false;

  const existing = getUserByIdFromCache(userId);
  if (!existing?.uniqueIdentifier) return false;

  await deleteAllProtectedAttributesByUniqueIdentifier(existing.uniqueIdentifier);

  const deletedCount = await dm.removeItemFromCollection(USERS, userId);
  if (deletedCount > 0) {
    clearUsersCache();
    await refreshUsersCache();
  }

  return deletedCount > 0;
};

/**
 * Deletes a user by uniqueIdentifier and cascades protected-attributes deletion.
 *
 * @param uniqueIdentifier - The user's unique identifier.
 * @returns True if the user was deleted.
 */
const deleteUserByUniqueIdentifier = async (uniqueIdentifier: string): Promise<boolean> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return false;

  const existing = getUserByUniqueIdentifierFromCache(uniqueIdentifier);
  if (!existing) return false;

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
  if (!uid) return [];

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
  if (!uid) return [];

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
 * @returns Array of successfully upserted records.
 * @throws {Error} If any payload contains reserved keys.
 */
const setProtectedAttributesForUser = async (
  userId: string,
  input: NamespacedAttributes | NamespacedAttributes[],
): Promise<ProtectedAttributesRecord[]> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid) return [];

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
 * @returns The updated record, or null if not found or input is invalid.
 * @throws {Error} If the path or value contains reserved keys.
 */
const updateProtectedAttributeForUser = async (
  userId: string,
  namespace: string,
  keyPath: string,
  value: any,
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid) return null;

  return await updateProtectedAttributeByUniqueIdentifier(uid, namespace, keyPath, value);
};

/**
 * Updates multiple nested key paths within a namespace-scoped protected-attributes record.
 *
 * @param userId - The user's id.
 * @param namespace - The namespace of the record to patch.
 * @param updates - An object whose keys are dot-notated paths and values are the values to set.
 * @returns The updated record, or null if not found or input is invalid.
 * @throws {Error} If any path or value contains reserved keys.
 */
const updateProtectedAttributesForUser = async (
  userId: string,
  namespace: string,
  updates: Record<string, any>,
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid) return null;

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
): Promise<boolean> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid) return false;

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
  if (!uid) return;

  await deleteAllProtectedAttributesByUniqueIdentifier(uid);
};

/**
 * Deletes a single nested key path within a namespace-scoped protected-attributes record.
 *
 * @param userId - The user's id.
 * @param namespace - The namespace of the record to patch.
 * @param keyPath - Dot-notated path of the key to delete.
 * @returns The updated record, or null if not found or input is invalid.
 * @throws {Error} If the path contains reserved keys.
 */
const deleteProtectedAttributeForUser = async (
  userId: string,
  namespace: string,
  keyPath: string,
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid) return null;

  return await deleteProtectedAttributeByUniqueIdentifier(uid, namespace, keyPath);
};

/**
 * Deletes multiple nested key paths within a namespace-scoped protected-attributes record.
 *
 * @param userId - The user's id.
 * @param namespace - The namespace of the record to patch.
 * @param keyPaths - A single dot-notated path string or an array of them.
 * @returns The updated record, or null if not found or input is invalid.
 * @throws {Error} If any path contains reserved keys.
 */
const deleteProtectedAttributesFromNamespaceForUser = async (
  userId: string,
  namespace: string,
  keyPaths: string | string[],
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  const uid = _resolveUniqueIdentifier(userId);
  if (!uid) return null;

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

  // protected attributes — read
  getAllProtectedAttributesForUser,
  getProtectedAttributesForUser,

  // protected attributes — upsert
  setProtectedAttributesForUser,

  // protected attributes — key-level patch
  updateProtectedAttributeForUser,
  updateProtectedAttributesForUser,

  // protected attributes — delete
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
