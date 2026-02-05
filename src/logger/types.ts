/**
 * Built-in severities supported out of the box.
 */
export type BaseSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

/**
 * Represents a single structured log entry emitted by the logging system.
 *
 * A `LoggerEntry` consists of:
 * - a severity level indicating importance,
 * - a human-readable message describing what occurred,
 * - optional structured fields providing event-specific details.
 *
 * This interface is intentionally minimal and transport-agnostic so that
 * log entries can be rendered to the console, serialized to JSON, or sent
 * to external logging systems without loss of meaning.
 */
export interface LoggerEntry<T extends string = BaseSeverity> {
  /**
   * Severity level of the log entry.
   *
   * Used to classify the importance or urgency of the event (e.g. DEBUG, INFO,
   * WARN, ERROR). Severity is typically used for filtering, alerting, and
   * routing logs in production environments.
   */
  severity: T;

  /**
   * Human-readable description of the event being logged.
   *
   * The message should describe *what happened* in a concise, stable way.
   * Avoid embedding variable data directly in the message string; prefer
   * structured metadata via {@link fields} for values that may change or
   * need to be queried.
   */
  message: string;

  /**
   * Optional structured metadata for this log entry.
   *
   * Use `fields` to attach small, event-specific, and log-safe data that
   * helps explain *this particular log event*.
   *
   * Prefer `fields` over string interpolation when including identifiers
   * or values that may be useful for filtering or querying logs.
   *
   * Prefer structured fields instead:
   * ```ts
   * Log.debug("No results for handler", {
   *   handlerName,
   * });
   * ```
   *
   * Typical uses:
   * - identifiers (handlerName, userId, collectionName)
   * - counts or sizes (requested, returned)
   * - timing information (durationMs)
   *
   * Do NOT use `fields` for:
   * - request-wide or module-wide context (use logger context instead)
   * - large objects or raw payloads
   * - sensitive or personally identifiable information
   */
  fields?: Record<string, unknown>;
}

/**
 * Function signature for emitters (console, remote, etc.).
 *
 * @typeParam T - Severity union used by this emitter.
 * @param entry - The structured log entry to emit.
 * @param mergedContext - The merged global + instance context.
 */
export type EmitFn<T extends string = BaseSeverity> = (
  entry: LoggerEntry<T>,
  mergedContext: Record<string, unknown>,
) => void;

/**
 * Function signature for log callbacks (fire-and-forget).
 *
 * @typeParam T - Severity union used by this callback.
 * @param entry - The structured log entry that was just emitted.
 */
export type LoggerCallback<T extends string = BaseSeverity> = (entry: LoggerEntry<T>) => void;

/**
 * Options for creating a logger instance.
 *
 * @typeParam T - Severity union for this logger.
 */
export interface CreateLoggerOptions<T extends string = BaseSeverity> {
  /**
   * Per-logger (instance-level) context merged into every log entry.
   */
  context?: Record<string, unknown>;
  /**
   * Minimum level for THIS logger (overrides global).
   * Can be a severity string or numeric rank.
   */
  emitLevel?: T | number;
  /**
   * Per-logger emit override (overrides global emit).
   */
  emitFn?: EmitFn<T>;
  /**
   * Per-logger callback override (overrides global callback).
   */
  cb?: LoggerCallback<T>;
}

/**
 * Public-facing logger shape returned by {@link createLogger}.
 * 3rd-party devs should rely on this surface.
 *
 * @typeParam T - Severity union for this logger.
 */
export interface Logger<T extends string = BaseSeverity> {
  /**
   * Emit a log entry with an explicit severity.
   *
   * @param severity - The severity to log at (case-insensitive).
   * @param message - Human-readable log message.
   * @param extras - Optional structured data to be normalized into fields.
   */
  emit(severity: T, message: string, extras?: unknown): void;

  /**
   * Emit a DEBUG-level log.
   *
   * @param message - Human-readable log message.
   * @param extras - Optional structured data to be normalized into fields.
   */
  debug(message: string, extras?: unknown): void;

  /**
   * Emit an INFO-level log.
   *
   * @param message - Human-readable log message.
   * @param extras - Optional structured data to be normalized into fields.
   */
  info(message: string, extras?: unknown): void;

  /**
   * Emit a WARNING-level log.
   *
   * @param message - Human-readable log message.
   * @param extras - Optional structured data to be normalized into fields.
   */
  warn(message: string, extras?: unknown): void;

  /**
   * Emit an ERROR-level log.
   *
   * @param message - Human-readable log message.
   * @param extras - Optional structured data to be normalized into fields.
   */
  error(message: string, extras?: unknown): void;

  /**
   * Change this logger's minimum level at runtime.
   *
   * @param level - Severity name or numeric rank.
   */
  setLevel(level: T | number): void;

  /**
   * Merge additional instance-level context that will be included
   * on every subsequent log entry from this logger.
   *
   * @param next - Context values to merge.
   */
  setContext(next: Record<string, unknown>): void;

  /**
   * Override this logger's emit function.
   *
   * @param next - New emit function.
   */
  setEmitFn(next: EmitFn<T>): void;

  /**
   * Override this logger's callback.
   *
   * @param next - New callback, or undefined to clear.
   */
  setCallback(next?: LoggerCallback<T>): void;
}

/**
 * Configuration object accepted by {@link configureGlobalLoggerSettings}.
 */
export interface GlobalLoggerConfig {
  /**
   * Global minimum severity level.
   */
  level?: string;
  /**
   * Global context to be merged into every log entry.
   */
  context?: Record<string, unknown>;
  /**
   * Global emit override.
   */
  emitFn?: EmitFn<any>;
  /**
   * Global callback override.
   */
  callback?: LoggerCallback<any>;
  /**
   * Global severity ranking, for custom severities.
   */
  severityRanking?: Record<string, number>;
}
