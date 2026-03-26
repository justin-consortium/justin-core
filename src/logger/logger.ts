import type {
  BaseSeverity,
  CreateLoggerOptions,
  EmitFn,
  Logger,
  LoggerCallback,
  LoggerEntry,
} from './types';
import {
  getGlobalEmitFn,
  getGlobalLogCallback,
  getGlobalLogContext,
  getGlobalMinLogLevel,
  getGlobalSeverityRanking,
  defaultEmit,
} from './global';
import { normalizeExtraArg } from './utils';

const BASE_RANKS: Record<BaseSeverity, number> = {
  DEBUG: 10,
  INFO: 30,
  WARNING: 50,
  ERROR: 70,
};

/**
 * Builds the effective severity → rank map by merging the built-in ranks
 * with any globally configured custom ranks.
 */
function buildRankMap<T extends string>(): Record<T, number> {
  const merged: Record<string, number> = { ...BASE_RANKS };
  const globalRanking = getGlobalSeverityRanking();

  if (globalRanking) {
    for (const [k, v] of Object.entries(globalRanking)) {
      merged[k] = v;
    }
  }

  for (const base of Object.keys(BASE_RANKS) as BaseSeverity[]) {
    if (merged[base] === null) merged[base] = BASE_RANKS[base];
  }

  return merged as Record<T, number>;
}

/**
 * Converts a severity string or numeric level into its numeric rank.
 *
 * @param value - Severity name or numeric rank.
 * @param ranks - Map of severity → numeric rank.
 */
function toRank<T extends string>(value: string | number, ranks: Record<T, number>): number {
  if (typeof value === 'number') return value;
  return (ranks as Record<string, number>)[value.toUpperCase()] ?? 0;
}

/**
 * Creates a new logger instance with optional instance-level configuration.
 *
 * Every file that needs logging should create its own instance with a `source`
 * context so entries are always traceable back to their origin.
 *
 * Instance-level settings override their global equivalents but leave the
 * global config untouched. The global config is read at emit time, so changes
 * made via {@link configureLogger} after instance creation are picked up
 * automatically unless the instance has its own override.
 *
 * @example
 * ```ts
 * const Log = createLogger({ context: { source: 'user-manager' } });
 *
 * Log.debug('cache refreshed', { count: users.length });
 * Log.error('DB write failed', { error, collection: 'users' });
 * ```
 *
 * @param options - Optional instance-level configuration.
 * @returns A structured, transport-agnostic logger instance.
 */
function createLogger<T extends string = BaseSeverity>(
  options: CreateLoggerOptions<T> = {},
): Logger<T> {
  const ranks: Record<T, number> = buildRankMap<T>();

  let minLevelRank =
    options.emitLevel !== undefined
      ? toRank(options.emitLevel, ranks)
      : toRank(getGlobalMinLogLevel() as T, ranks);

  let instanceContext: Record<string, unknown> = { ...(options.context ?? {}) };
  let instanceEmitFn: EmitFn<T> | undefined = options.emitFn;
  let instanceCallback: LoggerCallback<T> | undefined = options.callback;

  const shouldEmit = (sev: T) => toRank(sev, ranks) >= minLevelRank;

  const emit = (severity: T, message: string, extras?: unknown): void => {
    const sevUpper = String(severity).toUpperCase() as T;
    if (!shouldEmit(sevUpper)) return;

    const normalizedExtras = extras ? normalizeExtraArg(extras) : undefined;

    const entry: LoggerEntry<T> = { severity: sevUpper, message };

    const mergedContext = {
      ...getGlobalLogContext(),
      ...instanceContext,
      ...(normalizedExtras ?? {}),
    };

    const effectiveEmit = instanceEmitFn ?? getGlobalEmitFn<T>() ?? defaultEmit<T>;
    effectiveEmit(entry, mergedContext);

    const globalCb = getGlobalLogCallback<T>();
    const cb = instanceCallback ?? globalCb;
    if (cb) {
      try {
        cb(entry);
      } catch {
        /* swallow — callbacks must handle their own errors */
      }
    }
  };

  /** Emits a DEBUG-level log. */
  const debug = (message: string, extras?: unknown) => emit('DEBUG' as T, message, extras);

  /** Emits an INFO-level log. */
  const info = (message: string, extras?: unknown) => emit('INFO' as T, message, extras);

  /** Emits a WARNING-level log. */
  const warn = (message: string, extras?: unknown) => emit('WARNING' as T, message, extras);

  /** Emits an ERROR-level log. */
  const error = (message: string, extras?: unknown) => emit('ERROR' as T, message, extras);

  return {
    setLevel(level: string | number) {
      minLevelRank = toRank(level, ranks);
    },
    setContext(next: Record<string, unknown>) {
      instanceContext = { ...instanceContext, ...next };
    },
    setEmitFn(next: EmitFn<T>) {
      instanceEmitFn = next;
    },
    setCallback(next?: LoggerCallback<T>) {
      instanceCallback = next;
    },
    emit,
    debug,
    info,
    warn,
    error,
  };
}

export { createLogger };
