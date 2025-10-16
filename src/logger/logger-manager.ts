import { Logger } from './logger.interface';
import { ConsoleLogger } from './console.logger';

/** Default logger instance (global fallback). */
let activeLogger: Logger = ConsoleLogger;

/**
 * Global log level gates.
 * Each method in {@link Log} and {@link scopedLog} checks these before writing.
 */
export const logLevels = {
  info: true,
  warn: true,
  error: true,
  dev: true,
};

/**
 * Replace the global logger with a custom implementation.
 *
 * Any missing methods on `logger` fall back to {@link ConsoleLogger}.
 *
 * @param logger - Partial logger implementation to install globally.
 *
 * @example
 * setLogger({
 *   info: (...a) => mySink.info(...a),
 *   error: (...a) => mySink.error(...a),
 * });
 */
export function setLogger(logger: Partial<Logger>): void {
  activeLogger = {
    info: logger.info || ConsoleLogger.info,
    warn: logger.warn || ConsoleLogger.warn,
    error: logger.error || ConsoleLogger.error,
    dev: logger.dev || ConsoleLogger.dev,
  };
}

/**
 * Enable/disable specific log levels.
 *
 * Methods in {@link Log} and {@link scopedLog} short-circuit based on these flags.
 *
 * @param levels - Partial set of log level booleans to merge into {@link logLevels}.
 *
 * @example
 * // Only errors + dev logs
 * setLogLevels({ info: false, warn: false, error: true, dev: true });
 */
export function setLogLevels(levels: Partial<typeof logLevels>): void {
  Object.assign(logLevels, levels);
}

/**
 * Global logging facade.
 *
 * Each method:
 * - checks {@link logLevels}
 * - delegates to the current global logger ({@link activeLogger})
 */
export const Log = {
  /**
   * Log an informational message when `logLevels.info` is enabled.
   *
   * @param message - Message text.
   * @param optionalParams - Additional payloads to pass to the logger.
   */
  info(message: string, ...optionalParams: any[]): void {
    if (logLevels.info) activeLogger.info?.(message, ...optionalParams);
  },

  /**
   * Log a warning when `logLevels.warn` is enabled.
   *
   * @param message - Message text.
   * @param optionalParams - Additional payloads to pass to the logger.
   */
  warn(message: string, ...optionalParams: any[]): void {
    if (logLevels.warn) activeLogger.warn?.(message, ...optionalParams);
  },

  /**
   * Log an error when `logLevels.error` is enabled.
   *
   * @param message - Message text.
   * @param optionalParams - Additional payloads to pass to the logger.
   */
  error(message: string, ...optionalParams: any[]): void {
    if (logLevels.error) activeLogger.error?.(message, ...optionalParams);
  },

  /**
   * Log a dev/debug message when `logLevels.dev` is enabled.
   *
   * @param message - Message text.
   * @param optionalParams - Additional payloads to pass to the logger.
   */
  dev(message: string, ...optionalParams: any[]): void {
    if (logLevels.dev) activeLogger.dev?.(message, ...optionalParams);
  },
};

/* ------------------------------------------------------------------ */
/* Scoped loggers (optional per-scope overrides)                      */
/* ------------------------------------------------------------------ */

/** Registry of per-scope loggers. Falls back to the global logger when unset. */
const _scopedLoggers = new Map<string, Logger>();

/**
 * Register (or update) a logger for a given scope.
 *
 * - If `logger` is omitted, the scope inherits a **snapshot** of the current global logger.
 * - If `logger` is partial, any missing methods are filled from the current global logger.
 * - Future calls to {@link setLogger} do **not** retroactively change already-registered scoped loggers.
 *
 * @param scope - Non-empty scope name (e.g., `"core"`, `"events"`).
 * @param logger - Optional partial logger; overrides corresponding global methods.
 *
 * @example
 * // Inherit global (snapshot at registration time)
 * setLoggerFor('events');
 *
 * // Override only info; others come from global at registration time
 * setLoggerFor('events', { info: (...a) => fileSink.info(...a) });
 */
export function setLoggerFor(scope: string): void;
export function setLoggerFor(scope: string, logger: Partial<Logger>): void;
export function setLoggerFor(scope: string, logger?: Partial<Logger>): void {
  if (!scope || typeof scope !== 'string') {
    throw new Error('setLoggerFor: scope must be a non-empty string');
  }

  // Merge over the *current* global logger (snapshot semantics).
  const merged: Logger = {
    info: logger?.info ?? activeLogger.info,
    warn: logger?.warn ?? activeLogger.warn,
    error: logger?.error ?? activeLogger.error,
    dev: logger?.dev ?? activeLogger.dev,
  };

  _scopedLoggers.set(scope, merged);
}

/**
 * Retrieve the logger registered for `scope`, if any.
 *
 * @param scope - Scope name.
 * @returns The scoped logger or `undefined` if none is registered.
 */
export function getLoggerFor(scope: string): Logger | undefined {
  return _scopedLoggers.get(scope);
}

/**
 * Unregister the logger for `scope` so that {@link scopedLog} falls back to the global logger.
 *
 * @param scope - Scope name.
 */
export function clearLoggerFor(scope: string): void {
  _scopedLoggers.delete(scope);
}

/**
 * Create a scoped logger that:
 *  - prefixes messages with `[SCOPE]` when a scoped logger exists,
 *    or `[SCOPE][GLOBAL]` when falling back to the global logger
 *  - checks {@link logLevels} before writing
 *  - routes to the scope-specific logger if registered via {@link setLoggerFor},
 *    otherwise uses the current global logger
 *
 * The binding is dynamic at call time: if you later register/unregister a scoped logger,
 * existing scoped logger instances pick it up on the next call.
 *
 * @param scope - Scope label (e.g. `"events"`, `"core"`).
 * @returns A {@link Logger} with the rules above.
 *
 * @example
 * const log = scopedLog('events');
 * log.info('engine started'); // "[EVENTS] engine started" if scoped logger exists, else "[EVENTS][GLOBAL] ..."
 */
export const scopedLog = (scope: string): Logger => {
  const SCOPE = String(scope || 'unknown').toUpperCase();

  return {
    info: (message: string, ...optionalParams: any[]) => {
      if (!logLevels.info) return;
      const scoped = getLoggerFor(scope);
      const target = scoped ?? activeLogger;
      const prefix = scoped ? `[${SCOPE}]` : `[${SCOPE}][GLOBAL]`;
      target.info?.(`${prefix} ${message}`, ...optionalParams);
    },
    warn: (message: string, ...optionalParams: any[]) => {
      if (!logLevels.warn) return;
      const scoped = getLoggerFor(scope);
      const target = scoped ?? activeLogger;
      const prefix = scoped ? `[${SCOPE}]` : `[${SCOPE}][GLOBAL]`;
      target.warn?.(`${prefix} ${message}`, ...optionalParams);
    },
    error: (message: string, ...optionalParams: any[]) => {
      if (!logLevels.error) return;
      const scoped = getLoggerFor(scope);
      const target = scoped ?? activeLogger;
      const prefix = scoped ? `[${SCOPE}]` : `[${SCOPE}][GLOBAL]`;
      target.error?.(`${prefix} ${message}`, ...optionalParams);
    },
    dev: (message: string, ...optionalParams: any[]) => {
      if (!logLevels.dev) return;
      const scoped = getLoggerFor(scope);
      const target = scoped ?? activeLogger;
      const prefix = scoped ? `[${SCOPE}]` : `[${SCOPE}][GLOBAL]`;
      target.dev?.(`${prefix} ${message}`, ...optionalParams);
    },
  } as Logger;
};
