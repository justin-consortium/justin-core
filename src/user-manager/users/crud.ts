import { DataManager, USERS } from '../../data-manager';
import { handleDbError, checkInitialized } from '../../data-manager/helpers';
import type { JUser, NewUserRecord } from '../types';
import { assertNoReservedKeys, isNonEmptyString, isPlainObject, omitKeys } from '../helpers';
import {
  getAllUsersFromCache,
  getUserByIdFromCache,
  getUserByUniqueIdentifierFromCache,
  getUserIdByUniqueIdentifierFromCache,
  upsertUserInCache,
} from './cache';

const dm = DataManager.getInstance();

const _checkInitialization = (): void => {
  checkInitialized(dm.getInitializationStatus(), 'UserManager');
};

/**
 * Checks whether a uniqueIdentifier is available (cache-backed).
 *
 * @param userUniqueIdentifier - The unique identifier to check.
 * @returns True if unique; false if it already exists.
 * @throws {Error} If the uniqueIdentifier is not a non-empty string.
 */
const isIdentifierUnique = (userUniqueIdentifier: string): boolean => {
  _checkInitialization();

  if (!isNonEmptyString(userUniqueIdentifier)) {
    throw new Error(`Invalid unique identifier: ${userUniqueIdentifier}`);
  }

  const existingUserId = getUserIdByUniqueIdentifierFromCache(userUniqueIdentifier);
  return !Boolean(existingUserId);
};

/**
 * Creates a user record in the USERS store.
 *
 * Persisted shape: { uniqueIdentifier, ...attributes }
 * Invalid user input returns null; DB failures throw.
 *
 * @param record - New user record.
 * @returns The created user or null if input is invalid.
 * @throws {Error} If the DB operation fails.
 */
const createUserRecord = async (record: NewUserRecord): Promise<JUser | null> => {
  _checkInitialization();

  if (!isPlainObject(record)) return null;

  if (!isNonEmptyString(record.uniqueIdentifier)) return null;

  const attrs = (record as any).attributes;
  if (!isPlainObject(attrs)) return null;

  assertNoReservedKeys(
    attrs,
    ['id', 'uniqueIdentifier'],
    'Cannot set reserved user fields (id, uniqueIdentifier) inside NewUserRecord.attributes.',
  );

  const isUnique = isIdentifierUnique(record.uniqueIdentifier);
  if (!isUnique) return null;

  try {
    const convertedUser: Record<string, any> = {
      uniqueIdentifier: record.uniqueIdentifier,
      ...attrs,
    };

    const addedUser = (await dm.addItemToCollection(USERS, convertedUser)) as JUser;
    upsertUserInCache(addedUser);

    return addedUser;
  } catch (error) {
    return handleDbError('Failed to create user record', 'createUserRecord', error);
  }
};

/**
 * Creates multiple user records.
 *
 * NOTE: Protected-attributes creation is intentionally NOT handled here.
 * Cross-domain orchestration belongs in `user-manager/data-manager.ts`.
 *
 * @param records - Array of new user records.
 * @returns Successfully created users (may be fewer than requested).
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

  if (!isNonEmptyString(userId)) return null;

  return getUserByIdFromCache(userId);
};

/**
 * Retrieves a user by uniqueIdentifier from the cache.
 *
 * @param uniqueIdentifier - The unique identifier.
 * @returns The user or null.
 */
const getUserByUniqueIdentifier = (uniqueIdentifier: string): JUser | null => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return null;

  return getUserByUniqueIdentifierFromCache(uniqueIdentifier);
};

/**
 * Updates a user's application-level fields by userId.
 *
 * @param userId - The user's id.
 * @param attributesToUpdate - Fields to update.
 * @returns Updated user.
 * @throws {Error} If input is invalid, reserved fields are included, user not found,
 * or the DB operation fails.
 */
const updateUserById = async (userId: string, attributesToUpdate: object): Promise<JUser> => {
  _checkInitialization();

  if (!isNonEmptyString(userId)) throw new Error('Invalid userId.');

  if (!isPlainObject(attributesToUpdate)) throw new Error('Invalid attributesToUpdate.');

  assertNoReservedKeys(
    attributesToUpdate,
    ['id', 'uniqueIdentifier'],
    'Cannot update reserved user fields (id, uniqueIdentifier).',
  );

  const existingUser = getUserByIdFromCache(userId);
  if (!existingUser) throw new Error(`User with id (${userId}) not found.`);

  const merged = { ...existingUser, ...attributesToUpdate };
  const dataToUpdate = omitKeys(merged as any, ['id', 'uniqueIdentifier'] as const);

  try {
    const updatedUser = (await dm.updateItemByIdInCollection(USERS, userId, {
      ...dataToUpdate,
    })) as JUser;

    if (!updatedUser) throw new Error(`Failed to update user: ${userId}`);

    upsertUserInCache(updatedUser);
    return updatedUser;
  } catch (error) {
    return handleDbError(`Failed to update user: ${userId}`, 'updateUserById', error);
  }
};

/**
 * Updates a user's application-level fields by uniqueIdentifier.
 *
 * @param userUniqueIdentifier - Unique identifier.
 * @param attributesToUpdate - Fields to update.
 * @returns Updated user or null if not found or input is invalid.
 * @throws {Error} If reserved fields are included or the DB operation fails.
 */
const updateUserByUniqueIdentifier = async (
  userUniqueIdentifier: string,
  attributesToUpdate: Record<string, any>,
): Promise<JUser | null> => {
  _checkInitialization();

  if (!isNonEmptyString(userUniqueIdentifier)) return null;

  if (!isPlainObject(attributesToUpdate)) return null;

  assertNoReservedKeys(
    attributesToUpdate,
    ['id', 'uniqueIdentifier'],
    'Cannot update reserved user fields (id, uniqueIdentifier).',
  );

  const user = getUserByUniqueIdentifierFromCache(userUniqueIdentifier);
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
 * @private
 */
export const __testing__userCrud = {
  _checkInitialization,
};
