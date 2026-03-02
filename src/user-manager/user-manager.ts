import DataManager from '../data-manager/data-manager';
import { ChangeListenerManager } from '../data-manager/change-listener.manager';
import { USERS, PROTECTED_ATTRIBUTES } from '../data-manager/data-manager.constants';
import { JUser, NewUserRecord, ProtectedAttributesRecord } from './user.type';
import { handleDbError } from '../data-manager/data-manager.helpers';
import { CollectionChangeType } from '../data-manager/data-manager.type';
import { createLogger } from '../logger/logger';

const Log = createLogger({
  context: {
    source: 'user-manager',
  },
});
/**
 * @type {Map<string, JUser>} _users - In-memory cache for user data.
 * This Map enables quick lookups, insertions, and deletions by `id`.
 * @private
 */
const _users: Map<string, JUser> = new Map();

/**
 * Reverse lookup for users by uniqueIdentifier.
 *
 * Key: uniqueIdentifier
 * Value: userId
 *
 * @private
 */
const _userIdByUniqueIdentifier: Map<string, string> = new Map();

/**
 * In-memory cache for protected attributes.
 *
 * Outer key: uniqueIdentifier
 * Inner key: namespace
 *
 * @private
 */
const _protectedAttributes: Map<string, Map<string, ProtectedAttributesRecord>> = new Map();

const dm = DataManager.getInstance();
const clm = ChangeListenerManager.getInstance();

/**
 * Initializes the UserManager by initializing the DataManager,
 * loading users into the cache, and setting up listeners for
 * user-related database changes.
 *
 * @returns {Promise<void>} Resolves when initialization is complete.
 */
const init = async (): Promise<void> => {
  await dm.init();

  // ensure USERS exists and has a unique index on uniqueIdentifier (idempotent, DB-agnostic)
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

  await refreshCache();
  await refreshProtectedAttributesCache();

  setupChangeListeners();
  setupProtectedAttributesChangeListeners();
};

/**
 * Shuts down the UserManager by removing all change listeners
 *
 * @returns {void}
 */
const shutdown = () => {
  clm.removeChangeListener(USERS, CollectionChangeType.INSERT);
  clm.removeChangeListener(USERS, CollectionChangeType.UPDATE);
  clm.removeChangeListener(USERS, CollectionChangeType.DELETE);

  clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.INSERT);
  clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.UPDATE);
  clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.DELETE);
};

/**
 * Loads all users from the database into the in-memory cache.
 *
 * @returns {Promise<void>} Resolves when users are loaded into the cache.
 */
const refreshCache = async (): Promise<void> => {
  _checkInitialization();
  _users.clear();
  _userIdByUniqueIdentifier.clear();

  const userDocs = await dm.getAllInCollection<JUser>(USERS);
  userDocs.forEach((jUser: any) => {
    _users.set(jUser.id, jUser);

    if (jUser?.uniqueIdentifier) {
      _userIdByUniqueIdentifier.set(jUser.uniqueIdentifier, jUser.id);
    }
  });
};

/**
 * Loads all protected attributes documents from the database into the in-memory cache.
 *
 * @returns {Promise<void>} Resolves when protected attributes are loaded into the cache.
 */
const refreshProtectedAttributesCache = async (): Promise<void> => {
  _checkInitialization();
  _protectedAttributes.clear();

  const docs = await dm.getAllInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES);
  docs.forEach((doc: ProtectedAttributesRecord) => {
    if (!doc?.uniqueIdentifier || !doc?.namespace) return;

    const byNamespace =
      _protectedAttributes.get(doc.uniqueIdentifier) ??
      new Map<string, ProtectedAttributesRecord>();
    byNamespace.set(doc.namespace, doc);
    _protectedAttributes.set(doc.uniqueIdentifier, byNamespace);
  });
};

/**
 * Sets up change listeners for user-related database changes.
 * @private
 */
const setupChangeListeners = (): void => {
  clm.addChangeListener(USERS, CollectionChangeType.INSERT, (jUser: JUser) => {
    _users.set(jUser.id, jUser);
    if (jUser?.uniqueIdentifier) {
      _userIdByUniqueIdentifier.set(jUser.uniqueIdentifier, jUser.id);
    }
  });

  clm.addChangeListener(USERS, CollectionChangeType.UPDATE, (jUser: JUser) => {
    _users.set(jUser.id, jUser);
    if (jUser?.uniqueIdentifier) {
      _userIdByUniqueIdentifier.set(jUser.uniqueIdentifier, jUser.id);
    }
  });

  clm.addChangeListener(USERS, CollectionChangeType.DELETE, (userId: string) => {
    const existingUser = _users.get(userId) as any;
    const uniqueIdentifier = existingUser?.uniqueIdentifier;

    _users.delete(userId);

    if (uniqueIdentifier) {
      _userIdByUniqueIdentifier.delete(uniqueIdentifier);
      _protectedAttributes.delete(uniqueIdentifier);
    }
  });
};

