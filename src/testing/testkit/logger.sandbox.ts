import sinon from 'sinon';

import type { SinonSandbox, SinonSpy } from 'sinon';
import type { LoggerEntry } from '../../logger/types';
import * as GlobalLogger from '../../logger/global';

type CapturedEmit = {
  entry: LoggerEntry<string>;
  ctx: Record<string, unknown>;
};

interface LoggerSandboxOptions {
  minLevel?: string;
  ctx?: Record<string, unknown>;
}

type LoggerSandbox = {
  sb: SinonSandbox;
  captured: CapturedEmit[];
  emitSpy: SinonSpy;
  restore(): void;
  last(): CapturedEmit | undefined;
  findByMessage(substr: string): CapturedEmit[];
};

/**
 * Creates a sinon-backed logger sandbox that captures all emitted log entries.
 *
 * Notes:
 * - This file intentionally contains **no Jest expectations**.
 * - Tests can assert however they want (Jest, chai, etc.).
 */
function makeLoggerSandbox(options: LoggerSandboxOptions = {}): LoggerSandbox {
  const sb = sinon.createSandbox();
  const captured: CapturedEmit[] = [];

  const baseCtx: Record<string, unknown> = {
    testSuite: 'unit',
    ...(options.ctx ?? {}),
  };

  const emitSpy = sb.spy((entry: LoggerEntry<string>, ctx: Record<string, unknown>) => {
    captured.push({ entry, ctx });
  });

  const minLevel: string = options.minLevel ?? 'DEBUG';

  sb.stub(GlobalLogger, 'getGlobalEmitFn').returns(emitSpy as any);
  sb.stub(GlobalLogger, 'defaultEmit').callsFake(emitSpy as any);
  sb.stub(GlobalLogger, 'getGlobalLogContext').returns(baseCtx);
  sb.stub(GlobalLogger, 'getGlobalMinLogLevel').returns(minLevel as any);
  sb.stub(GlobalLogger, 'getGlobalSeverityRanking').returns(undefined as any);
  sb.stub(GlobalLogger, 'getGlobalLogCallback').returns(undefined as any);

  return {
    sb,
    captured,
    emitSpy,
    restore() {
      sb.restore();
    },
    last() {
      return captured[captured.length - 1];
    },
    findByMessage(substr: string) {
      return captured.filter((c) => String(c.entry.message).includes(substr));
    },
  };
}

/**
 * Silences all logger output for the duration of a test or suite.
 *
 * Replaces the global emit function and default emitter with no-ops so
 * that log output from production code does not pollute test output.
 * Unlike {@link makeLoggerSandbox}, this does not capture entries —
 * use it when you want quiet tests and do not need to assert on logs.
 *
 * Pass the test's existing sinon sandbox so restore happens automatically
 * with `sb.restore()` in `afterAll` — no separate cleanup needed.
 *
 * @example
 * ```ts
 * // Silence for the entire suite using the existing sandbox
 * beforeAll(async () => {
 *   sb = sinon.createSandbox();
 *   silenceLogger(sb);
 *   // ...
 * });
 * afterAll(async () => {
 *   sb.restore(); // silenceLogger stubs are cleaned up here
 * });
 *
 * // Or standalone with its own restore
 * const { restore } = silenceLogger();
 * restore();
 * ```
 */
function silenceLogger(sb?: SinonSandbox): { restore: () => void } {
  const sandbox = sb ?? sinon.createSandbox();
  const noop = () => {};

  sandbox.stub(GlobalLogger, 'getGlobalEmitFn').returns(noop as any);
  sandbox.stub(GlobalLogger, 'defaultEmit').callsFake(noop as any);

  return {
    restore() {
      if (!sb) sandbox.restore();
    },
  };
}

/**
 * Resets all global logger state back to safe defaults.
 *
 * Call this in `afterEach` whenever a test touches `configureLogger` or any
 * of the `setGlobal*` functions directly. Without this, state from one test
 * leaks into the next because the global variables in `logger/global.ts` are
 * module-level singletons.
 *
 * Safe to call even when no state has been changed — it is a no-op in that case.
 *
 * @example
 * ```ts
 * afterEach(() => {
 *   resetGlobalLoggerState();
 * });
 * ```
 */
function resetGlobalLoggerState(): void {
  GlobalLogger.setGlobalMinLogLevel('DEBUG');
  GlobalLogger.clearGlobalLogContext();
  GlobalLogger.setGlobalEmitFn(undefined);
  GlobalLogger.setGlobalLogCallback(undefined);
  GlobalLogger.setGlobalSeverityRanking(undefined);
}

export type { CapturedEmit, LoggerSandboxOptions, LoggerSandbox };
export { makeLoggerSandbox, silenceLogger, resetGlobalLoggerState };
