import DataManager from '../data-manager/data-manager';
import { ChangeListenerManager } from '../data-manager/change-listener.manager';
import { PROTECTED_ATTRIBUTES, USERS } from '../data-manager/data-manager.constants';
import { CollectionChangeType } from '../data-manager/data-manager.type';
import { createLogger } from '../logger/logger';
import { JUser, NewUserRecord, NamespacedAttributes, ProtectedAttributesRecord } from './user.type';
import { cleanNamespace, cleanString, isPlainObject } from './validation';
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
  addProtectedAttributesForUniqueIdentifier,
  upsertProtectedAttributesForUniqueIdentifier,
  deleteProtectedAttributesByNamespaceForUniqueIdentifier,
  deleteAllProtectedAttributesForUniqueIdentifier,
  getProtectedAttributesByNamespacesForUniqueIdentifier,
} from './protected-attributes/protected-attributes-crud';
import {removeUserChangeListeners, setupUserChangeListeners} from "./users/user-listeners";
import {
  removeProtectedAttributesChangeListeners,
  setupProtectedAttributesChangeListeners
} from "./protected-attributes/protected-attributes-listeners";

const Log = createLogger({
  context: {
    source: 'user-manager',
  },
});

const dm = DataManager.getInstance();
const clm = ChangeListenerManager.getInstance();

/**
 * Ensures that the DataManager has been initialized before any operation can proceed.
 *
 * @throws {Error} If DataManager is not initialized.
 * @private
 */
const _checkInitialization = (): void => {
  if (!dm.getInitializationStatus()) {
    throw new Error('UserManager has not been initialized');
  }
};

/**
 * Initializes the UserManager:
 * - initializes DataManager
 * - ensures stores + indexes exist
 * - refreshes caches
 * - wires change listeners
 *
 * @returns {Promise<void>} Resolves when initialization is complete.
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

  // When a user is deleted, clear protected-attributes cache for that uniqueIdentifier.
  setupUserChangeListeners((uniqueIdentifier: string) => {
    deleteProtectedAttributesByUniqueIdentifierFromCache(uniqueIdentifier);
  });

  setupProtectedAttributesChangeListeners();
};

/**
 * Shuts down the UserManager by removing all change listeners.
 *
 * @returns {void}
 */
const shutdown = (): void => {
  clm.removeChangeListener(USERS, CollectionChangeType.INSERT);
  clm.removeChangeListener(USERS, CollectionChangeType.UPDATE);
  clm.removeChangeListener(USERS, CollectionChangeType.DELETE);

  clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.INSERT);
  clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.UPDATE);
  clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.DELETE);

  // Also remove via module helpers (failsafe).
  removeUserChangeListeners();
  removeProtectedAttributesChangeListeners();
};

/**
 * Workflow: Creates a user and optionally creates protected-attributes docs.
 *
 * User-input failures return null.
 * Reserved/invariant violations throw (enforced by underlying modules).
 *
 * @param record - New user record.
 * @returns Created user or null.
 */
const createUser = async (record: NewUserRecord): Promise<JUser | null> => {
  _checkInitialization();

  const user = await createUserRecord(record);
  if (!user) return null;

  const uniqueIdentifier = cleanString(user.uniqueIdentifier);
  if (!uniqueIdentifier) return user;

  const items = Array.isArray(record?.protectedAttributes) ? record.protectedAttributes : [];
  if (items.length === 0) return user;

  for (const item of items as NamespacedAttributes[]) {
    try {
      // Let protected-attributes layer validate/sanitize.
      await addProtectedAttributesForUniqueIdentifier(
        uniqueIdentifier,
        item?.namespace,
        item?.protectedAttributes,
      );
    } catch (err) {
      // Best-effort: do not fail user creation.
      const ns = String(item?.namespace ?? '');
      Log.warn(`Failed to create protectedAttributes for user (${uniqueIdentifier}) namespace (${ns}).`);
      Log.warn(String((err as any)?.message ?? err));
    }
  }

  return user;
};

/**
 * Workflow: Creates multiple users and optionally their protected-attributes docs.
 *
 * @param records - New user records.
 * @returns Successfully created users (may be empty).
 * @throws {Error} If no records provided.
 */
const createUsers = async (records: NewUserRecord[]): Promise<JUser[]> => {
  _checkInitialization();

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('No users provided for insertion.');
  }

  return await createUserRecords(records);
};

/**
 * Workflow: Deletes a user by id and cascades protected-attributes deletion.
 *
 * User-input failures return false.
 *
 * @param userId - User id.
 * @returns True if user was deleted.
 */
const deleteUserById = async (userId: string): Promise<boolean> => {
  _checkInitialization();

  const cleanedUserId = cleanString(userId);
  if (!cleanedUserId) return false;

  const existing = getUserByIdFromCache(cleanedUserId);
  if (!existing?.uniqueIdentifier) return false;

  await deleteAllProtectedAttributesForUniqueIdentifier(existing.uniqueIdentifier);

  // Delete user record (users-only) using DataManager directly so orchestration owns cascade.
  const deleted = await dm.removeItemFromCollection(USERS, cleanedUserId);
  if (deleted) {
    // Ensure caches are cleared defensively (listeners should also handle this).
    clearUsersCache();
    await refreshUsersCache();
  }

  return Boolean(deleted);
};