/**
 * Sets up change listeners for protected-attributes database changes.
 * @private
 */
const setupProtectedAttributesChangeListeners = (): void => {
  clm.addChangeListener(
    PROTECTED_ATTRIBUTES,
    CollectionChangeType.INSERT,
    (doc: ProtectedAttributesRecord) => {
      if (!doc?.uniqueIdentifier || !doc?.namespace) return;

      const byNamespace =
        _protectedAttributes.get(doc.uniqueIdentifier) ??
        new Map<string, ProtectedAttributesRecord>();
      byNamespace.set(doc.namespace, doc);
      _protectedAttributes.set(doc.uniqueIdentifier, byNamespace);
    },
  );

  clm.addChangeListener(
    PROTECTED_ATTRIBUTES,
    CollectionChangeType.UPDATE,
    (doc: ProtectedAttributesRecord) => {
      if (!doc?.uniqueIdentifier || !doc?.namespace) return;

      const byNamespace =
        _protectedAttributes.get(doc.uniqueIdentifier) ??
        new Map<string, ProtectedAttributesRecord>();
      byNamespace.set(doc.namespace, doc);
      _protectedAttributes.set(doc.uniqueIdentifier, byNamespace);
    },
  );

  clm.addChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.DELETE, (docId: string) => {
    // ChangeListenerManager currently passes only the id for deletes (same as USERS).
    for (const [uniqueIdentifier, byNamespace] of _protectedAttributes.entries()) {
      for (const [namespace, doc] of byNamespace.entries()) {
        if ((doc as any)?.id === docId) {
          byNamespace.delete(namespace);
          if (byNamespace.size === 0) {
            _protectedAttributes.delete(uniqueIdentifier);
          } else {
            _protectedAttributes.set(uniqueIdentifier, byNamespace);
          }
          return;
        }
      }
    }
  });
};

/**
 * Ensures that the DataManager has been initialized before any user
 * management operation can proceed.
 *
 * @throws Error if DataManager is not initialized.
 * @private
 */
const _checkInitialization = (): void => {
  if (!dm.getInitializationStatus()) {
    throw new Error('UserManager has not been initialized');
  }
};

const deleteAllProtectedAttributesByUserId = async (userId: string): Promise<void> => {
  _checkInitialization();

  if (!userId || typeof userId !== 'string') {
    return;
  }

  const user = _users.get(userId);
  if (!user) {
    return;
  }

  const uniqueIdentifier = user.uniqueIdentifier;

  const docs = await dm.findItemsInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES, {
    uniqueIdentifier,
  });

  for (const doc of docs) {
    if ((doc as any)?.id) {
      await dm.removeItemFromCollection(PROTECTED_ATTRIBUTES, (doc as any).id);
    }
  }

  _protectedAttributes.delete(uniqueIdentifier);
};

const deleteProtectedAttributesByNamespace = async (
  userId: string,
  namespace: string,
): Promise<boolean> => {
  _checkInitialization();

  if (!userId || typeof userId !== 'string') {
    return false;
  }

  if (!namespace || typeof namespace !== 'string') {
    return false;
  }

  const user = _users.get(userId);
  if (!user) {
    return false;
  }

  const uniqueIdentifier = user.uniqueIdentifier;

  const docs = await dm.findItemsInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES, {
    uniqueIdentifier,
    namespace,
  });

  let deletedAny = false;

  for (const doc of docs) {
    if ((doc as any)?.id) {
      const deleted = await dm.removeItemFromCollection(PROTECTED_ATTRIBUTES, (doc as any).id);
      deletedAny = deletedAny || Boolean(deleted);
    }
  }

  if (deletedAny) {
    const byNamespace = _protectedAttributes.get(uniqueIdentifier);
    if (byNamespace) {
      byNamespace.delete(namespace);

      if (byNamespace.size === 0) {
        _protectedAttributes.delete(uniqueIdentifier);
      } else {
        _protectedAttributes.set(uniqueIdentifier, byNamespace);
      }
    }
  }

  return deletedAny;
};

/**
 * Adds one user to the Users collection in a single operation.
 * @param {object} user - The user object to add.
 * @returns {Promise<JUser | null>} Resolves with the added user or null if the operation fails.
 * @throws {Error} If no user is provided or if the user fails validation.
 */
