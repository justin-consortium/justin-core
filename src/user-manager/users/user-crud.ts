import DataManager from '../../data-manager/data-manager';
import { USERS } from '../../data-manager/data-manager.constants';
import { handleDbError } from '../../data-manager/data-manager.helpers';
import type { JUser, NewUserRecord } from '../user.type';
import { assertNoReservedKeys, cleanString, isPlainObject, omitKeys } from '../validation';
import {
  getAllUsersFromCache,
  getUserByIdFromCache,
  getUserByUniqueIdentifierFromCache,
  getUserIdByUniqueIdentifierFromCache,
  upsertUserInCache,
} from './user-cache';

const dm = DataManager.getInstance();

/**
 * Ensures that the DataManager has been initialized before any user
 * CRUD operation can proceed.
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
 * Checks whether a uniqueIdentifier is available (cache-backed).
 *
 * @param userUniqueIdentifier - The unique identifier to check.
 * @returns True if unique; false if it already exists.
 * @throws {Error} If the uniqueIdentifier is invalid.
 */
const isIdentifierUnique = (userUniqueIdentifier: string): boolean => {
  _checkInitialization();

  const cleaned = cleanString(userUniqueIdentifier);
  if (!cleaned) {
    throw new Error(`Invalid unique identifier: ${userUniqueIdentifier}`);
  }

  const existingUserId = getUserIdByUniqueIdentifierFromCache(cleaned);
  return !Boolean(existingUserId);
};

/**
 * Creates a user record in the USERS store (users-only).
 *
 * Persisted shape is flattened:
 * { uniqueIdentifier, ...attributes }
 *
 * User-input failures return null.
 *
 * @param record - New user record.
 * @returns The created user or null.
 */
const createUserRecord = async (record: NewUserRecord): Promise<JUser | null> => {
  _checkInitialization();

  if (!isPlainObject(record)) return null;

  const cleanedUniqueIdentifier = cleanString(record.uniqueIdentifier);
  if (!cleanedUniqueIdentifier) return null;

  const attrs = (record as any).attributes;
  if (!isPlainObject(attrs)) return null;

  // Invariant: caller must not set reserved fields in attributes.
  assertNoReservedKeys(
    attrs,
    ['id', 'uniqueIdentifier'],
    'Cannot set reserved user fields (id, uniqueIdentifier) inside NewUserRecord.attributes.',
  );

  const isUnique = isIdentifierUnique(cleanedUniqueIdentifier);
  if (!isUnique) return null;

  try {
    const convertedUser: Record<string, any> = {
      uniqueIdentifier: cleanedUniqueIdentifier,
      ...attrs,
    };

    const addedUser = (await dm.addItemToCollection(USERS, convertedUser)) as JUser;
    upsertUserInCache(addedUser);

    return addedUser;
  } catch (error) {
    return handleDbError('Failed to add user:', 'createUserRecord', error);
  }
};

/**
 * Creates multiple user records (users-only).
 *
 * NOTE:
 * Protected-attributes creation is intentionally NOT handled here.
 * Cross-domain orchestration belongs in `user-manager.ts` (composition root)
 * so CRUD modules stay single-purpose.
 *
 * @param records - Array of new user records.
 * @returns Successfully created users (may be empty).
 * @throws {Error} If no records provided.
 */
const createUserRecords = async (records: NewUserRecord[]): Promise<JUser[]> => {
  _checkInitialization();

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('No users provided for insertion.');
  }

  const created: JUser[] = [];

  for (const record of records) {
    const user = await createUserRecord(record);
    if (user) created.push(user);
  }

  return created;
};

/**
 * Retrieves all cached users.
 *
 * @returns All cached users.
 */
const getAllUsers = (): JUser[] => {
  _checkInitialization();
  return getAllUsersFromCache();
};

/**
 * Retrieves a user by id from the cache.
 *
 * @param userId - The user's id.
 * @returns The user or null.
 */
const getUserById = (userId: string): JUser | null => {
  _checkInitialization();

  const cleaned = cleanString(userId);
  if (!cleaned) return null;

  return getUserByIdFromCache(cleaned);
};

/**
 * Retrieves a user by uniqueIdentifier from the cache.
 *
 * @param uniqueIdentifier - The unique identifier.
 * @returns The user or null.
 */
const getUserByUniqueIdentifier = (uniqueIdentifier: string): JUser | null => {
  _checkInitialization();

  const cleaned = cleanString(uniqueIdentifier);
  if (!cleaned) return null;

  return getUserByUniqueIdentifierFromCache(cleaned);
};

/**
 * Updates a user's application-level fields (top-level) by userId.
 *
 * User-input failures throw only for invalid shapes; reserved/invariants throw.
 *
 * @param userId - The user's id.
 * @param attributesToUpdate - Fields to update.
 * @returns Updated user.
 * @throws {Error} If reserved fields are updated or update fails.
 */
const updateUserById = async (userId: string, attributesToUpdate: object): Promise<JUser> => {
  _checkInitialization();

  const cleanedUserId = cleanString(userId);
  if (!cleanedUserId) throw new Error('Invalid userId.');

  if (!isPlainObject(attributesToUpdate)) throw new Error('Invalid attributesToUpdate.');

  // Invariant: reserved fields must not be updated.
  assertNoReservedKeys(
    attributesToUpdate,
    ['id', 'uniqueIdentifier'],
    'Cannot update reserved user fields (id, uniqueIdentifier).',
  );

  const existingUser = getUserByIdFromCache(cleanedUserId);
  if (!existingUser) throw new Error(`User with id (${cleanedUserId}) not found.`);

  const merged = { ...existingUser, ...attributesToUpdate };
  const dataToUpdate = omitKeys(merged as any, ['id', 'uniqueIdentifier'] as const);

  const updatedUser = (await dm.updateItemByIdInCollection(USERS, cleanedUserId, {
    ...dataToUpdate,
  })) as JUser;

  if (!updatedUser) throw new Error(`Failed to update user: ${cleanedUserId}`);

  upsertUserInCache(updatedUser);
  return updatedUser;
};

/**
 * Updates a user's application-level fields (top-level) by uniqueIdentifier.
 *
 * @param userUniqueIdentifier - Unique identifier.
 * @param attributesToUpdate - Fields to update.
 * @returns Updated user or null if not found/invalid input.
 * @throws {Error} If reserved fields are updated.
 */
const updateUserByUniqueIdentifier = async (
  userUniqueIdentifier: string,
  attributesToUpdate: Record<string, any>,
): Promise<JUser | null> => {
  _checkInitialization();

  const cleaned = cleanString(userUniqueIdentifier);
  if (!cleaned) return null;

  if (!isPlainObject(attributesToUpdate)) return null;

  assertNoReservedKeys(
    attributesToUpdate,
    ['id', 'uniqueIdentifier'],
    'Cannot update reserved user fields (id, uniqueIdentifier).',
  );

  const user = getUserByUniqueIdentifierFromCache(cleaned);
  if (!user) return null;

  return await updateUserById(user.id, attributesToUpdate);
};

export {
  isIdentifierUnique,
  createUserRecord,
  createUserRecords,
  getAllUsers,
  getUserById,
  getUserByUniqueIdentifier,
  updateUserById,
  updateUserByUniqueIdentifier,
};

/**
 * Testing exports for CRUD internals.
 *
 * @private
 */
export const __testing__userCrud = {
  _checkInitialization,
};
