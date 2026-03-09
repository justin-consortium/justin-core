import DataManager from './data-manager';

export { DataManager };

export { ChangeListenerManager } from './data-manager/change-listener.manager';

export { USERS, PROTECTED_ATTRIBUTES, DBType, NO_ID } from './data-manager/constants';
export { CollectionChangeType } from './data-manager/types';

/**
 * UserManager
 */
export { UserManager } from './user-manager';
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
