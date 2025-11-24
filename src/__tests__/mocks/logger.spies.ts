import { makeLoggerSandbox, type CapturedEmit, type LoggerSandboxOptions } from '../helpers/logger';

export type LoggerSpies = ReturnType<typeof makeLoggerSandbox> & {
  captured: CapturedEmit[];
};

export function loggerSpies(options?: LoggerSandboxOptions): LoggerSpies {
  const lg = makeLoggerSandbox(options);
  return {
    ...lg,
    captured: lg.captured,
  };
}