const addUser = async (user: NewUserRecord): Promise<JUser | null> => {
  _checkInitialization();

  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    const msg = `Invalid user data: ${JSON.stringify(user)}. It must be a non-null object and should not be an array.`;
    Log.warn(msg);
    return null;
  }

  if (!user.uniqueIdentifier) {
    const msg = `UniqueIdentifier is missing`;
    Log.warn(msg);
    return null;
  }

  const userDataCheck = await isIdentifierUnique(user['uniqueIdentifier']);

  if (!userDataCheck) {
    Log.warn(
      `User's unique identifier already exists. Skipping insertion: ${user.uniqueIdentifier}. `,
    );
    return null;
  }

  try {
    const { uniqueIdentifier, initialAttributes } = user;
    const convertedUser: object = {
      uniqueIdentifier,
      ...(initialAttributes ?? {}),
    };
    const addedUser = (await dm.addItemToCollection(USERS, convertedUser)) as JUser;

    _users.set(addedUser.id, addedUser);
    if (addedUser?.uniqueIdentifier) {
      _userIdByUniqueIdentifier.set(addedUser.uniqueIdentifier, addedUser.id);
    }

    Log.info(`Added user: ${user.uniqueIdentifier}. `);
    return addedUser;
  } catch (error) {
    return handleDbError('Failed to add users:', 'addUser', error);
  }
};

/**
 * Adds multiple users to the Users collection in a single operation.
 * @param {NewUserRecord[]} users - An array of user objects to add.
 * @returns {Promise<JUser[]>} Resolves with the successfully added users (may be empty).
 * @throws {Error} If no users are provided.
 */
const addUsers = async (users: NewUserRecord[]): Promise<JUser[]> => {
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error('No users provided for insertion.');
  }

  try {
    const addedUsers: JUser[] = [];

    for (const user of users) {
      const addedUser = await addUser(user);
      if (addedUser) {
        addedUsers.push(addedUser);
      }
    }

    if (addedUsers.length > 0) {
      Log.info(`${addedUsers.length} user(s) added successfully.`);
    } else {
      Log.info('No new users were added.');
    }

    return addedUsers;
  } catch (error) {
    return handleDbError('Failed to add users:', 'addUsers', error) as any;
  }
};

/**
 * Retrieves all cached users.
 *
 * @returns {JUser[]} An array of all cached users.
 */
const getAllUsers = (): JUser[] => {
  _checkInitialization();
  return Array.from(_users.values());
};

/**
 * Retrieves a user by their id from the cache.
 *
 * @returns {JUser | null} The user with the specified id, or null if not found.
 */
const getUserById = (userId: string): JUser | null => {
  _checkInitialization();
  return (_users.get(userId) as JUser) ?? null;
};

/**
 * Retrieves a user by their unique identifier from the cache.
 * @returns {JUser | null} The user with the specified unique identifier, or null if not found.
 */
const getUserByUniqueIdentifier = (uniqueIdentifier: string): JUser | null => {
  _checkInitialization();

  const userId = _userIdByUniqueIdentifier.get(uniqueIdentifier);
  if (!userId) return null;

  return (_users.get(userId) as JUser) ?? null;
};

/**
 * Update the properties of a user by uniqueIdentifier
 * @param {string} userUniqueIdentifier - the uniqueIdentifier value.
 * @param {object} attributesToUpdate - the data to update.
 * @returns {Promise<JUser | null>} Resolves with the updated JUser or `null` on error.
 */
const updateUserByUniqueIdentifier = async (
  userUniqueIdentifier: string,
  attributesToUpdate: Record<string, any>,
): Promise<JUser | null> => {
  if ('uniqueIdentifier' in (attributesToUpdate as any)) {
    throw new Error('Cannot update uniqueIdentifier.');
  }

  const theUser: JUser | null = getUserByUniqueIdentifier(userUniqueIdentifier);
  if (!theUser) {
    throw new Error(`User with uniqueIdentifier (${userUniqueIdentifier}) not found.`);
  }
  return updateUserById(theUser.id, attributesToUpdate);
};

/**
 * Updates a user's data in both the database and the in-memory cache.
 *
 * @param {string} userId - The user's ID.
 * @param {object} attributesToUpdate - New data to update.
 * @returns {Promise<JUser>} Resolves to the updated user.
 */
