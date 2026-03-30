import type {
  BaseSeverity,
  EmitFn,
  GlobalLoggerConfig,
  LoggerCallback,
  LoggerEntry,
} from './types';

/**
 * Default console-based emitter. Used as the global fallback when no other
 * emitter is configured.
 */
function defaultEmit<T extends string = BaseSeverity>(
  entry: LoggerEntry<T>,
  mergedContext: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    severity: entry.severity,
    message: entry.message,
    ...mergedContext,
  });

  const sev = String(entry.severity).toUpperCase();
  switch (sev) {
    case 'DEBUG':
      console.debug(line);
      break;
    case 'WARNING':
      console.warn(line);
      break;
    case 'ERROR':
      console.error(line);
      break;
    case 'INFO':
    default:
      console.log(line);
      break;
  }
}

let _globalMinLevel: string = (process.env.LOG_LEVEL as string) ?? 'DEBUG';
let _globalContext: Record<string, unknown> = {};
let _globalEmitFn: EmitFn<any> | undefined = defaultEmit;
let _globalCallback: LoggerCallback<any> | undefined;
let _globalSeverityRanking: Record<string, number> | undefined;

/**
 * Sets the global minimum log level.
 *
 * @param level - Minimum severity name (e.g. `'INFO'`).
 */
function setGlobalMinLogLevel(level: string): void {
  _globalMinLevel = level;
}

/**
 * Returns the current global minimum log level.
 */
function getGlobalMinLogLevel(): string {
  return _globalMinLevel;
}

/**
 * Merges additional entries into the global log context.
 *
 * Subsequent calls merge on top of existing context — they do not replace it.
 * Use this to progressively add context at startup (e.g. `app` first, then `env`).
 *
 * @param next - Key-value pairs to merge into the global context.
 */
function setGlobalLogContext(next: Record<string, unknown>): void {
  if (!next || typeof next !== 'object') return;
  _globalContext = { ..._globalContext, ...next };
}

/**
 * Returns a shallow copy of the current global log context.
 */
function getGlobalLogContext(): Record<string, unknown> {
  return { ..._globalContext };
}

/**
 * Sets the global emit function. Falls back to {@link defaultEmit} if
 * `undefined` is passed.
 */
function setGlobalEmitFn<T extends string = BaseSeverity>(fn: EmitFn<T> | undefined): void {
  _globalEmitFn = (fn as EmitFn<any> | undefined) ?? defaultEmit;
}

/**
 * Returns the current global emit function.
 */
function getGlobalEmitFn<T extends string = BaseSeverity>(): EmitFn<T> {
  return _globalEmitFn as EmitFn<T>;
}

/**
 * Sets the global log callback.
 */
function setGlobalLogCallback<T extends string = BaseSeverity>(
  cb: LoggerCallback<T> | undefined,
): void {
  _globalCallback = cb as LoggerCallback<any> | undefined;
}

/**
 * Returns the current global log callback, if any.
 */
function getGlobalLogCallback<T extends string = BaseSeverity>(): LoggerCallback<T> | undefined {
  return _globalCallback as LoggerCallback<T> | undefined;
}

/**
 * Sets a global severity → rank mapping so custom severity levels can be
 * ordered correctly against the built-in ones.
 *
 * @param ranking - Map from severity name to numeric rank.
 */
function setGlobalSeverityRanking(ranking: Record<string, number> | undefined): void {
  _globalSeverityRanking = ranking;
}

/**
 * Returns a copy of the current global severity ranking, or `undefined` if
 * none has been configured.
 */
function getGlobalSeverityRanking(): Record<string, number> | undefined {
  return _globalSeverityRanking ? { ..._globalSeverityRanking } : undefined;
}

/**
 * Configures all global logger settings in a single call.
 *
 * Call once at application startup, before initialising any managers.
 * Every logger instance across the package reads global config at emit
 * time, so this one call covers everything.
 *
 * Context is *merged* — calling `configureLogger` multiple times accumulates
 * context rather than replacing it.
 *
 * @param config - Global logger configuration.
 */
function configureGlobalLoggerSettings(config: GlobalLoggerConfig): void {
  if (config.level) setGlobalMinLogLevel(config.level);
  if (config.context) setGlobalLogContext(config.context);
  if (config.emitFn) setGlobalEmitFn(config.emitFn);
  if (config.callback) setGlobalLogCallback(config.callback);
  if (config.severityRanking) setGlobalSeverityRanking(config.severityRanking);
}

/**
 * Clears the global log context entirely, replacing it with an empty object.
 *
 * Unlike {@link setGlobalLogContext} which merges, this is a full reset.
 * Intended for test teardown — not for production use.
 *
 * @internal
 */
function clearGlobalLogContext(): void {
  _globalContext = {};
}

export {
  defaultEmit,
  setGlobalMinLogLevel,
  getGlobalMinLogLevel,
  setGlobalLogContext,
  getGlobalLogContext,
  setGlobalEmitFn,
  getGlobalEmitFn,
  setGlobalLogCallback,
  getGlobalLogCallback,
  setGlobalSeverityRanking,
  getGlobalSeverityRanking,
  configureGlobalLoggerSettings,
  clearGlobalLogContext,
};
