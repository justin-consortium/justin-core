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
 * Register a logger used only for a given scope.
 *
 * If no scoped logger is registered for `scope`, {@link scopedLog} falls back to the global logger.
 *
 * @param scope - Non-empty scope name (e.g., `"core"`, `"events"`).
 * @param logger - Logger to route scoped messages to.
 *
 * @example
 * setLoggerFor('events', fileLogger);
 */
export function setLoggerFor(scope: string, logger: Logger): void {
  if (!scope || typeof scope !== 'string') {
    throw new Error('setLoggerFor: scope must be a non-empty string');
  }
  _scopedLoggers.set(scope, logger);
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
 * Returns a logger that:
 *  - prefixes messages with `[SCOPE]` or `[SCOPE][global]` when no scoped logger is registered
 *  - respects {@link logLevels} gates
 *  - routes to a scope-specific logger if set via `setLoggerFor(scope, ...)`,
 *    otherwise falls back to the current global logger
 *
 * The scoped binding is dynamic: if you register/unregister a scoped logger later,
 * existing scoped loggers will pick it up on the next call.
 *
 * @param scope - Scope label (e.g. "events", "core").
 */
export const scopedLog = (scope: string): Logger => {
  const SCOPE = scope.toUpperCase();
  const pick = () => getLoggerFor(scope) ?? activeLogger;
  const tag = () => (getLoggerFor(scope) ? `[${SCOPE}]` : `[${SCOPE}][GLOBAL]`);

  return {
    info: (message: string, ...optionalParams: any[]) => {
      if (!logLevels.info) return;
      pick().info?.(`${tag()} ${message}`, ...optionalParams);
    },
    warn: (message: string, ...optionalParams: any[]) => {
      if (!logLevels.warn) return;
      pick().warn?.(`${tag()} ${message}`, ...optionalParams);
    },
    error: (message: string, ...optionalParams: any[]) => {
      if (!logLevels.error) return;
      pick().error?.(`${tag()} ${message}`, ...optionalParams);
    },
    dev: (message: string, ...optionalParams: any[]) => {
      if (!logLevels.dev) return;
      pick().dev?.(`${tag()} ${message}`, ...optionalParams);
    },
  } as Logger;
};

