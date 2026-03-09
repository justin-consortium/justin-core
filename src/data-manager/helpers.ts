import { createLogger } from '../logger';

const Log = createLogger({
  context: {
    source: 'data-manager-helpers',
  },
});

/**
 * Logs and throws a database-related error.
 *
 * @param message - A custom error message describing the context of the error.
 * @param funcName - Name of the calling function the error occurred in.
 * @param error - The error to log and throw; wrapped in a new Error if not already an instance.
 * @throws {Error} Always throws.
 */
const handleDbError = (message: string, funcName: string, error?: unknown): never => {
  Log.error(message, { function: funcName, error });
  throw error instanceof Error ? error : new Error(message);
};

/**
 * Throws if the provided DataManager instance has not been initialized.
 *
 * Centralizes the initialization guard that was previously duplicated across
 * user-crud, protected-attributes-crud, and cache modules.
 *
 * @param isInitialized - Result of `dm.getInitializationStatus()`.
 * @param label - Caller label used in the error message for context.
 * @throws {Error} If `isInitialized` is false.
 */
const checkInitialized = (isInitialized: boolean, label: string): void => {
  if (!isInitialized) {
    throw new Error(`${label} has not been initialized`);
  }
};

export { handleDbError, checkInitialized };
