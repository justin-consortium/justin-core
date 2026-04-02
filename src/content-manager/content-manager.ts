import { DataManager } from '../data-manager';
import { checkInitialized } from '../utils';
import { createLogger } from '../logger';
import { registerManager } from '../lifecycle';
import type { CoreResult } from '../types';
import type { JContent, NewContentRecord, ContentUpdateRecord } from './types';
import { CONTENT } from './constants';
import {
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
} from './crud';

const Log = createLogger({ context: { source: 'content-manager' } });

const dm = DataManager.getInstance();

const _checkInit = (): void => checkInitialized(dm.getInitializationStatus(), 'ContentManager');

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialises the ContentManager.
 *
 * Ensures the `content` collection and its indexes exist, then registers the
 * manager with the lifecycle system so {@link shutdownCore} can tear it down
 * without needing an explicit reference.
 *
 * ContentManager does not maintain an in-memory cache or change listeners —
 * all reads go directly to the database, which keeps the setup simple and
 * avoids invalidation complexity for a collection that changes infrequently.
 */
const init = async (): Promise<void> => {
  await dm.init();

  await dm.ensureStore(CONTENT);
  await dm.ensureIndexes(CONTENT, [
    { name: 'uniq_content_identifier', key: { uniqueIdentifier: 1 }, unique: true },
    { name: 'idx_content_type', key: { type: 1 } },
  ]);

  Log.debug('ContentManager initialised');

  registerManager({ shutdown });
};

/**
 * Shuts down the ContentManager.
 *
 * ContentManager holds no change streams or stateful resources, so this is
 * effectively a no-op. It exists to satisfy the lifecycle contract so
 * {@link shutdownCore} can call it uniformly alongside other managers.
 */
const shutdown = async (): Promise<void> => {
  Log.debug('ContentManager shutdown');
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Creates a single content record.
 *
 * `uniqueIdentifier` must be unique across all content. `type` categorises the
 * record for filtering via {@link getContentByType}. `value` is the open-ended
 * payload — its shape is entirely up to the application.
 *
 * @param record - New content data.
 * @returns A {@link CoreResult} containing the created {@link JContent} on success.
 *
 * @example
 * ```ts
 * const result = await ContentManager.createContent({
 *   uniqueIdentifier: 'gif-walking-1',
 *   type: 'gif',
 *   value: { url: 'https://...', altText: 'Person walking' },
 * });
 * if (!result.ok) { ... }
 * const content = result.successes[0];
 * ```
 */
const createContent = async (record: NewContentRecord): Promise<CoreResult<JContent>> => {
  _checkInit();
  return createContentRecord(record);
};

/**
 * Creates multiple content records in a single call.
 *
 * Each record is validated individually — failures do not stop the batch.
 * Partial success is possible: `result.successes` holds the created records
 * and `result.failures` holds detail for each record that did not succeed.
 *
 * @param records - Array of new content data.
 * @returns A {@link CoreResult} with per-record success and failure detail.
 */
const createContents = async (records: NewContentRecord[]): Promise<CoreResult<JContent>> => {
  _checkInit();
  return createContentRecords(records);
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Returns the content record with the given `id`, or `null` if not found.
 *
 * @param contentId - Primary key to look up.
 */
const getContent = async (contentId: string): Promise<JContent | null> => {
  _checkInit();
  return getContentById(contentId);
};

/**
 * Returns the content record with the given `uniqueIdentifier`, or `null`
 * if not found.
 *
 * @param uniqueIdentifier - Human-readable slug to look up (e.g. `'gif-walking-1'`).
 */
const getContentBySlug = async (uniqueIdentifier: string): Promise<JContent | null> => {
  _checkInit();
  return getContentByUniqueIdentifier(uniqueIdentifier);
};

/**
 * Returns all content records of the given type.
 *
 * Returns an empty array if no records match — this is not an error condition.
 * Use this in the engine to pull all available content for a given intervention
 * type before selecting which record to assign to a participant.
 *
 * @param type - Content type to filter by (e.g. `'gif'`, `'push-notification'`).
 *
 * @example
 * ```ts
 * const gifs = await ContentManager.getContentByType('gif');
 * const chosen = gifs[Math.floor(Math.random() * gifs.length)];
 * ```
 */
const getByType = async (type: string): Promise<JContent[]> => {
  _checkInit();
  return getContentByType(type);
};

/**
 * Returns all content records in the collection.
 */
const getAll = async (): Promise<JContent[]> => {
  _checkInit();
  return getAllContent();
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Updates a content record by `id`.
 *
 * Only the fields provided in `update` are changed — `uniqueIdentifier` and
 * `value` can be updated independently. Changing `uniqueIdentifier` triggers a
 * uniqueness check. The `type` field is intentionally not updatable to preserve
 * collection integrity.
 *
 * @param contentId - Primary key of the record to update.
 * @param update - Fields to apply.
 * @returns A {@link CoreResult} containing the updated {@link JContent} on success.
 */
const updateContent = async (
  contentId: string,
  update: ContentUpdateRecord,
): Promise<CoreResult<JContent>> => {
  _checkInit();
  return updateContentById(contentId, update);
};

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Deletes a content record by `id`.
 *
 * @param contentId - Primary key of the record to delete.
 * @returns A {@link CoreResult} with `successes: [null]` on success.
 */
const deleteContent = async (contentId: string): Promise<CoreResult<null>> => {
  _checkInit();
  return deleteContentById(contentId);
};

/**
 * Deletes multiple content records by `id` in a single bulk operation.
 *
 * @param contentIds - Primary keys of the records to delete.
 * @returns A {@link CoreResult} with per-item success and failure detail.
 */
const deleteContents = async (contentIds: string[]): Promise<CoreResult<{ id: string }>> => {
  _checkInit();
  return deleteContentByIds(contentIds);
};

/**
 * Removes all content records from the collection.
 *
 * Intended for test teardown and full study resets — use with care in
 * production.
 *
 * @returns A {@link CoreResult} with `successes: [null]` on success.
 */
const deleteAll = async (): Promise<CoreResult<null>> => {
  _checkInit();
  return clearAllContent();
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const ContentManager = {
  init,
  shutdown,

  // create
  createContent,
  createContents,

  // read
  getContent,
  getContentBySlug,
  getContentByType: getByType,
  getAllContent: getAll,

  // update
  updateContent,

  // delete
  deleteContent,
  deleteContents,
  deleteAllContent: deleteAll,
};

export { ContentManager };
