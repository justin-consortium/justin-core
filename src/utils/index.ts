import { JustInError, JustinErrorCode } from '../errors';
import { CoreResult, FailureEntry } from '../types';
import { createLogger } from '../logger';

const Log = createLogger({ context: { source: 'core-result' } });

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

/**
 * Builds a successful {@link CoreResult}.
 *
 * @param successes - Items that were successfully processed.
 */
const coreSuccess = <T>(successes: T[]): CoreResult<T> => ({
  ok: true,
  successes,
});

/**
 * Builds a failed {@link CoreResult}.
 *
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
 * @param label - Calling function name, included in the log for traceability.
 * @param code - {@link JustinErrorCode} value — used as the log message.
 * @param reason - Human-readable description included in the log and envelope.
 * @param identity - Optional `id` / `uniqueIdentifier` for the failed record.
 * @param details - Optional operation-specific context.
 *
 * @example
 * ```ts
 * return coreFailureResult(
 *   'updateUserById',
 *   JustinErrorCode.NOT_FOUND,
 *   `user (${userId}) not found`,
 *   { id: userId },
 * );
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
  const reason =
    error instanceof JustInError ? error.message : String((error as any)?.message ?? error);

  return {
    ...identity,
    code,
    reason,
    ...(details ? { details } : {}),
  };
};

/**
 * Unwraps a {@link CoreResult} from a DataManager write operation, enriching
 * any failure with the calling function label and optional identity context.
 *
 * If the result failed, logs once via {@link coreFailureResult} and returns a
 * new failure envelope — callers can branch on `.ok` without re-wrapping.
 * If the result succeeded, passes it through unchanged.
 *
 * @param result - The {@link CoreResult} to unwrap.
 * @param label - Calling function name for log traceability.
 * @param identity - Optional identity fields to attach to the failure.
 * @param details - Optional operation-specific context.
 *
 * @example
 * ```ts
 * const result = unwrapSuccess(
 *   await dm.updateItemByIdInCollection(USERS, userId, data),
 *   'updateUserById',
 *   { id: userId },
 * );
 * if (!result.ok) return result;
 * const updated = result.successes[0] as JUser;
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
 * Eliminates the repeated local closure pattern that would otherwise be
 * redeclared inside every bulk loop.
 *
 * @param label - Calling function name for log traceability.
 * @param identity - Base identity fields shared by all failures in this loop.
 *
 * @example
 * ```ts
 * const allFailures: FailureEntry[] = [];
 * for (const record of records) {
 *   const uid = record.uniqueIdentifier ?? '(unknown)';
 *   const collector = makeLoopFailureCollector<JUser>('createUserRecords', { uniqueIdentifier: uid });
 *
 *   if (!isPlainObject(record)) {
 *     collector.push(JustinErrorCode.VALIDATION_ERROR, 'record must be a plain object');
 *     allFailures.push(...collector.failures);
 *     continue;
 *   }
 * }
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

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Ensures every error is logged exactly once at its origin and propagates
 * as a {@link JustInError} with full context accumulated across layers.
 *
 * - If the caught error is already a logged {@link JustInError}, the provided
 *   data is merged into `err.data` and the error is rethrown silently.
 * - Otherwise, logs once via `Log.error`, wraps in a new {@link JustInError}
 *   with `isLogged: true`, and throws.
 *
 * @param message - Human-readable description of what failed and where.
 * @param funcName - Name of the calling function for log context.
 * @param options.code - {@link JustinErrorCode} value. Defaults to `DB_ERROR`.
 * @param options.data - Optional structured context to attach at this layer.
 * @param options.error - The original caught error.
 * @throws {JustInError} Always throws.
 */
const handleError = (
  message: string,
  funcName: string,
  options: {
    code?: string;
    data?: Record<string, any>;
    error?: unknown;
  } = {},
): never => {
  const { code = JustinErrorCode.DB_ERROR, data = {}, error } = options;
  const errorData: Record<string, any> = {
    function: funcName,
    ...data,
    ...(error !== undefined ? { cause: error } : {}),
  };

  if (error instanceof JustInError && error.isLogged) {
    error.data = { ...error.data, ...errorData };
    throw error;
  }

  Log.error(message, errorData);

  throw new JustInError(message, code, {
    name: 'JustInCoreError',
    isLogged: true,
    data: errorData,
  });
};

/**
 * Throws a {@link JustInError} with `code: NOT_INITIALIZED` if the provided
 * flag indicates the manager has not been initialized.
 *
 * Does not log — this is a usage error (caller did not call init), not a
 * runtime failure.
 *
 * @param isInitialized - Result of a manager's initialization check.
 * @param label - Manager name used in the error message.
 * @throws {JustInError} If `isInitialized` is `false`.
 */
const checkInitialized = (isInitialized: boolean, label: string): void => {
  if (!isInitialized) {
    handleError(`${label} has not been initialized`, 'checkInitialized', {
      code: JustinErrorCode.NOT_INITIALIZED,
    });
  }
};

export {
  coreSuccess,
  coreFailure,
  coreFailureResult,
  failureEntryFromError,
  unwrapSuccess,
  makeLoopFailureCollector,
  handleError,
  checkInitialized,
};
