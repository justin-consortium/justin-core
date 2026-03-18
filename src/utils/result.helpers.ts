import { JustinError, JustinErrorCode } from '../errors';
import { DbResult, BulkResult } from '../types';

/**
 * Builds a successful {@link DbResult} envelope for a single operation.
 *
 * @typeParam T - The type of the data payload.
 * @param data - The result data. Pass `null` for operations that do not
 *   return a document (e.g. delete).
 * @param count - Number of documents affected. Defaults to `1` for writes,
 *   pass `0` explicitly for not-found cases.
 * @returns A `DbResult` with `status: 'success'`.
 *
 * @example
 * ```ts
 * return successResult(updatedUser);        // count defaults to 1
 * return successResult(null, deletedCount); // explicit count for deletes
 * ```
 */
const successResult = <T>(data: T, count = 1): DbResult<T> => ({
  status: 'success',
  data,
  count,
});

/**
 * Builds a failure {@link DbResult} envelope from a caught error.
 *
 * If the caught value is already a {@link JustinError} (logged at origin),
 * it is placed directly into `result.error`. Otherwise it is wrapped in a
 * new `JustinError` so callers always receive a consistent error shape.
 *
 * @typeParam T - The expected data type (will be `null` on failure).
 * @param error - The caught error.
 * @returns A `DbResult` with `status: 'failure'`, `data: null`, `count: 0`.
 *
 * @example
 * ```ts
 * try {
 *   // ...\
 * } catch (error) {
 *   return failureResult(error);
 * }
 * ```
 */
const failureResult = <T>(error: unknown): DbResult<T> => {
  const justinError =
    error instanceof JustinError
      ? error
      : new JustinError(
        String((error as any)?.message ?? error),
        JustinErrorCode.DB_ERROR,
        { name: 'JustInCoreError', isLogged: true },
      );

  return { status: 'failure', data: null, count: 0, error: justinError };
};

/**
 * Builds a success or partial-success {@link BulkResult} envelope.
 *
 * Status is determined automatically:
 * - `'success'` if `failed` is empty.
 * - `'partial_success'` if both `succeeded` and `failed` are non-empty.
 * - `'failure'` is NOT produced by this builder — use {@link bulkFailureResult}
 *   for total failures.
 *
 * @typeParam T - The type of each successfully processed item.
 * @param succeeded - Items that were successfully processed.
 * @param failed - Items that failed with per-item failure detail.
 * @param requested - Total number of items originally submitted.
 * @returns A `BulkResult` with `status: 'success'` or `'partial_success'`.
 *
 * @example
 * ```ts
 * return bulkSuccessResult(insertedUsers, failedItems, items.length);
 * ```
 */
const bulkSuccessResult = <T>(
  succeeded: T[],
  failed: Array<{ item: T; code: string; reason: string }>,
  requested: number,
): BulkResult<T> => ({
  status: failed.length === 0 ? 'success' : 'partial_success',
  data: { succeeded, failed },
  count: { requested, succeeded: succeeded.length, failed: failed.length },
});

/**
 * Builds a total-failure {@link BulkResult} envelope.
 *
 * Used when a bulk operation fails entirely before any items are processed —
 * for example, a connection failure or an unrecoverable adapter error.
 * Per-item arrays will be empty; use `result.error` for the root cause.
 *
 * If the caught value is already a {@link JustinError} (logged at origin),
 * it is placed directly into `result.error`. Otherwise it is wrapped in a
 * new `JustinError` so callers always receive a consistent error shape.
 *
 * @typeParam T - The expected item type (arrays will be empty on total failure).
 * @param error - The caught error.
 * @param requested - Total number of items originally submitted.
 * @returns A `BulkResult` with `status: 'failure'`, empty arrays, and `error`.
 *
 * @example
 * ```ts
 * try {
 *   // bulk operation
 * } catch (error) {
 *   return bulkFailureResult(error, items.length);
 * }
 * ```
 */
const bulkFailureResult = <T>(error: unknown, requested: number): BulkResult<T> => {
  const justinError =
    error instanceof JustinError
      ? error
      : new JustinError(
        String((error as any)?.message ?? error),
        JustinErrorCode.DB_ERROR,
        { name: 'JustInCoreError', isLogged: true },
      );

  return {
    status: 'failure',
    data: { succeeded: [], failed: [] },
    count: { requested, succeeded: 0, failed: requested },
    error: justinError,
  };
};

export { successResult, failureResult, bulkSuccessResult, bulkFailureResult };
