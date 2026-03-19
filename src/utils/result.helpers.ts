import { JustInError, JustinErrorCode } from '../errors';
import { CoreResult, FailureEntry } from '../types';
import { createLogger } from '../logger';

const Log = createLogger({ context: { source: 'core-result' } });

/**
 * Builds a successful {@link CoreResult}.
 *
 * @typeParam T - The type of each successfully processed item.
 * @param successes - Items that were successfully processed.
 */
const coreSuccess = <T>(successes: T[]): CoreResult<T> => ({
  ok: true,
  successes,
});

/**
 * Builds a failed {@link CoreResult}.
 *
 * @typeParam T - The expected success item type.
 * @param failures - Structured failure entries.
 * @param successes - Any partial successes (defaults to empty).
 */
const coreFailure = <T>(failures: FailureEntry[], successes: T[] = []): CoreResult<T> => ({
  ok: false,
  successes,
  failures,
});

/**
 * Logs a warning and builds a failed {@link CoreResult} with a single
 * {@link FailureEntry}.
 *
 * Centralises the log + envelope construction that would otherwise be
 * duplicated at every failure site. The `code` is used as the log message
 * so log entries are immediately scannable by error type.
 *
 * @typeParam T - The expected success item type.
 * @param label  - Calling function name, included in the log for traceability.
 * @param code   - {@link JustinErrorCode} value — used as the log message.
 * @param reason - Human-readable description included in the log and envelope.
 * @param identity - Optional `id` / `uniqueIdentifier` for the failed record.
 * @param details  - Optional operation-specific context (e.g. `{ namespace, keyPath }`).
 *
 * @example
 * ```ts
 * return coreFailureResult('updateUserById', JustinErrorCode.NOT_FOUND, `user (${userId}) not found`, { id: userId });
 * // logs: WARN NOT_FOUND { label: 'updateUserById', reason: 'user (abc) not found', id: 'abc' }
 * // returns: { ok: false, successes: [], failures: [{ id: 'abc', code: 'NOT_FOUND', reason: '...' }] }
 * ```
 */
const coreFailureResult = <T>(
  label: string,
  code: string,
  reason: string,
  identity: { id?: string; uniqueIdentifier?: string } = {},
  details?: Record<string, any>,
): CoreResult<T> => {
  Log.warn(code, { label, reason, ...identity, ...(details ? { details } : {}) });
  return coreFailure([{ ...identity, code, reason, ...(details ? { details } : {}) }]);
};

/**
 * Builds a {@link FailureEntry} from a caught error.
 *
 * Extracts `code` and `reason` from a {@link JustInError} when available,
 * falling back to `DB_ERROR` and the raw message otherwise.
 *
 * @param error - The caught error.
 * @param identity - Optional identity fields (`id`, `uniqueIdentifier`).
 * @param details - Optional operation-specific context.
 */
const failureEntryFromError = (
  error: unknown,
  identity: { id?: string; uniqueIdentifier?: string } = {},
  details?: Record<string, any>,
): FailureEntry => {
  const code = error instanceof JustInError ? error.code : JustinErrorCode.DB_ERROR;
  const reason = error instanceof JustInError
    ? error.message
    : String((error as any)?.message ?? error);

  return {
    ...identity,
    code,
    reason,
    ...(details ? { details } : {}),
  };
};

/**
 * Unwraps a {@link CoreResult} from a DataManager write operation.
 *
 * If the result failed, enriches the failure with the calling function label
 * and optional identity / details context, then returns a new `CoreResult`
 * failure — logging once via {@link coreFailureResult}.
 *
 * If the result succeeded, passes it through unchanged so the caller can
 * access `result.successes[0]` directly.
 *
 * This eliminates the repeated boilerplate of extracting
 * `failures[0]?.code ?? DB_ERROR` / `failures[0]?.reason ?? fallback`
 * at every DataManager call site.
 *
 * @typeParam T - The success item type.
 * @param result   - The {@link CoreResult} returned by a DataManager operation.
 * @param label    - Calling function name for log traceability.
 * @param identity - Optional identity fields to attach to the failure entry.
 * @param details  - Optional operation-specific context.
 *
 * @example
 * ```ts
 * const result = unwrapSuccess(
 *   await dm.updateItemByIdInCollection(USERS, userId, data),
 *   'updateUserById',
 *   { id: userId },
 * );
 * if (!result.ok) return result;
 * const updatedUser = result.successes[0] as JUser;
 * ```
 */
const unwrapSuccess = <T, U>(
  result: CoreResult<T>,
  label: string,
  identity: { id?: string; uniqueIdentifier?: string } = {},
  details?: Record<string, any>,
): CoreResult<U> => {
  if (!result.ok) {
    return coreFailureResult<U>(
      label,
      result.failures[0]?.code ?? JustinErrorCode.DB_ERROR,
      result.failures[0]?.reason ?? 'operation failed',
      identity,
      details,
    );
  }
  return result as unknown as CoreResult<U>;
};

/**
 * Creates a failure collector for use inside bulk operation loops.
 *
 * Returns an object with a `push` method that logs and accumulates
 * {@link FailureEntry} objects, plus `failures` and `hasFailures` accessors.
 * Eliminates the repeated local `pushFailure`/`skipPath` closure pattern
 * that would otherwise be redeclared inside every bulk loop.
 *
 * The `identity` passed to the factory is the per-call base identity
 * (e.g. `{ uniqueIdentifier }` for the outer record). Each `push` call
 * can add operation-specific `details` (e.g. `{ namespace, keyPath }`).
 *
 * @typeParam T - The success item type of the surrounding operation.
 * @param label    - Calling function name for log traceability.
 * @param identity - Base identity fields shared by all failures in this loop.
 *
 * @example
 * ```ts
 * const collector = makeLoopFailureCollector<JUser>('createUserRecords', { uniqueIdentifier });
 *
 * if (!isPlainObject(record)) {
 *   collector.push(JustinErrorCode.VALIDATION_ERROR, 'record must be a plain object');
 *   continue;
 * }
 *
 * // at end of loop:
 * return collector.hasFailures
 *   ? coreFailure(collector.failures, successes)
 *   : coreSuccess(successes);
 * ```
 */
const makeLoopFailureCollector = <T>(
  label: string,
  identity: { id?: string; uniqueIdentifier?: string } = {},
) => {
  const _failures: FailureEntry[] = [];

  return {
    push(code: string, reason: string, details?: Record<string, any>): void {
      const result = coreFailureResult<T>(label, code, reason, identity, details);
      if (!result.ok) _failures.push(...result.failures);
    },
    get failures(): FailureEntry[] {
      return _failures;
    },
    get hasFailures(): boolean {
      return _failures.length > 0;
    },
  };
};


export { coreSuccess, coreFailure, coreFailureResult, failureEntryFromError, unwrapSuccess, makeLoopFailureCollector };
