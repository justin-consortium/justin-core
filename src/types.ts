import { JustinError } from './errors';

/**
 * Standard result envelope for a single database operation.
 *
 * Returned by every write operation on {@link DataManager} and
 * {@link UserManager}. Read operations that return collections
 * (e.g. `getAllInCollection`) return the array directly — use
 * {@link BulkResult} for bulk writes where partial success is possible.
 *
 * @typeParam T - The type of the data payload on success.
 *
 * @example
 * ```ts
 * const result = await dm.addItemToCollection<MyRecord>(COLLECTION, item);
 *
 * if (result.status === 'failure') {
 *   console.error(result.error?.message);
 *   return;
 * }
 *
 * console.log(result.data); // MyRecord & { id: string }
 * console.log(result.count); // 1
 * ```
 */
export type DbResult<T = unknown> = {
  /**
   * Outcome of the operation.
   *
   * - `'success'`  — the operation completed successfully.
   * - `'failure'`  — the operation failed; inspect `error` for details.
   */
  status: 'success' | 'failure';

  /**
   * The resulting data on success, or `null` on failure or not-found.
   */
  data: T | null;

  /**
   * Number of documents affected.
   *
   * - `1` on a successful single write.
   * - `0` on failure or not-found.
   *
   * Not present on read operations that return collections.
   */
  count: number;

  /**
   * The error that caused the failure.
   *
   * Only present when `status === 'failure'`. Always a {@link JustinError}
   * so callers can branch on `error.code`.
   */
  error?: JustinError;
};

/**
 * Standard result envelope for a bulk database operation.
 *
 * Returned by all bulk write operations on {@link DataManager} and
 * {@link UserManager}. Captures per-item success and failure detail
 * so callers can act on partial results without re-querying.
 *
 * @typeParam T - The type of each successfully processed item.
 *
 * @example
 * ```ts
 * const result = await dm.addItemsToCollection<MyRecord>(COLLECTION, items);
 *
 * if (result.status === 'failure') {
 *   // total failure — nothing was written
 *   console.error(result.error?.message);
 *   return;
 * }
 *
 * console.log(result.count.succeeded); // number written
 * console.log(result.count.failed);    // number not written
 *
 * for (const { item, code, reason } of result.data.failed) {
 *   console.warn(`Failed to insert ${item.id}: [${code}] ${reason}`);
 * }
 * ```
 */
export type BulkResult<T = unknown> = {
  /**
   * Outcome of the bulk operation.
   *
   * - `'success'`         — all items processed successfully.
   * - `'partial_success'` — some items succeeded, some failed; inspect
   *                         `data.failed` for per-item detail.
   * - `'failure'`         — total failure; nothing was written.
   *                         Inspect `error` for the root cause.
   */
  status: 'success' | 'partial_success' | 'failure';

  /**
   * Per-item success and failure detail.
   *
   * On total `'failure'`, both arrays will be empty — use `error` instead.
   */
  data: {
    /**
     * Items that were successfully processed, with their assigned `id`.
     */
    succeeded: T[];

    /**
     * Items that failed, with the original item and failure detail.
     *
     * `code` maps to a {@link JustinErrorCode} value so callers can branch
     * programmatically. `reason` is a human-readable description suitable
     * for logging.
     */
    failed: Array<{
      item: T;
      code: string;
      reason: string;
    }>;
  };

  /**
   * Counts summarizing the operation outcome.
   */
  count: {
    /** Total number of items submitted. */
    requested: number;
    /** Number of items successfully processed. */
    succeeded: number;
    /** Number of items that failed. */
    failed: number;
  };

  /**
   * The error that caused a total failure.
   *
   * Only present when `status === 'failure'`. Not set on `'partial_success'`
   * — per-item failure detail is in `data.failed` instead.
   */
  error?: JustinError;
};
