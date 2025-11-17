export { createLogger } from './logger';

export type {
  BaseSeverity,
  Logger,
  LoggerEntry,
  EmitFn,
  LoggerCallback,
} from './types';

export {
  configureGlobalLoggerSettings as configureLogger,
} from './global';

export type {
  GlobalLoggerConfig as LoggerConfig,
} from './global';
