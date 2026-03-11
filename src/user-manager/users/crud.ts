import { DataManager, USERS } from '../../data-manager';
import { handleError, checkInitialized } from '../../data-manager/helpers';
import { JustinErrorCode } from '../../errors';
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
 * @throws {JustinError} If the uniqueIdentifier is not a non-empty string.
 */
const isIdentifierUnique = (userUniqueIdentifier: string): boolean => {
  _checkInitialization();

  if (!isNonEmptyString(userUniqueIdentifier)) {
    handleError(`Invalid unique identifier: ${userUniqueIdentifier}`, 'isIdentifierUnique', {
      code: JustinErrorCode.VALIDATION_ERROR,
      data: { userUniqueIdentifier },
    });
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
 * @throws {JustinError} If the DB operation fails.
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
    return handleError('Failed to create user record', 'createUserRecord', { error });
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
 * @throws {JustinError} If no records provided.
 */
const createUserRecords = async (records: NewUserRecord[]): Promise<JUser[]> => {
  _checkInitialization();

  if (!Array.isArray(records) || records.length === 0) {
    handleError('No users provided for insertion.', 'createUserRecords', {
      code: JustinErrorCode.VALIDATION_ERROR,
    });
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
 * @throws {JustinError} If input is invalid, reserved fields are included, user not found,
 * or the DB operation fails.
 */
const updateUserById = async (userId: string, attributesToUpdate: object): Promise<JUser> => {
  _checkInitialization();

  if (!isNonEmptyString(userId)) {
    handleError('Invalid userId.', 'updateUserById', {
      code: JustinErrorCode.VALIDATION_ERROR,
      data: { userId },
    });
  }

  if (!isPlainObject(attributesToUpdate)) {
    handleError('Invalid attributesToUpdate.', 'updateUserById', {
      code: JustinErrorCode.VALIDATION_ERROR,
    });
  }

  assertNoReservedKeys(
    attributesToUpdate,
    ['id', 'uniqueIdentifier'],
    'Cannot update reserved user fields (id, uniqueIdentifier).',
  );

  const existingUser = getUserByIdFromCache(userId);
  if (!existingUser) {
    handleError(`User with id (${userId}) not found.`, 'updateUserById', {
      code: JustinErrorCode.NOT_FOUND,
      data: { userId },
    });
  }

  const merged = { ...existingUser, ...attributesToUpdate };
  const dataToUpdate = omitKeys(merged as any, ['id', 'uniqueIdentifier'] as const);

  try {
    const updatedUser = (await dm.updateItemByIdInCollection(USERS, userId, {
      ...dataToUpdate,
    })) as JUser;

    if (!updatedUser) {
      handleError(`Failed to update user: ${userId}`, 'updateUserById', {
        code: JustinErrorCode.DB_ERROR,
        data: { userId },
      });
    }

    upsertUserInCache(updatedUser);
    return updatedUser;
  } catch (error) {
    return handleError(`Failed to update user: ${userId}`, 'updateUserById', { error });
  }
};

/**
 * Updates a user's application-level fields by uniqueIdentifier.
 *
 * @param userUniqueIdentifier - Unique identifier.
 * @param attributesToUpdate - Fields to update.
 * @returns Updated user or null if not found or input is invalid.
 * @throws {JustinError} If reserved fields are included or the DB operation fails.
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