/**
 * Workflow: Deletes a user by uniqueIdentifier and cascades protected-attributes deletion.
 *
 * @param uniqueIdentifier - Unique identifier.
 * @returns True if deleted.
 */
const deleteUserByUniqueIdentifier = async (uniqueIdentifier: string): Promise<boolean> => {
  _checkInitialization();

  const cleaned = cleanString(uniqueIdentifier);
  if (!cleaned) return false;

  const existing = getUserByUniqueIdentifierFromCache(cleaned);
  if (!existing) return false;

  return await deleteUserById(existing.id);
};

/**
 * Deletes all users and protected attributes (full reset).
 *
 * @returns {Promise<void>}
 */
const deleteAllUsers = async (): Promise<void> => {
  _checkInitialization();

  await dm.clearCollection(USERS);
  await dm.clearCollection(PROTECTED_ATTRIBUTES);

  clearUsersCache();
  clearProtectedAttributesCache();
};

/**
 * Wrapper: gets protected attributes for a userId (namespaces).
 *
 * @param userId - User id.
 * @param namespaces - Namespaces to retrieve.
 * @returns Matching records.
 */
const getProtectedAttributesByNamespaces = (
  userId: string,
  namespaces: string[],
): ProtectedAttributesRecord[] => {
  _checkInitialization();

  const cleanedUserId = cleanString(userId);
  if (!cleanedUserId) return [];

  const user = getUserByIdFromCache(cleanedUserId);
  if (!user?.uniqueIdentifier) return [];

  return getProtectedAttributesByNamespacesForUniqueIdentifier(user.uniqueIdentifier, namespaces);
};

/**
 * Wrapper: add protected attributes for a userId + namespace.
 *
 * @param userId - User id.
 * @param namespace - Namespace.
 * @param protectedAttributes - Protected payload.
 * @returns Created record or null.
 */
const addProtectedAttributesForUser = async (
  userId: string,
  namespace: string,
  protectedAttributes: Record<string, any>,
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  const cleanedUserId = cleanString(userId);
  if (!cleanedUserId) return null;

  const user = getUserByIdFromCache(cleanedUserId);
  if (!user?.uniqueIdentifier) return null;

  return await addProtectedAttributesForUniqueIdentifier(user.uniqueIdentifier, namespace, protectedAttributes);
};

/**
 * Wrapper: upsert protected attributes for a userId + namespace.
 *
 * @param userId - User id.
 * @param namespace - Namespace.
 * @param protectedAttributes - Protected payload.
 * @returns Upserted record or null.
 */
const updateProtectedAttributesForUser = async (
  userId: string,
  namespace: string,
  protectedAttributes: Record<string, any>,
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  const cleanedUserId = cleanString(userId);
  if (!cleanedUserId) return null;

  const user = getUserByIdFromCache(cleanedUserId);
  if (!user?.uniqueIdentifier) return null;

  return await upsertProtectedAttributesForUniqueIdentifier(user.uniqueIdentifier, namespace, protectedAttributes);
};

/**
 * Wrapper: deletes protected attributes for a userId + namespace.
 *
 * @param userId - User id.
 * @param namespace - Namespace.
 * @returns True if any doc deleted.
 */
const deleteProtectedAttributesByNamespace = async (
  userId: string,
  namespace: string,
): Promise<boolean> => {
  _checkInitialization();

  const cleanedUserId = cleanString(userId);
  if (!cleanedUserId) return false;

  const user = getUserByIdFromCache(cleanedUserId);
  if (!user?.uniqueIdentifier) return false;

  return await deleteProtectedAttributesByNamespaceForUniqueIdentifier(user.uniqueIdentifier, namespace);
};

/**
 * Wrapper: deletes all protected attributes for a userId.
 *
 * @param userId - User id.
 * @returns {Promise<void>}
 */
const deleteAllProtectedAttributesByUserId = async (userId: string): Promise<void> => {
  _checkInitialization();

  const cleanedUserId = cleanString(userId);
  if (!cleanedUserId) return;

  const user = getUserByIdFromCache(cleanedUserId);
  if (!user?.uniqueIdentifier) return;

  await deleteAllProtectedAttributesForUniqueIdentifier(user.uniqueIdentifier);
};

const UserManager = {
  init,
  shutdown,

  // Users API
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

  // Protected attributes API
  getProtectedAttributesByNamespaces,
  addProtectedAttributesForUser,
  updateProtectedAttributesForUser,
  deleteProtectedAttributesByNamespace,
  deleteAllProtectedAttributesByUserId,
};

const TestingUserManager = {
  ...UserManager,

  // Cache controls / internals
  refreshUsersCache,
  refreshProtectedAttributesCache,
  clearUsersCache,
  clearProtectedAttributesCache,
};

export { UserManager, TestingUserManager };
