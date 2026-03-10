
export { DataManager, USERS, PROTECTED_ATTRIBUTES, DBType, NO_ID, ChangeListenerManager, CollectionChangeType  } from './data-manager';


/**
 * UserManager
 */
export { UserManager } from './user-manager/user-manager';
export type { JUser, NewUserRecord } from './user-manager/types';

/**
 * Logging
 */
export { createLogger, configureLogger } from './logger';
export type {
  Logger,
  LoggerEntry,
  BaseSeverity,
  LoggerCallback,
  EmitFn,
  LoggerConfig,
} from './logger';

/**
 * Lifecycle
 */
export { shutdownCore } from './lifecycle';
export type { ShutdownCoreOptions } from './lifecycle';
