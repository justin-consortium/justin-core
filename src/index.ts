export { DataManager, USERS, PROTECTED_ATTRIBUTES, DBType, NO_ID, ChangeListenerManager, CollectionChangeType } from './data-manager';
export type { DataManagerAdapter, CollectionChangeListener, CollectionChangeNotifier } from './data-manager';
export type { DbResult, BulkResult } from './types';

/**
 * Errors
 */
export { JustinError, JustinErrorCode } from './errors';

/**
 * UserManager
 */
export { UserManager } from './user-manager/user-manager';
export type { JUser, BaseJUser, NewUserRecord, NamespacedAttributes, ProtectedAttributesRecord, BaseProtectedAttributes, SetProtectedAttributesResult } from './user-manager/types';

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
