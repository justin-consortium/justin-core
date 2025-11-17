import {
  makeLoggerSandbox,
} from '../helpers/logger';

export {
  type CapturedEmit,
  type LoggerSandboxOptions,
} from '../helpers/logger';


export function mockLogger(options?: import('../helpers/logger').LoggerSandboxOptions) {
  return makeLoggerSandbox(options);
}
