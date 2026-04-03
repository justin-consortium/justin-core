import { DataManager } from '../../data-manager';
import {
  checkInitialized,
  coreSuccess,
  coreFailure,
  coreFailureResult,
  unwrapSuccess,
  makeLoopFailureCollector,
} from '../../utils';
import { JustinErrorCode } from '../../errors';
import type { CoreResult, FailureEntry } from '../../types';
import type { JUser, NewUserRecord } from '../types';
import { assertNoReservedKeys, isNonEmptyString, isPlainObject, omitKeys } from '../helpers';
import { USERS } from '../constants';
import {
  getAllUsersFromCache,
  getUserByIdFromCache,
  getUserByUniqueIdentifierFromCache,
  getUserIdByUniqueIdentifierFromCache,
  upsertUserInCache,
} from './cache';

const dm = DataManager.getInstance();

const _checkInit = (): void => checkInitialized(dm.getInitializationStatus(), 'UserManager');

// ---------------------------------------------------------------------------
// Identifier uniqueness
// ---------------------------------------------------------------------------

/**
 * Checks whether a `uniqueIdentifier` is available, using the in-memory cache
 * so no DB round-trip is needed.
 *
 * Returns `false` for empty or non-string input.
 *
 * @param uniqueIdentifier - The identifier to check.
 */
