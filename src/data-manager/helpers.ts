import { createLogger } from '../logger';
import { JustinError, JustinErrorCode } from '../errors';

const Log = createLogger({
  context: {
    source: 'data-manager-helpers',
  },
});

/**
 * Ensures every error is logged exactly once at its origin and propagates
 * as a {@link JustinError} with full context accumulated across layers.
 *
 * Two paths:
 * - If the caught error is already a logged {@link JustinError}, the provided
 *   data is merged into `err.data` and the error is rethrown silently.
 * - Otherwise, logs once via {@link Log.error}, wraps in a new {@link JustinError}
 *   with `isLogged: true`, and throws.
 *
 * @param message - Human-readable description of what failed and where.
 * @param funcName - Name of the calling function for log context.
 * @param code - {@link JustinErrorCode} or any downstream extension code.
 *   Defaults to `DB_ERROR` for adapter-level failures.
 * @param data - Optional structured context to attach at this layer.
 * @param error - The original caught error.
 * @throws {JustinError} Always throws.
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

  if (error instanceof JustinError && error.isLogged) {
    error.data = { ...error.data, ...errorData };
    throw error;
  }

  Log.error(message, errorData);

  throw new JustinError(message, code, {
    name: 'JustInCoreError',
    isLogged: true,
    data: errorData,
  });
};

/**
 * Throws a {@link JustinError} with `code: NOT_INITIALIZED` if the provided
 * flag indicates the manager has not been initialized.
 *
 * @param isInitialized - Result of `dm.getInitializationStatus()`.
 * @param label - Caller label used in the errors message for context.
 * @throws {JustinError} If `isInitialized` is false.
 */
const checkInitialized = (isInitialized: boolean, label: string): void => {
  if (!isInitialized) {
    handleError(`${label} has not been initialized`, 'checkInitialized', {
      code: JustinErrorCode.NOT_INITIALIZED,
    });
  }
};

export { handleError, checkInitialized };
