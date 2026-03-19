import { DataManager, USERS } from '../../data-manager';
import {
  checkInitialized,
  coreSuccess,
  coreFailure,
  coreFailureResult,
  unwrapSuccess,
  makeLoopFailureCollector,
} from '../../utils';
import { JustinErrorCode } from '../../errors';
import type { JUser, NewUserRecord } from '../types';
import type { CoreResult } from '../../types';
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
 * @returns True if unique; false if it already exists or input is invalid.
 */
const isIdentifierUnique = (userUniqueIdentifier: string): boolean => {
  _checkInitialization();

  if (!isNonEmptyString(userUniqueIdentifier)) return false;

  const existingUserId = getUserIdByUniqueIdentifierFromCache(userUniqueIdentifier);
  return !Boolean(existingUserId);
};

/**
 * Creates a single user record in the USERS store.
 *
 * Persisted shape: { uniqueIdentifier, ...attributes }
 * Returns null on any validation failure or DB error — caller is responsible
 * for logging context since this is used both standalone and from createUserRecords.
 *
 * @param record - New user record.
 * @returns The created user or null if input is invalid or the DB operation fails.
 */
const createUserRecord = async (record: NewUserRecord): Promise<CoreResult<JUser>> => {
  _checkInitialization();

  const uid = isNonEmptyString((record as any)?.uniqueIdentifier)
    ? ((record as any).uniqueIdentifier as string)
    : '(unknown)';

  if (!isPlainObject(record))
    return coreFailureResult(
      'createUserRecord',
      JustinErrorCode.VALIDATION_ERROR,
      'record must be a plain object',
      { uniqueIdentifier: uid },
    );
  if (!isNonEmptyString(record.uniqueIdentifier))
    return coreFailureResult(
      'createUserRecord',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier: uid },
    );

  const attrs = (record as any).attributes;
  if (!isPlainObject(attrs))
    return coreFailureResult(
      'createUserRecord',
      JustinErrorCode.VALIDATION_ERROR,
      'attributes must be a plain object',
      { uniqueIdentifier: uid },
    );
  if (!assertNoReservedKeys(attrs, ['id', 'uniqueIdentifier']))
    return coreFailureResult(
      'createUserRecord',
      JustinErrorCode.VALIDATION_ERROR,
      'attributes contains reserved keys (id, uniqueIdentifier)',
      { uniqueIdentifier: uid },
    );
  if (!isIdentifierUnique(record.uniqueIdentifier))
    return coreFailureResult(
      'createUserRecord',
      JustinErrorCode.VALIDATION_ERROR,
      `uniqueIdentifier (${uid}) already exists`,
      { uniqueIdentifier: uid },
    );

  const convertedUser: Record<string, any> = {
    uniqueIdentifier: record.uniqueIdentifier,
    ...attrs,
  };

  const addResult = unwrapSuccess<typeof convertedUser & { id: string }, JUser>(
    await dm.addItemToCollection(USERS, convertedUser),
    'createUserRecord',
    { uniqueIdentifier: uid },
  );
  if (!addResult.ok) return addResult;

  const addedUser = addResult.successes[0] as JUser;
  upsertUserInCache(addedUser);
  return coreSuccess([addedUser]);
};

/**
 * Creates multiple user records.
 *
 * Validates each record individually and tracks per-record failures with
 * full identity context. Protected-attributes creation is intentionally NOT
 * handled here — cross-domain orchestration belongs in user-manager.ts.
 *
 * @param records - Array of new user records.
 * @returns A {@link CoreResult} with per-record success and failure detail.
 */
