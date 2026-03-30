// ---------------------------------------------------------------------------
// FailureEntry
// ---------------------------------------------------------------------------

/**
 * Structured detail for a single failure within a {@link CoreResult}.
 *
 * Every failure carries a machine-readable `code` for programmatic branching
 * and a human-readable `reason` for logging. Identity fields (`id`,
 * `uniqueIdentifier`) are optional so the same shape works across all managers
 * without requiring any particular domain model. Operation-specific context
 * (e.g. which namespace failed, which key path was rejected) goes in `details`.
 *
 * @example
 * ```ts
 * { uniqueIdentifier: 'alice', code: 'VALIDATION_ERROR', reason: 'uniqueIdentifier already exists' }
 * { uniqueIdentifier: 'alice', code: 'DB_ERROR', reason: 'insert failed', details: { namespace: 'pii' } }
 * { id: 'abc123', code: 'NOT_FOUND', reason: 'Item with id (abc123) not found' }
 * ```
 */
export type FailureEntry = {
  /** DB id of the record that failed. Not present on insert failures (no id assigned yet). */
  id?: string;
  /** Human-readable unique identifier, when available. */
  uniqueIdentifier?: string;
  /** Maps to a {@link JustinErrorCode} value for programmatic branching. */
  code: string;
  /** Human-readable description suitable for logging. */
  reason: string;
  /** Optional operation-specific context, e.g. `{ namespace: 'pii', keyPath: 'ssn' }`. */
  details?: Record<string, any>;
};

// ---------------------------------------------------------------------------
// CoreResult
// ---------------------------------------------------------------------------

/**
 * Standard result envelope for any core operation — single or bulk.
 *
 * Used by every write operation across all managers. Read operations return
 * data directly since an empty result is not an error condition.
 *
 * - `ok: true`  — every item succeeded. `successes` holds the results.
 *                 No `failures` field is present.
 * - `ok: false` — at least one item failed. `successes` holds any partial
 *                 results; `failures` holds structured detail for every item
 *                 that did not succeed.
 *
 * Single operations use the same shape — `successes` contains one element on
 * success, `failures` contains one element on failure.
 *
 * @typeParam T - The type of each successfully processed item.
 *
 * @example
 * ```ts
 * // Single create
 * const result = await UserManager.createUser(record);
 * if (!result.ok) {
 *   const [{ code, reason, uniqueIdentifier }] = result.failures;
 *   return;
 * }
 * const user = result.successes[0];
 *
 * // Bulk create
 * const result = await UserManager.createUsers(records);
 * if (!result.ok) {
 *   for (const { uniqueIdentifier, code, reason } of result.failures) {
 *     console.warn(`[${code}] (${uniqueIdentifier}): ${reason}`);
 *   }
 * }
 * ```
 */
export type CoreResult<T> =
  | { ok: true; successes: T[] }
  | { ok: false; successes: T[]; failures: FailureEntry[] };
