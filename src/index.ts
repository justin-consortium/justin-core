// ---------------------------------------------------------------------------
// DB configuration & lifecycle
// ---------------------------------------------------------------------------

export { configureDB, shutdownCore, registerManager } from './lifecycle';
export type { ShutdownCoreOptions, DBConfig } from './lifecycle';

// ---------------------------------------------------------------------------
// DataManager (low-level — for packages building on core)
// ---------------------------------------------------------------------------

export { DataManager, ChangeListenerManager, DBType, NO_ID } from './data-manager';
export type {
  DataManagerAdapter,
  CollectionChangeListener,
  CollectionChangeNotifier,
} from './data-manager';
export { CollectionChangeType } from './data-manager/types';

// ---------------------------------------------------------------------------
// UserManager
// ---------------------------------------------------------------------------

export { UserManager, TestingUserManager } from './user-manager';
export type {
  JUser,
  BaseJUser,
  NewUserRecord,
  NamespacedAttributes,
  ProtectedAttributesRecord,
  BaseProtectedAttributes,
} from './user-manager';

// ---------------------------------------------------------------------------
// CoreResult
// ---------------------------------------------------------------------------

export type { CoreResult, FailureEntry } from './types';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export { JustInError, JustinErrorCode } from './errors';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export { createLogger, configureLogger } from './logger';
export type {
  Logger,
  LoggerEntry,
  BaseSeverity,
  LoggerCallback,
  EmitFn,
  LoggerConfig,
} from './logger';
