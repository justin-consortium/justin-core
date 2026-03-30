/**
 * Built-in severities supported out of the box.
 */
export type BaseSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

/**
 * A single structured log entry emitted by the logging system.
 *
 * Intentionally minimal and transport-agnostic — entries can be rendered
 * to the console, serialized to JSON, or forwarded to an external logging
 * system without loss of meaning. Structured context travels alongside
 * the entry as the second argument to {@link EmitFn}.
 */
export interface LoggerEntry<T extends string = BaseSeverity> {
  /**
   * Severity level of this entry. Used for filtering, alerting, and routing
   * in production environments.
   */
  severity: T;

  /**
   * Human-readable description of the event. Should describe *what happened*
   * in a concise, stable way — avoid embedding variable data here; put it in
   * the context object passed to {@link EmitFn} instead.
   */
  message: string;
}

/**
 * Replaces the default console output. The logger calls this synchronously
 * and does not await the result — async emitters are supported but run
 * fire-and-forget. Handle all errors inside your function.
 *
 * @example
 * ```ts
 * configureLogger({
 *   emitFn: async (entry, context) => {
 *     try {
 *       await myTransport.send({ ...entry, ...context });
 *     } catch (err) {
 *       console.error('transport failed', err);
 *     }
 *   },
 * });
 * ```
 */
export type EmitFn<T extends string = BaseSeverity> = (
  entry: LoggerEntry<T>,
  mergedContext: Record<string, unknown>,
) => void;

/**
 * Fires after the emitter runs. Useful for adding a second transport on top
 * of the existing console output. Synchronous throws are silently swallowed;
 * async functions run fire-and-forget — handle all errors inside your function.
 *
 * @example
 * ```ts
 * configureLogger({
 *   callback: async (entry) => {
 *     try {
 *       await db.insertLog(entry);
 *     } catch (err) {
 *       console.error('callback failed', err);
 *     }
 *   },
 * });
 * ```
 */
export type LoggerCallback<T extends string = BaseSeverity> = (entry: LoggerEntry<T>) => void;

/**
 * Options for creating a logger instance via {@link createLogger}.
 */
export interface CreateLoggerOptions<T extends string = BaseSeverity> {
  /** Per-instance context merged into every log entry from this logger. */
  context?: Record<string, unknown>;
  /**
   * Minimum severity for this instance — overrides the global level.
   * Accepts a severity name string (e.g. `'WARNING'`) or a numeric rank.
   * Intentionally `string | number` rather than `T | number` so that passing
   * a level string does not narrow the generic `T` and constrain `setLevel`.
   */
  emitLevel?: string | number;
  /** Per-instance emit override — overrides the global emit function. */
  emitFn?: EmitFn<T>;
  /** Per-instance callback override — overrides the global callback. */
  callback?: LoggerCallback<T>;
}

/**
 * Public logger surface returned by {@link createLogger}.
 */
export interface Logger<T extends string = BaseSeverity> {
  /**
   * Emit a log entry with an explicit severity.
   *
   * @param severity - Severity to log at (case-insensitive).
   * @param message - Human-readable log message.
   * @param extras - Optional structured data normalized into the context.
   */
  emit(severity: T, message: string, extras?: unknown): void;

  /**
   * Emit a DEBUG-level log.
   *
   * @param message - Human-readable log message.
   * @param extras - Optional structured data normalized into the context.
   */
  debug(message: string, extras?: unknown): void;

  /**
   * Emit an INFO-level log.
   *
   * @param message - Human-readable log message.
   * @param extras - Optional structured data normalized into the context.
   */
  info(message: string, extras?: unknown): void;

  /**
   * Emit a WARNING-level log.
   *
   * @param message - Human-readable log message.
   * @param extras - Optional structured data normalized into the context.
   */
  warn(message: string, extras?: unknown): void;

  /**
   * Emit an ERROR-level log.
   *
   * @param message - Human-readable log message.
   * @param extras - Optional structured data normalized into the context.
   */
  error(message: string, extras?: unknown): void;

  /**
   * Change this logger's minimum level at runtime.
   *
   * Accepts a severity name string (case-insensitive, e.g. `'warning'` or
   * `'WARNING'`) or a numeric rank. Intentionally `string | number` rather
   * than `T | number` so callers are never constrained by the inferred generic.
   *
   * @param level - Severity name or numeric rank.
   */
  setLevel(level: string | number): void;

  /**
   * Merge additional context that will be included on every subsequent
   * log entry from this logger instance.
   *
   * @param next - Context values to merge in.
   */
  setContext(next: Record<string, unknown>): void;

  /**
   * Override the emit function for this logger instance.
   *
   * @param next - New emit function.
   */
  setEmitFn(next: EmitFn<T>): void;

  /**
   * Override the callback for this logger instance.
   *
   * @param next - New callback, or `undefined` to clear.
   */
  setCallback(next?: LoggerCallback<T>): void;
}

/**
 * Global logger configuration accepted by {@link configureLogger}.
 */
export interface GlobalLoggerConfig {
  /** Global minimum severity level. */
  level?: string;
  /** Global context merged into every log entry — merged on top of existing global context. */
  context?: Record<string, unknown>;
  /** Replaces `defaultEmit` globally. */
  emitFn?: EmitFn<any>;
  /** Fires after `emitFn` on every entry globally. */
  callback?: LoggerCallback<any>;
  /** Custom severity → rank map for non-standard severity levels. */
  severityRanking?: Record<string, number>;
}
