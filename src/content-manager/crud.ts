import { DataManager } from '../data-manager';
import {
  checkInitialized,
  coreSuccess,
  coreFailure,
  coreFailureResult,
  unwrapSuccess,
  makeLoopFailureCollector,
} from '../utils';
import { JustinErrorCode } from '../errors';
import type { CoreResult, FailureEntry } from '../types';
import type { JContent, NewContentRecord, ContentUpdateRecord } from './types';
import { CONTENT } from './constants';

const dm = DataManager.getInstance();

const _checkInit = (): void => checkInitialized(dm.getInitializationStatus(), 'ContentManager');

const RESERVED_CONTENT_KEYS = ['id', 'uniqueIdentifier', 'type'] as const;

/**
 * Returns `true` if the value is a non-null plain object.
 * @private
 */
const _isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Returns `true` if the string is non-empty.
 * @private
 */
const _isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Returns `true` if the object contains none of the reserved keys.
 * @private
 */
const _hasNoReservedKeys = (obj: Record<string, unknown>): boolean =>
  RESERVED_CONTENT_KEYS.every((k) => !(k in obj));

/**
 * Finds a content record by `uniqueIdentifier`. Returns `null` if not found.
 * @private
 */
const _findByUniqueIdentifier = async (uniqueIdentifier: string): Promise<JContent | null> => {
  const docs = await dm.findItemsInCollection<JContent>(CONTENT, { uniqueIdentifier });
  return docs[0] ?? null;
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Persists a single new content record to the `content` collection.
 *
 * Validates the record shape and rejects reserved keys inside `value`.
 * `uniqueIdentifier` must be unique across all content — a duplicate will
 * result in a DB-level error surfaced as a {@link CoreResult} failure.
 *
 * @param record - New content data.
 * @returns A {@link CoreResult} containing the created {@link JContent} on success.
 */
const createContentRecord = async (record: NewContentRecord): Promise<CoreResult<JContent>> => {
  _checkInit();

  const _record = record as unknown as Record<string, unknown>;
  const uid = _isNonEmptyString(_record?.uniqueIdentifier)
    ? (_record.uniqueIdentifier as string)
    : '(unknown)';

  if (!_isPlainObject(record))
    return coreFailureResult(
      'createContentRecord',
      JustinErrorCode.VALIDATION_ERROR,
      'record must be a plain object',
      { uniqueIdentifier: uid },
    );

  if (!_isNonEmptyString(record.uniqueIdentifier))
    return coreFailureResult(
      'createContentRecord',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier: uid },
    );

  if (!_isNonEmptyString(record.type))
    return coreFailureResult(
      'createContentRecord',
      JustinErrorCode.VALIDATION_ERROR,
      'type must be a non-empty string',
      { uniqueIdentifier: uid },
    );

  if (!_isPlainObject(record.value))
    return coreFailureResult(
      'createContentRecord',
      JustinErrorCode.VALIDATION_ERROR,
      'value must be a plain object',
      { uniqueIdentifier: uid },
    );

  if (!_hasNoReservedKeys(record.value))
    return coreFailureResult(
      'createContentRecord',
      JustinErrorCode.VALIDATION_ERROR,
      'value contains reserved keys (id, uniqueIdentifier, type)',
      { uniqueIdentifier: uid },
    );

  const existing = await _findByUniqueIdentifier(record.uniqueIdentifier);
  if (existing)
    return coreFailureResult(
      'createContentRecord',
      JustinErrorCode.VALIDATION_ERROR,
      `uniqueIdentifier (${uid}) already exists`,
      { uniqueIdentifier: uid },
    );

  const doc = {
    uniqueIdentifier: record.uniqueIdentifier,
    type: record.type,
    value: record.value,
  };

  const addResult = unwrapSuccess<typeof doc & { id: string }, JContent>(
    await dm.addItemToCollection(CONTENT, doc),
    'createContentRecord',
    { uniqueIdentifier: uid },
  );
  if (!addResult.ok) return addResult;

  return coreSuccess([addResult.successes[0] as JContent]);
};

/**
 * Persists multiple new content records, validating each individually and
 * collecting per-record failures without stopping the batch.
 *
 * @param records - Array of new content data.
 * @returns A {@link CoreResult} with per-record success and failure detail.
 */