export const isIdentifierUnique = (uniqueIdentifier: string): boolean => {
  _checkInit();
  if (!isNonEmptyString(uniqueIdentifier)) return false;
  return !Boolean(getUserIdByUniqueIdentifierFromCache(uniqueIdentifier));
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Persists a single new user record to the `users` collection and updates
 * the in-memory cache on success.
 *
 * Validates the record shape, rejects reserved attribute keys, and checks
 * `uniqueIdentifier` uniqueness against the cache before hitting the DB.
 *
 * @param record - New user data.
 * @returns A {@link CoreResult} containing the created {@link JUser} on success.
 */
export const createUserRecord = async (record: NewUserRecord): Promise<CoreResult<JUser>> => {
  _checkInit();

  const _record = record as unknown as Record<string, unknown>;
  const uid = isNonEmptyString(_record?.uniqueIdentifier)
    ? (_record.uniqueIdentifier as string)
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

  const attrs = (record as unknown as Record<string, unknown>).attributes;
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

  const doc: Record<string, unknown> = { uniqueIdentifier: record.uniqueIdentifier, ...attrs };

  const addResult = unwrapSuccess<typeof doc & { id: string }, JUser>(
    await dm.addItemToCollection(USERS, doc),
    'createUserRecord',
    { uniqueIdentifier: uid },
  );
  if (!addResult.ok) return addResult;

  const created = addResult.successes[0] as JUser;
  upsertUserInCache(created);
  return coreSuccess([created]);
};

/**
 * Persists multiple new user records, validating each individually and
 * collecting per-record failures without stopping the batch.
 *
 * Protected-attributes creation is intentionally not handled here —
 * cross-domain orchestration lives in `user-manager.ts`.
 *
 * @param records - Array of new user data.
 * @returns A {@link CoreResult} with per-record success and failure detail.
 */
export const createUserRecords = async (records: NewUserRecord[]): Promise<CoreResult<JUser>> => {
  _checkInit();

  if (!Array.isArray(records) || records.length === 0) return coreSuccess([]);

  const successes: JUser[] = [];
  const allFailures: FailureEntry[] = [];

  for (const record of records) {
    const _rec = record as unknown as Record<string, unknown>;
    const uniqueIdentifier = isNonEmptyString(_rec?.uniqueIdentifier)
      ? (_rec.uniqueIdentifier as string)
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

    const attrs = (record as unknown as Record<string, unknown>).attributes;
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

    const result = await createUserRecord(record);
    if (result.ok) {
      successes.push(result.successes[0]);
    } else {
      allFailures.push(...result.failures);
    }
  }

  return allFailures.length > 0 ? coreFailure(allFailures, successes) : coreSuccess(successes);
};

// ---------------------------------------------------------------------------
// Read (cache-backed)
// ---------------------------------------------------------------------------

/**
 * Returns all users from the in-memory cache.
 *
 * @returns All cached {@link JUser} records as an array, or an empty array if the cache is empty.
 */
export const getAllUsers = (): JUser[] => {
  _checkInit();
  return getAllUsersFromCache();
};

/**
 * Returns the cached user with the given `id`, or `null` if not found.
 *
 * @param userId - Primary key to look up.
 * @returns The matching {@link JUser}, or `null` if not found or if `userId` is empty.
 */
export const getUserById = (userId: string): JUser | null => {
  _checkInit();
  if (!isNonEmptyString(userId)) return null;
  return getUserByIdFromCache(userId);
};

/**
 * Returns the cached user whose `uniqueIdentifier` matches, or `null`.
 *
 * @param uniqueIdentifier - Unique identifier to look up.
 * @returns The matching {@link JUser}, or `null` if not found or if `uniqueIdentifier` is empty.
 */
export const getUserByUniqueIdentifier = (uniqueIdentifier: string): JUser | null => {
  _checkInit();
  if (!isNonEmptyString(uniqueIdentifier)) return null;
  return getUserByUniqueIdentifierFromCache(uniqueIdentifier);
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Updates a user's application-level fields by `id`, merging the provided
 * attributes onto the existing record. Reserved fields (`id`, `uniqueIdentifier`)
 * are rejected.
 *
 * Updates the cache on success.
 *
 * @param userId - Primary key of the user to update.
 * @param attributesToUpdate - Partial application data to merge.
 * @returns A {@link CoreResult} containing the updated {@link JUser} on success.
 */
export const updateUserById = async (
  userId: string,
  attributesToUpdate: object,
): Promise<CoreResult<JUser>> => {
  _checkInit();

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

  const existing = getUserByIdFromCache(userId);
  if (!existing)
    return coreFailureResult(
      'updateUserById',
      JustinErrorCode.NOT_FOUND,
      `user (${userId}) not found`,
      { id: userId },
    );

  const merged = omitKeys(
    { ...existing, ...attributesToUpdate } as Record<string, unknown>,
    ['id', 'uniqueIdentifier'] as const,
  );

  const updateResult = unwrapSuccess<object, JUser>(
    await dm.updateItemByIdInCollection(USERS, userId, { ...merged }),
    'updateUserById',
    { id: userId },
  );
  if (!updateResult.ok) return updateResult;

  const updated = updateResult.successes[0] as JUser;
  upsertUserInCache(updated);
  return coreSuccess([updated]);
};

/**
 * Updates a user's application-level fields by `uniqueIdentifier`.
 *
 * Resolves the `uniqueIdentifier` to an `id` via the cache, then delegates
 * to {@link updateUserById}.
 *
 * @param uniqueIdentifier - Unique identifier of the user to update.
 * @param attributesToUpdate - Partial application data to merge.
 * @returns A {@link CoreResult} containing the updated {@link JUser} on success.
 */
export const updateUserByUniqueIdentifier = async (
  uniqueIdentifier: string,
  attributesToUpdate: Record<string, unknown>,
): Promise<CoreResult<JUser>> => {
  _checkInit();

  if (!isNonEmptyString(uniqueIdentifier))
    return coreFailureResult(
      'updateUserByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier },
    );

  if (!isPlainObject(attributesToUpdate))
    return coreFailureResult(
      'updateUserByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'attributesToUpdate must be a plain object',
      { uniqueIdentifier },
    );

  if (!assertNoReservedKeys(attributesToUpdate, ['id', 'uniqueIdentifier']))
    return coreFailureResult(
      'updateUserByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'attributesToUpdate contains reserved keys (id, uniqueIdentifier)',
      { uniqueIdentifier },
    );

  const user = getUserByUniqueIdentifierFromCache(uniqueIdentifier);
  if (!user)
    return coreFailureResult(
      'updateUserByUniqueIdentifier',
      JustinErrorCode.NOT_FOUND,
      `user (${uniqueIdentifier}) not found`,
      { uniqueIdentifier },
    );

  return updateUserById(user.id, attributesToUpdate);
};
