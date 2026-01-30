# Logging in the @just-in/\* ecosystem

Justin’s logger is designed to be:

- **Framework-agnostic** — usable from any `@just-in/*` package _or your own app code_.
- **Configurable** — global defaults plus per-logger (“scoped”) overrides.
- **Transport-agnostic** — defaults to console output, but you can plug in your own emitter.

---

## What gets logged

A log “event” is represented by a `LoggerEntry` plus a merged context object:

```ts
export type BaseSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

/**
 * A structured log entry emitted by a {@link Logger}.
 */
export interface LoggerEntry<T extends string = BaseSeverity> {
  /**
   * The severity level for this entry (e.g. `INFO`, `WARNING`).
   */
  severity: T;

  /**
   * Human-readable message describing what happened.
   */
  message: string;

  /**
   * Optional structured details for debugging, metrics, and tracing.
   *
   * Use `fields` for *data*, not for “context” like `source`, `env`, or `requestId`
   * that should apply to many logs. That kind of shared metadata belongs in
   * logger context (scoped) or global context (see below).
   */
  fields?: Record<string, unknown>;
}

/**
 * Function signature for emitters (console, remote, etc.).
 */
export type EmitFn<T extends string = BaseSeverity> = (
  entry: LoggerEntry<T>,
  mergedContext: Record<string, unknown>,
) => void | Promise<void>;

/**
 * Optional callback invoked after a log entry is emitted.
 *
 * Useful for tests, metrics, and counters. Unlike {@link EmitFn},
 * callbacks are typically “side-channel” hooks (e.g. incrementing
 * counters) rather than the main log transport.
 */
export type LoggerCallback<T extends string = BaseSeverity> = (entry: LoggerEntry<T>) => void;
```

---

## Global vs scoped loggers

Justin has two concepts that work together:

### 1) Global configuration (shared defaults)

You set global defaults once (typically at app start):

- minimum log level
- global context (merged into every log line -
  typically app level information)
- global emitter (defaults to console logging)
- optional callback
- severity ranking (how levels compare)

### 2) Scoped loggers (module/service-specific)

You create scoped loggers in each module to attach stable context like:

- `source: 'user-manager'`
- `subsystem: 'db'`
- `studyId`, `deployment`, etc.

Scoped loggers inherit global defaults, but can add extra context and (optionally) override behavior.

---

## Creating a scoped logger

Create a module-level logger once:

```ts
import { createLogger } from '@just-in/core';

const Log = createLogger({
  context: {
    source: 'my-service',
    subsystem: 'notifications',
  },
});
```

Use it anywhere in the module:

```ts
Log.info('Enqueued notification', {
  participantIdentifier: 'p-123',
  notificationId: 'walk-1',
});
```

### Example: plain message (no fields)

```ts
Log.debug('No results for handler:', handlerName);
```

> Tip: Prefer a single string message when possible.
> If you include extra data, prefer an object and let it become `fields`.

---

## What should go in `fields`?

Think of `fields` as “structured payload for this one log entry”.

Good uses:

- an entity identifier (userId, taskId)
- small payload snapshots (counts, durations, sizes)
- errors (as objects) when your emitter knows how to serialize them safely

Avoid:

- large payloads (full request bodies, big arrays)
- secrets / tokens / credentials
- repeating stable metadata (that should be context)

### Recommended patterns

```ts
Log.info('User created', { userId, uniqueIdentifier });

Log.warn('Validation failed', {
  reason: 'missingUniqueIdentifier',
  inputShape: typeof user,
});

Log.error('Mongo operation failed', { error, collection: USERS });
```

---

## Default behavior

If you do not overwrite the emitter:

- `createLogger()` emits to a **console-based default emitter**.
- entries are filtered by the **global minimum level** (default is typically `DEBUG` unless configured).
- logger context is merged with global context to form a final context object.

That means third-party apps get sensible logging “for free” without extra setup.

---

## Global configuration

Configure logging once near app startup:

```ts
import { configureLogger } from '@just-in/core';

configureLogger({
  // Minimum severity to emit globally.
  // (If omitted, the framework default is used.)
  minLevel: 'INFO',
  // Context applied to *every* log line in the process.
  context: {
    app: 'my-study-service',
    env: process.env.NODE_ENV ?? 'development',
  },
  // Optional: override the global emitter.
  // If omitted, JustIn uses a console-based default emitter.
  emitFn: async (entry, ctx) => {
    // Example: ship JSON to a remote sink, or integrate with a platform logger.
    // Keep this fast; consider batching in the transport.
    helperFunction(JSON.stringify({ ...ctx, ...entry }));
  },
  // Optional: a post-emit hook (tests, metrics).
  callback: (entry) => {
    // e.g. increment counters by severity,
    // write to a database certain logs,
    // trigger an alert, etc
  },
  // Optional: severity ranking for custom rankings
  // (default severity rankings shown below).
  severityRanking: {
    DEBUG: 10,
    INFO: 30,
    WARNING: 50,
    ERROR: 70,
  },
});
```

### Adding custom severities

You can extend severity levels beyond `BaseSeverity` _if_ you also provide rankings.

Example idea:

- Add `TRACE` below `DEBUG`
- Add `FATAL` above `ERROR`

```ts
type MySeverity = BaseSeverity | 'TRACE' | 'FATAL';

configureLogger<MySeverity>({
  minLevel: 'INFO',
  severityRanking: {
    TRACE: 5,
    DEBUG: 10,
    INFO: 30,
    WARNING: 50,
    ERROR: 70,
    FATAL: 90,
  },
});
```

> If you add severities, be consistent across packages so filtering behaves predictably.

---

## Dos and don’ts

### Do

- **Use stable scoped context** (`source`, `subsystem`) in `createLogger({ context: ... })`.
- **Use `fields` for per-event data** (ids, counts, durations).
- **Log at the right level**:
  - `DEBUG` for diagnostics
  - `INFO` for normal lifecycle milestones
  - `WARNING` for recoverable issues or invalid input
  - `ERROR` for failures that require attention

### Don’t

- Don’t log secrets (tokens, API keys, auth headers).
- Don’t log huge objects (they’re noisy and expensive).
- Don’t use `fields` for stable metadata that should be global context.
- Don’t smash structured data as a string into the message when it should be fields.

---

## Using the logger in tests

Because logging is transport-agnostic, tests can:

- capture emitted entries (via a stub emitter)
- assert on severity/message/fields without touching the console

In Justin packages, prefer the testkit helpers (`loggerSpies`, sandboxes) so tests stay quiet and consistent.
