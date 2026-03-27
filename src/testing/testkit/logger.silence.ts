import sinon from 'sinon';

import type { SinonSandbox } from 'sinon';
import * as GlobalLogger from '../../logger/global';

/**
 * Silences all logger output for the duration of a test or suite.
 *
 * Replaces the global emit function and default emitter with no-ops so
 * that log output from production code does not pollute test output.
 * Unlike {@link makeLoggerSandbox}, this does not capture entries —
 * use it when you want quiet tests and do not need to assert on logs.
 *
 * Returns a `restore()` function that reverts the stubs.
 *
 * @example
 * ```ts
 * // Silence for the entire suite
 * let restoreLogs: () => void;
 * beforeAll(() => { restoreLogs = silenceLogger(); });
 * afterAll(() => restoreLogs());
 *
 * // Or silence for a single test
 * it('does something noisy', () => {
 *   const { restore } = silenceLogger();
 *   // ... test ...
 *   restore();
 * });
 * ```
 */
export function silenceLogger(sb?: SinonSandbox): { restore: () => void } {
  const sandbox = sb ?? sinon.createSandbox();
  const noop = () => {};

  sandbox.stub(GlobalLogger, 'getGlobalEmitFn').returns(noop as any);
  sandbox.stub(GlobalLogger, 'defaultEmit').callsFake(noop as any);

  return {
    restore() {
      // Only restore if we created the sandbox ourselves
      if (!sb) sandbox.restore();
    },
  };
}