const createUserRecords = async (records: NewUserRecord[]): Promise<CoreResult<JUser>> => {
  _checkInitialization();

  if (!Array.isArray(records) || records.length === 0) {
    return coreSuccess([]);
  }

  const successes: JUser[] = [];
  const allFailures: import('../../types').FailureEntry[] = [];

  for (const record of records) {
    // Extract uniqueIdentifier early — identity varies per record so
    // construct a fresh collector inside the loop with it baked in
    const uniqueIdentifier = isNonEmptyString((record as any)?.uniqueIdentifier)
      ? ((record as any).uniqueIdentifier as string)
      : '(unknown)';

    const collector = makeLoopFailureCollector<JUser>('createUserRecords', { uniqueIdentifier });

    if (!isPlainObject(record)) {
      collector.push(JustinErrorCode.VALIDATION_ERROR, 'record must be a plain object');
      allFailures.push(...collector.failures);
      continue;
    }
    if (!isNonEmptyString(record.uniqueIdentifier)) {
      collector.push(
        JustinErrorCode.VALIDATION_ERROR,
        'uniqueIdentifier must be a non-empty string',
      );
      allFailures.push(...collector.failures);
      continue;
    }

    const attrs = (record as any).attributes;
    if (!isPlainObject(attrs)) {
      collector.push(JustinErrorCode.VALIDATION_ERROR, 'attributes must be a plain object');
      allFailures.push(...collector.failures);
      continue;
    }
    if (!assertNoReservedKeys(attrs, ['id', 'uniqueIdentifier'])) {
      collector.push(
        JustinErrorCode.VALIDATION_ERROR,
        'attributes contains reserved keys (id, uniqueIdentifier)',
      );
      allFailures.push(...collector.failures);
      continue;
    }
    if (!isIdentifierUnique(record.uniqueIdentifier)) {
      collector.push(
        JustinErrorCode.VALIDATION_ERROR,
        `uniqueIdentifier (${uniqueIdentifier}) already exists`,
      );
      allFailures.push(...collector.failures);
      continue;
    }

    const userResult = await createUserRecord(record);
    if (userResult.ok) {
      successes.push(userResult.successes[0]);
    } else {
      allFailures.push(...userResult.failures);
    }
  }

  return allFailures.length > 0 ? coreFailure(allFailures, successes) : coreSuccess(successes);
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
 * @returns Updated user, or null if input is invalid, user not found, or the DB operation fails.
 */
const updateUserById = async (
  userId: string,
  attributesToUpdate: object,
): Promise<CoreResult<JUser>> => {
  _checkInitialization();

  if (!isNonEmptyString(userId))
    return coreFailureResult(
      'updateUserById',
      JustinErrorCode.VALIDATION_ERROR,
      'userId must be a non-empty string',
      { id: userId },
    );
  if (!isPlainObject(attributesToUpdate))
    return coreFailureResult(
      'updateUserById',
      JustinErrorCode.VALIDATION_ERROR,
      'attributesToUpdate must be a plain object',
      { id: userId },
    );
  if (!assertNoReservedKeys(attributesToUpdate, ['id', 'uniqueIdentifier']))
    return coreFailureResult(
      'updateUserById',
      JustinErrorCode.VALIDATION_ERROR,
      'attributesToUpdate contains reserved keys (id, uniqueIdentifier)',
      { id: userId },
    );

  const existingUser = getUserByIdFromCache(userId);
  if (!existingUser)
    return coreFailureResult(
      'updateUserById',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
    );

  const merged = { ...existingUser, ...attributesToUpdate };
  const dataToUpdate = omitKeys(merged as any, ['id', 'uniqueIdentifier'] as const);

  const updateResult = unwrapSuccess<object, JUser>(
    await dm.updateItemByIdInCollection(USERS, userId, { ...dataToUpdate }),
    'updateUserById',
    { id: userId },
  );
  if (!updateResult.ok) return updateResult;

  const updatedUser = updateResult.successes[0] as JUser;
  upsertUserInCache(updatedUser);
  return coreSuccess([updatedUser]);
};

/**
 * Updates a user's application-level fields by uniqueIdentifier.
 *
 * @param userUniqueIdentifier - Unique identifier.
 * @param attributesToUpdate - Fields to update.
 * @returns Updated user, or null if not found, input is invalid, or the DB operation fails.
 */
const updateUserByUniqueIdentifier = async (
  userUniqueIdentifier: string,
  attributesToUpdate: Record<string, any>,
): Promise<CoreResult<JUser>> => {
  _checkInitialization();

  if (!isNonEmptyString(userUniqueIdentifier))
    return coreFailureResult(
      'updateUserByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier: userUniqueIdentifier },
    );
  if (!isPlainObject(attributesToUpdate))
    return coreFailureResult(
      'updateUserByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'attributesToUpdate must be a plain object',
      { uniqueIdentifier: userUniqueIdentifier },
    );
  if (!assertNoReservedKeys(attributesToUpdate, ['id', 'uniqueIdentifier']))
    return coreFailureResult(
      'updateUserByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'attributesToUpdate contains reserved keys (id, uniqueIdentifier)',
      { uniqueIdentifier: userUniqueIdentifier },
    );

  const user = getUserByUniqueIdentifierFromCache(userUniqueIdentifier);
  if (!user)
    return coreFailureResult(
      'updateUserByUniqueIdentifier',
      JustinErrorCode.NOT_FOUND,
      `user (${userUniqueIdentifier}) not found`,
      { uniqueIdentifier: userUniqueIdentifier },
    );

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