const createContentRecords = async (records: NewContentRecord[]): Promise<CoreResult<JContent>> => {
  _checkInit();

  if (!Array.isArray(records) || records.length === 0) return coreSuccess([]);

  const successes: JContent[] = [];
  const allFailures: FailureEntry[] = [];

  for (const record of records) {
    const _rec = record as unknown as Record<string, unknown>;
    const uniqueIdentifier = _isNonEmptyString(_rec?.uniqueIdentifier)
      ? (_rec.uniqueIdentifier as string)
      : '(unknown)';

    const collector = makeLoopFailureCollector<JContent>('createContentRecords', {
      uniqueIdentifier,
    });

    if (!_isPlainObject(record)) {
      collector.push(JustinErrorCode.VALIDATION_ERROR, 'record must be a plain object');
      allFailures.push(...collector.failures);
      continue;
    }
    if (!_isNonEmptyString(record.uniqueIdentifier)) {
      collector.push(
        JustinErrorCode.VALIDATION_ERROR,
        'uniqueIdentifier must be a non-empty string',
      );
      allFailures.push(...collector.failures);
      continue;
    }
    if (!_isNonEmptyString(record.type)) {
      collector.push(JustinErrorCode.VALIDATION_ERROR, 'type must be a non-empty string');
      allFailures.push(...collector.failures);
      continue;
    }
    if (!_isPlainObject(record.value)) {
      collector.push(JustinErrorCode.VALIDATION_ERROR, 'value must be a plain object');
      allFailures.push(...collector.failures);
      continue;
    }
    if (!_hasNoReservedKeys(record.value)) {
      collector.push(
        JustinErrorCode.VALIDATION_ERROR,
        'value contains reserved keys (id, uniqueIdentifier, type)',
      );
      allFailures.push(...collector.failures);
      continue;
    }

    const result = await createContentRecord(record);
    if (result.ok) {
      successes.push(result.successes[0]);
    } else {
      allFailures.push(...result.failures);
    }
  }

  return allFailures.length > 0 ? coreFailure(allFailures, successes) : coreSuccess(successes);
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Finds a content record by its primary `id`. Returns `null` if not found.
 *
 * @param contentId - Primary key to look up.
 */
const getContentById = async (contentId: string): Promise<JContent | null> => {
  _checkInit();
  if (!_isNonEmptyString(contentId)) return null;
  return dm.findItemByIdInCollection<JContent>(CONTENT, contentId);
};

/**
 * Finds a content record by its `uniqueIdentifier`. Returns `null` if not found.
 *
 * @param uniqueIdentifier - Human-readable slug to look up.
 */
const getContentByUniqueIdentifier = async (uniqueIdentifier: string): Promise<JContent | null> => {
  _checkInit();
  if (!_isNonEmptyString(uniqueIdentifier)) return null;
  return _findByUniqueIdentifier(uniqueIdentifier);
};

/**
 * Returns all content records of the given type.
 *
 * Returns an empty array if no records match — this is not an error condition.
 *
 * @param type - The content type to filter by (e.g. `'gif'`, `'push-notification'`).
 */
const getContentByType = async (type: string): Promise<JContent[]> => {
  _checkInit();
  if (!_isNonEmptyString(type)) return [];
  return dm.findItemsInCollection<JContent>(CONTENT, { type });
};

/**
 * Returns all content records in the collection.
 */
const getAllContent = async (): Promise<JContent[]> => {
  _checkInit();
  return dm.getAllInCollection<JContent>(CONTENT);
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Updates a content record by `id`.
 *
 * Only the fields provided in `update` are changed. Reserved keys (`id`,
 * `uniqueIdentifier`, `type`) are rejected. If `uniqueIdentifier` is being
 * changed, uniqueness is verified before writing.
 *
 * @param contentId - Primary key of the content record to update.
 * @param update - Fields to apply.
 * @returns A {@link CoreResult} containing the updated {@link JContent} on success.
 */
const updateContentById = async (
  contentId: string,
  update: ContentUpdateRecord,
): Promise<CoreResult<JContent>> => {
  _checkInit();

  if (!_isNonEmptyString(contentId))
    return coreFailureResult(
      'updateContentById',
      JustinErrorCode.VALIDATION_ERROR,
      'contentId must be a non-empty string',
      { id: contentId },
    );

  if (!_isPlainObject(update))
    return coreFailureResult(
      'updateContentById',
      JustinErrorCode.VALIDATION_ERROR,
      'update must be a plain object',
      { id: contentId },
    );

  const existing = await dm.findItemByIdInCollection<JContent>(CONTENT, contentId);
  if (!existing)
    return coreFailureResult(
      'updateContentById',
      JustinErrorCode.NOT_FOUND,
      `content (${contentId}) not found`,
      { id: contentId },
    );

  if (update.value !== undefined) {
    if (!_isPlainObject(update.value))
      return coreFailureResult(
        'updateContentById',
        JustinErrorCode.VALIDATION_ERROR,
        'value must be a plain object',
        { id: contentId },
      );
    if (!_hasNoReservedKeys(update.value))
      return coreFailureResult(
        'updateContentById',
        JustinErrorCode.VALIDATION_ERROR,
        'value contains reserved keys (id, uniqueIdentifier, type)',
        { id: contentId },
      );
  }

  if (update.uniqueIdentifier !== undefined) {
    if (!_isNonEmptyString(update.uniqueIdentifier))
      return coreFailureResult(
        'updateContentById',
        JustinErrorCode.VALIDATION_ERROR,
        'uniqueIdentifier must be a non-empty string',
        { id: contentId },
      );

    if (update.uniqueIdentifier !== existing.uniqueIdentifier) {
      const collision = await _findByUniqueIdentifier(update.uniqueIdentifier);
      if (collision)
        return coreFailureResult(
          'updateContentById',
          JustinErrorCode.VALIDATION_ERROR,
          `uniqueIdentifier (${update.uniqueIdentifier}) already exists`,
          { id: contentId },
        );
    }
  }

  const updatePayload: Record<string, unknown> = {};
  if (update.uniqueIdentifier !== undefined)
    updatePayload.uniqueIdentifier = update.uniqueIdentifier;
  if (update.value !== undefined) updatePayload.value = update.value;

  const updateResult = unwrapSuccess<object, JContent>(
    await dm.updateItemByIdInCollection(CONTENT, contentId, updatePayload),
    'updateContentById',
    { id: contentId },
  );
  if (!updateResult.ok) return updateResult;

  return coreSuccess([updateResult.successes[0] as JContent]);
};

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Removes a content record by `id`.
 *
 * @param contentId - Primary key of the content record to delete.
 * @returns A {@link CoreResult} with `successes: [null]` on success.
 */
const deleteContentById = async (contentId: string): Promise<CoreResult<null>> => {
  _checkInit();

  if (!_isNonEmptyString(contentId))
    return coreFailureResult(
      'deleteContentById',
      JustinErrorCode.VALIDATION_ERROR,
      'contentId must be a non-empty string',
      { id: contentId },
    );

  return dm.removeItemFromCollection(CONTENT, contentId);
};

/**
 * Removes multiple content records by `id` in a single bulk operation.
 *
 * Uses the adapter's bulk delete if available; falls back to one-by-one.
 *
 * @param contentIds - Primary keys of the records to delete.
 * @returns A {@link CoreResult} with per-item success and failure detail.
 */
const deleteContentByIds = async (contentIds: string[]): Promise<CoreResult<{ id: string }>> => {
  _checkInit();

  if (!Array.isArray(contentIds) || contentIds.length === 0) return coreSuccess([]);

  return dm.removeItemsFromCollection(CONTENT, contentIds);
};

/**
 * Removes all content records from the collection.
 *
 * @returns A {@link CoreResult} with `successes: [null]` on success.
 */
const clearAllContent = async (): Promise<CoreResult<null>> => {
  _checkInit();
  return dm.clearCollection(CONTENT);
};

export {
  createContentRecord,
  createContentRecords,
  getContentById,
  getContentByUniqueIdentifier,
  getContentByType,
  getAllContent,
  updateContentById,
  deleteContentById,
  deleteContentByIds,
  clearAllContent,
};