const updateUserById = async (userId: string, attributesToUpdate: object): Promise<JUser> => {
  _checkInitialization();

  if ('uniqueIdentifier' in (attributesToUpdate as any)) {
    throw new Error('Cannot update uniqueIdentifier.');
  }

  const existingUser: JUser | null = _users.get(userId) as JUser;

  const mergedAttributes = { ...existingUser, ...attributesToUpdate };

  // Ensure reserved fields are not accidentally overwritten
  const { id, uniqueIdentifier, ...dataToUpdate } = mergedAttributes as any;

  const updatedUser = (await dm.updateItemByIdInCollection(USERS, userId, {
    ...dataToUpdate,
  })) as JUser;
  if (!updatedUser) {
    throw new Error(`Failed to update user: ${userId}`);
  }

  _users.set(updatedUser.id, updatedUser);
  if (updatedUser?.uniqueIdentifier) {
    _userIdByUniqueIdentifier.set(updatedUser.uniqueIdentifier, updatedUser.id);
  }

  return updatedUser;
};

/**
 * Deletes a user by ID from both the database and the in-memory cache.
 *
 * @param {string} userId - The user's ID.
 * @returns {Promise<boolean>} Resolves to true if deletion was successful, false otherwise.
 */
const deleteUserById = async (userId: string): Promise<boolean> => {
  _checkInitialization();

  const result = await dm.removeItemFromCollection(USERS, userId);
  if (result) {
    const existingUser = _users.get(userId) as any;
    const uniqueIdentifier = existingUser?.uniqueIdentifier;

    _users.delete(userId);

    await deleteAllProtectedAttributesByUserId(userId);

    if (uniqueIdentifier) {
      _userIdByUniqueIdentifier.delete(uniqueIdentifier);
    }
  }

  return result;
};

/**
 * Deletes a user by ID from both the database and the in-memory cache.
 *
 * @param {string} userId - The user's ID.
 * @returns {Promise<boolean>} Resolves to true if deletion was successful, false otherwise.
 */
const deleteUserByUniqueIdentifier = async (uniqueIdentifier: string): Promise<boolean> => {
  const theUser: JUser | null = getUserByUniqueIdentifier(uniqueIdentifier);
  if (!theUser) {
    return false;
  }

  return await deleteUserById(theUser.id);
};

/**
 * Deletes all users from the database and clears the in-memory cache.
 *
 * @returns {Promise<void>} Resolves when all users are deleted.
 */
const deleteAllUsers = async (): Promise<void> => {
  _checkInitialization();

  await dm.clearCollection(USERS);
  await dm.clearCollection(PROTECTED_ATTRIBUTES);

  _users.clear();
  _userIdByUniqueIdentifier.clear();
  _protectedAttributes.clear();
};

/**
 * Check for unique identifier duplication.
 * @param {string} userUniqueIdentifier - the unique identifier.
 * @returns {Promise<boolean>} Resolves with a boolean indicating if the identifier is unique.
 * If the unique identifier is new, it returns true; otherwise, it returns false.
 */
const isIdentifierUnique = async (userUniqueIdentifier: string): Promise<boolean> => {
  if (
    !userUniqueIdentifier ||
    typeof userUniqueIdentifier !== 'string' ||
    userUniqueIdentifier.trim() === ''
  ) {
    const msg = `Invalid unique identifier: ${userUniqueIdentifier}`;
    throw new Error(msg);
  }

  const existingUserId = _userIdByUniqueIdentifier.get(userUniqueIdentifier);
  if (existingUserId) {
    const msg = `User with unique identifier (${userUniqueIdentifier}) already exists.`;
    Log.debug(msg);
    return false;
  }

  return true;
};

/**
 * UserManager provides methods for managing users.
 *
 * Includes user creation, deletion, retrieval, and updates.
 * @namespace UserManager
 */
export const UserManager = {
  init,
  addUser,
  addUsers,
  getAllUsers,
  getUserById,
  getUserByUniqueIdentifier,
  updateUserById,
  updateUserByUniqueIdentifier,
  deleteUserById,
  deleteUserByUniqueIdentifier,
  deleteProtectedAttributesByNamespace,
  deleteAllUsers,
  shutdown,
};

/**
 * TestingUserManager provides additional utilities for testing.
 *
 * @namespace TestingUserManager
 * @private
 */
export const TestingUserManager = {
  ...UserManager,
  _checkInitialization,
  refreshCache,
  refreshProtectedAttributesCache,
  isIdentifierUnique,
  setupChangeListeners,
  setupProtectedAttributesChangeListeners,
  _users, // Exposes the in-memory cache for testing purposes
  _userIdByUniqueIdentifier, // Exposes the reverse lookup cache for testing purposes
  _protectedAttributes, // Exposes the in-memory cache for testing purposes
};
