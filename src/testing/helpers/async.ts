/**
 * Polls a condition function until it returns true, then resolves.
 *
 * Use in integration tests where an asynchronous side effect (e.g. a Mongo
 * change stream callback updating the cache) needs to be observed without
 * relying on a fixed `setTimeout` delay.
 *
 * @param check - A synchronous predicate that returns true when the expected
 *   state has been reached.
 * @param options.attempts - Maximum number of poll attempts (default: 40).
 * @param options.delayMs - Milliseconds between each attempt (default: 50).
 * @throws If the condition has not been satisfied after all attempts.
 *
 * @example
 * ```ts
 * // Wait for a change stream callback to populate the cache
 * await waitForCondition(() => getUserByIdFromCache(userId) !== null);
 *
 * // With custom timeout (40 × 50ms = 2s default; 60 × 100ms = 6s here)
 * await waitForCondition(
 *   () => getAllUsersFromCache().length === 3,
 *   { attempts: 60, delayMs: 100 },
 * );
 * ```
 */
export async function waitForCondition(
  check: () => boolean,
  {
    attempts = 40,
    delayMs = 50,
  }: {
    attempts?: number;
    delayMs?: number;
  } = {},
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForCondition: condition was not satisfied after ${attempts} attempts (${attempts * delayMs}ms total)`,
  );
}
