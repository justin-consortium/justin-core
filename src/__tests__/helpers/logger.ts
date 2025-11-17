import sinon from 'sinon';
import type { LoggerEntry } from '../../logger/types';
import * as GlobalLogger from '../../logger/global';

export type CapturedEmit = {
  entry: LoggerEntry<string>;
  ctx: Record<string, unknown>;
};

export interface LoggerSandboxOptions {
  minLevel?: string;
  ctx?: Record<string, unknown>;
}

export function makeLoggerSandbox(options: LoggerSandboxOptions = {}) {
  const sb = sinon.createSandbox();
  const captured: CapturedEmit[] = [];

  const baseCtx: Record<string, unknown> = {
    testSuite: 'unit',
    ...(options.ctx ?? {}),
  };

  const emit = sb.spy(
    (entry: LoggerEntry<string>, ctx: Record<string, unknown>) => {
      captured.push({ entry, ctx });
    },
  );

  const minLevel: string = options.minLevel ?? 'DEBUG';

  // Stub the global logger plumbing to route everything to our spy
  sb.stub(GlobalLogger, 'getGlobalEmitFn').returns(emit as any);
  sb.stub(GlobalLogger, 'defaultEmit').callsFake(emit as any);
  sb
    .stub(GlobalLogger, 'getGlobalLogContext')
    .returns(baseCtx as Record<string, unknown>);
  sb
    .stub(GlobalLogger, 'getGlobalMinLogLevel')
    .returns(minLevel as any);
  sb.stub(GlobalLogger, 'getGlobalSeverityRanking').returns(undefined as any);
  sb.stub(GlobalLogger, 'getGlobalLogCallback').returns(undefined as any);

  function restore() {
    sb.restore();
  }

  return {
    sb,
    captured,
    restore,
    // Helper expectations
    last(): CapturedEmit | undefined {
      return captured[captured.length - 1];
    },
    expectLast(message: string, severity: string) {
      const last = captured[captured.length - 1];
      expect(last?.entry.message).toContain(message);
      expect(last?.entry.severity).toBe(severity);
    },
    findByMessage(substr: string) {
      return captured.filter((c) =>
        String(c.entry.message).includes(substr),
      );
    },
  };
}
