import DataManager from "./data-manager/data-manager";

export default DataManager;

export { ChangeListenerManager } from "./data-manager/change-listener.manager";

export { USERS, DBType, NO_ID } from "./data-manager/data-manager.constants";
export { CollectionChangeType } from "./data-manager/data-manager.type";

/**
 * UserManager
 */
export { UserManager } from "./user-manager/user-manager";
export type { JUser, NewUserRecord } from "./user-manager/user.type";

/**
 * Logging
 */
export { Log, setLogger, setLogLevels, logLevels } from "./logger/logger-manager";
export type { Logger } from "./logger/logger.interface";
