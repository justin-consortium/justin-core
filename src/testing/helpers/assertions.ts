import type { CapturedEmit } from '../testkit';
import type { CoreResult, FailureEntry } from '../../types';

/**
 * Asserts properties of a captured log entry.
 *
 * `severity` accepts any string so custom severity levels (e.g. `'TRACE'`,
 * `'CRITICAL'`) can be asserted without a type error.
 */
function expectLog(
  log: CapturedEmit | undefined,
  opts: {
    severity?: string;
    messageSubstr?: string;
  } = {},
): void {
  expect(log).toBeDefined();

  if (!log) return;

  if (opts.severity) {
    expect(log.entry.severity).toBe(opts.severity);
  }

  if (opts.messageSubstr) {
    expect(String(log.entry.message)).toContain(opts.messageSubstr);
  }
}

/**
 * Asserts a {@link CoreResult} succeeded and returns the first success item.
 *
 * @example
 * ```ts
 * const user = expectOk(await UserManager.createUser(record));
 * expect(user.uniqueIdentifier).toBe('u1');
 * ```
 */
function expectOk<T>(result: CoreResult<T>): T {
  expect(result.ok).toBe(true);
  expect(result.successes.length).toBeGreaterThan(0);
  return result.successes[0];
}

/**
 * Asserts a {@link CoreResult} failed and returns the first failure entry.
 *
 * @example
 * ```ts
 * const failure = expectFailed(await UserManager.createUser(badRecord));
 * expect(failure.uniqueIdentifier).toBe('u1');
 * ```
 */
function expectFailed<T>(result: CoreResult<T>): FailureEntry {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failures.length).toBeGreaterThan(0);
    return result.failures[0];
  }
  throw new Error('unreachable');
}

/**
 * Asserts a {@link CoreResult} failed with a specific code and returns the
 * first failure entry.
 *
 * @example
 * ```ts
 * const failure = expectFailedWithCode(result, 'NOT_FOUND');
 * expect(failure.id).toBe(userId);
 * ```
 */
function expectFailedWithCode<T>(result: CoreResult<T>, code: string): FailureEntry {
  const failure = expectFailed(result);
  expect(failure.code).toBe(code);
  return failure;
}

export { expectLog, expectOk, expectFailed, expectFailedWithCode };
