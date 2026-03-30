import { JustInError, JustinErrorCode } from '../errors';
import { createLogger } from '../logger';

const Log = createLogger({ context: { source: 'error-helpers' } });

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

export { handleError, checkInitialized };
