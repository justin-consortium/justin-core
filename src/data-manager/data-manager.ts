import { EventEmitter } from 'events';
import type { Readable } from 'stream';
import { MongoDBManager } from './mongo/mongo-data-manager';
import { ChangeListenerManager } from './change-listener.manager';
import type { CollectionChangeType, DataManagerAdapter, DBConfig } from './types';
import { DBType } from './constants';
import type { CoreResult, FailureEntry } from '../types';
import { handleError, coreSuccess, coreFailure, failureEntryFromError } from '../utils';
import { JustInError, JustinErrorCode } from '../errors';
import { createLogger } from '../logger';

const Log = createLogger({ context: { source: 'data-manager' } });

// ---------------------------------------------------------------------------
// Pending DB config
// ---------------------------------------------------------------------------

/**
 * Holds the config provided by {@link configureDB} before any manager
 * calls `init()`. Cleared once the connection is established.
 */
let _pendingConfig: DBConfig | null = null;

/**
 * Stores the DB configuration for lazy connection.
 *
 * Call this once at application startup before initialising any manager.
 * The actual connection is deferred until the first manager calls `init()`,
 * so it is safe to call `configureDB` before the event loop is fully running.
 *
 * All managers in the same process share the same underlying connection —
 * there is no need to call this more than once.
 *
 * @example
 * ```ts
 * import { configureDB, DBType } from '@just-in/core';
 *
 * configureDB({ dbType: DBType.MONGO, uri: process.env.MONGO_URI });
 * await UserManager.init();
 * ```
 *
 * @param config - Database connection configuration.
 */
function configureDB(config: DBConfig): void {
  _pendingConfig = config;
}

/**
 * Returns the pending DB config. Used internally by {@link DataManager.init}.
 * @internal
 */
function getPendingConfig(): DBConfig | null {
  return _pendingConfig;
}

/**
 * Clears the pending DB config.
 *
 * Intended for test teardown only — resets the module-level config so tests
 * that need to assert on the "no config" path can do so cleanly.
 *
 * @internal
 */
function clearPendingConfig(): void {
  _pendingConfig = null;
}

// ---------------------------------------------------------------------------
// DataManager
// ---------------------------------------------------------------------------

/**
 * Manages database operations and collection change listeners.
 *
 * All public write methods return a {@link CoreResult} envelope — they never
 * throw. Callers branch on `result.ok` rather than wrapping calls in try/catch.
 *
 * Read methods (`find*`, `getAll*`) return data directly (`T | null` or `T[]`)
 * since an empty or missing result is not an error condition.
 *
 * Lifecycle methods (`init`, `close`) still throw on failure since they run
 * before the manager is operational and a result envelope would be meaningless.
 *
 * The adapter is injected at construction time, defaulting to {@link MongoDBManager}.
 * Tests can substitute a different adapter to avoid hitting a real database.
 */
class DataManager extends EventEmitter {
  protected static instance: DataManager | null = null;

  private db: DataManagerAdapter;
  private changeListenerManager = ChangeListenerManager.getInstance();
  private isInitialized = false;

  private constructor(adapter: DataManagerAdapter = MongoDBManager) {
    super();
    this.db = adapter;
  }

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  /**
   * Returns the singleton `DataManager` instance, creating it if necessary.
   *
   * @param adapter - DB adapter to use. Only applied on first call; subsequent
   * calls ignore this argument and return the existing instance.
   */
  public static getInstance(adapter?: DataManagerAdapter): DataManager {
    if (!DataManager.instance) {
      DataManager.instance = new DataManager(adapter);
    }
    return DataManager.instance;
  }

  /** @internal */
  protected static killInstance(): void {
    if (DataManager.instance) DataManager.instance = null;
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialises the DataManager, connecting to the database.
   *
   * On first call the pending config stored by {@link configureDB} is consumed
   * and the adapter connection is established. Subsequent calls on an already-
   * initialised instance are no-ops.
   *
   * @throws {JustInError} If no DB config has been provided via {@link configureDB},
   * the DB type is unsupported, or the connection fails.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    const config = getPendingConfig();

    if (!config) {
      return handleError(
        'No DB config found — call configureDB() before initialising any manager',
        'DataManager.init',
        { code: JustinErrorCode.NOT_INITIALIZED },
      );
    }

    if (config.dbType !== DBType.MONGO) {
      return handleError(
        `Unsupported DB type: ${config.dbType}. Only DBType.MONGO is currently supported.`,
        'DataManager.init',
        { code: JustinErrorCode.VALIDATION_ERROR },
      );
    }

    try {
      await (this.db as typeof MongoDBManager).init(config.uri, config.dbName);
      this.isInitialized = true;
      Log.debug('DataManager initialised', { dbType: config.dbType });
    } catch (error) {
      return handleError('Failed to initialise DataManager', 'DataManager.init', { error });
    }
  }

  /**
   * Closes the database connection and tears down all change listeners.
   *
   * @throws {JustInError} If the DataManager has not been initialised or close fails.
   */
  public async close(): Promise<void> {
    try {
      this.checkInitialization();
      await this.changeListenerManager.clearChangeListeners();
      await this.db.close();
      this.isInitialized = false;
      Log.debug('DataManager closed');
    } catch (error) {
      return handleError('Failed to close DataManager', 'DataManager.close', { error });
    }
  }

  /**
   * Returns whether the DataManager has been successfully initialised.
   */
  public getInitializationStatus(): boolean {
    return this.isInitialized;
  }

  /**
   * Throws if the DataManager has not been initialised.
   *
   * @throws {JustInError} If not initialised.
   */
  public checkInitialization(): void {
    if (!this.isInitialized) {
      handleError('DataManager has not been initialized', 'checkInitialization', {
        code: JustinErrorCode.NOT_INITIALIZED,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  /**
   * Ensures a collection (store) exists in the database.
   *
   * @param collectionName - Name of the collection to ensure.
   * @param options - Optional adapter-specific store options.
   * @throws {JustInError} If not initialised or the operation fails.
   */
  public async ensureStore(collectionName: string, options?: any): Promise<void> {
    try {
      this.checkInitialization();
      await this.db.ensureStore(collectionName, options);
    } catch (error) {
      return handleError(`Failed to ensure store: ${collectionName}`, 'ensureStore', { error });
    }
  }

  /**
   * Ensures indexes exist on a collection.
   *
   * @param collectionName - Name of the collection.
   * @param indexes - Index definitions to ensure.
   * @throws {JustInError} If not initialised or the operation fails.
   */
  public async ensureIndexes(collectionName: string, indexes: any[]): Promise<void> {
    try {
      this.checkInitialization();
      await this.db.ensureIndexes(collectionName, indexes);
    } catch (error) {
      return handleError(`Failed to ensure indexes on: ${collectionName}`, 'ensureIndexes', {
        error,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Change streams
  // ---------------------------------------------------------------------------

  /**
   * Returns a readable stream of change events for the given collection and
   * change type, backed by the active adapter's change stream implementation.
   *
   * @param collectionName - Collection to watch.
   * @param changeType - Type of change to observe.
   * @throws {JustInError} If not initialised.
   */
  public getChangeStream(collectionName: string, changeType: CollectionChangeType): Readable {
    this.checkInitialization();
    return this.db.getCollectionChangeReadable(collectionName, changeType);
  }

  // ---------------------------------------------------------------------------
  // Find
  // ---------------------------------------------------------------------------

  /**
   * Finds an item by ID in the specified collection.
   *
   * Returns `null` if no document matches — this is not an error condition.
   *
   * @param collectionName - Target collection.
   * @param id - ID of the item to find.
   */
  public async findItemByIdInCollection<T>(collectionName: string, id: string): Promise<T | null> {
    try {
      this.checkInitialization();
      return (await this.db.findItemByIdInCollection(collectionName, id)) as T | null;
    } catch (error) {
      Log.error(`Failed to find item by ID in collection: ${collectionName}`, error);
      return null;
    }
  }

  /**
   * Finds items matching `criteria` in the specified collection.
   *
   * Returns an empty array if no documents match — this is not an error condition.
   *
   * @param collectionName - Target collection.
   * @param criteria - Key-value pairs to filter by.
   */
  public async findItemsInCollection<T>(
    collectionName: string,
    criteria: Record<string, any>,
  ): Promise<T[]> {
    if (!criteria || !collectionName) return [];

    try {
      this.checkInitialization();
      return (await this.db.findItemsInCollection(collectionName, criteria)) as T[];
    } catch (error) {
      Log.error(`Failed to find items by criteria in collection: ${collectionName}`, error);
      return [];
    }
  }

  /**
   * Finds multiple items by ID in a single bulk query.
   *
   * Uses the adapter's bulk find if available; falls back to one-by-one.
   * Order of results is not guaranteed to match the input order.
   *
   * @param collectionName - Target collection.
   * @param ids - IDs to look up.
   */
  public async findItemsByIdsInCollection<T>(collectionName: string, ids: string[]): Promise<T[]> {
    try {
      this.checkInitialization();
      if (!Array.isArray(ids) || ids.length === 0) return [];

      if (typeof this.db.findItemsByIdsInCollection === 'function') {
        return (await this.db.findItemsByIdsInCollection(collectionName, ids)) as T[];
      }

      const results: T[] = [];
      for (const id of ids) {
        const item = await this.db.findItemByIdInCollection(collectionName, id);
        if (item) results.push(item as T);
      }
      return results;
    } catch (error) {
      Log.error(`Failed to bulk-find items in collection: ${collectionName}`, error);
      return [];
    }
  }

  /**
   * Retrieves all items from a collection.
   *
   * Returns an empty array if the collection is empty — this is not an error condition.
   *
   * @param collectionName - Target collection.
   */
  public async getAllInCollection<T>(collectionName: string): Promise<T[]> {
    try {
      this.checkInitialization();
      return (await this.db.getAllInCollection(collectionName)) as T[];
    } catch (error) {
      Log.error(`Failed to retrieve items from collection: ${collectionName}`, error);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Add
  // ---------------------------------------------------------------------------

  /**
   * Adds an item to the specified collection.
   *
   * @param collectionName - Target collection.
   * @param item - Item to insert.
   * @returns A {@link CoreResult} with the inserted item (including its assigned `id`) on success.
   */
  public async addItemToCollection<T extends object>(
    collectionName: string,
    item: T,
  ): Promise<CoreResult<T & { id: string }>> {
    try {
      this.checkInitialization();
      const id = await this.db.addItemToCollection(collectionName, item);
      return coreSuccess([{ id, ...item } as T & { id: string }]);
    } catch (error) {
      if (!(error instanceof JustInError) || !error.isLogged) {
        Log.error('addItemToCollection failed', { store: collectionName, error });
      }
      return coreFailure([failureEntryFromError(error)]);
    }
  }

  /**
   * Adds multiple items to the specified collection.
   *
   * Uses the adapter's bulk insert if available (`ordered: false` — continues
   * on partial failure); otherwise falls back to one-by-one.
   *
   * @param collectionName - Target collection.
   * @param items - Items to insert.
   * @returns A {@link CoreResult} with per-item success and failure detail.
   */
  public async addItemsToCollection<T extends object>(
    collectionName: string,
    items: T[],
  ): Promise<CoreResult<T & { id: string }>> {
    if (!Array.isArray(items) || items.length === 0) return coreSuccess([]);

    try {
      this.checkInitialization();

      if (typeof this.db.addItemsToCollection === 'function') {
        const results = await this.db.addItemsToCollection(collectionName, items);
        const successes: Array<T & { id: string }> = [];
        const failures: FailureEntry[] = [];

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if ('id' in result) {
            successes.push({ id: result.id, ...items[i] } as T & { id: string });
          } else {
            Log.warn('addItemsToCollection: item failed', {
              store: collectionName,
              reason: result.error,
            });
            failures.push({ code: JustinErrorCode.DB_ERROR, reason: result.error });
          }
        }

        return failures.length === 0 ? coreSuccess(successes) : coreFailure(failures, successes);
      }

      const successes: Array<T & { id: string }> = [];
      const failures: FailureEntry[] = [];

      for (const item of items) {
        try {
          const id = await this.db.addItemToCollection(collectionName, item);
          successes.push({ id, ...item } as T & { id: string });
        } catch (err) {
          if (!(err instanceof JustInError) || !err.isLogged) {
            Log.warn('addItemsToCollection: item failed', { store: collectionName, error: err });
          }
          failures.push(failureEntryFromError(err));
        }
      }

      return failures.length === 0 ? coreSuccess(successes) : coreFailure(failures, successes);
    } catch (error) {
      if (!(error instanceof JustInError) || !error.isLogged) {
        Log.error('addItemsToCollection failed', { store: collectionName, error });
      }
      return coreFailure([failureEntryFromError(error)]);
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * Updates an item in the specified collection by ID.
   *
   * @param collectionName - Target collection.
   * @param id - ID of the item to update.
   * @param updateObject - Fields to apply as a partial update.
   * @returns A {@link CoreResult} with the updated item on success.
   */
  public async updateItemByIdInCollection(
    collectionName: string,
    id: string,
    updateObject: object,
  ): Promise<CoreResult<object>> {
    try {
      this.checkInitialization();
      const updated = await this.db.updateItemInCollection(collectionName, id, updateObject);

      if (!updated) {
        return coreFailure([
          { id, code: JustinErrorCode.NOT_FOUND, reason: `Item with id (${id}) not found` },
        ]);
      }
      return coreSuccess([updated]);
    } catch (error) {
      if (!(error instanceof JustInError) || !error.isLogged) {
        Log.error('updateItemByIdInCollection failed', { store: collectionName, id, error });
      }
      return coreFailure([failureEntryFromError(error, { id })]);
    }
  }

  /**
   * Updates multiple items in the specified collection by ID in a single bulk operation.
   *
   * Uses the adapter's bulk write if available (`ordered: false` — continues on
   * partial failure); otherwise falls back to one-by-one.
   *
   * @param collectionName - Target collection.
   * @param updates - Array of `{ id, update }` pairs to apply.
   * @returns A {@link CoreResult} with per-item success and failure detail.
   */
  public async updateItemsByIdInCollection(
    collectionName: string,
    updates: Array<{ id: string; update: object }>,
  ): Promise<CoreResult<{ id: string }>> {
    if (!Array.isArray(updates) || updates.length === 0) return coreSuccess([]);

    try {
      this.checkInitialization();

      if (typeof this.db.updateItemsInCollection === 'function') {
        const results = await this.db.updateItemsInCollection(collectionName, updates);
        const successes: Array<{ id: string }> = [];
        const failures: FailureEntry[] = [];

        for (const result of results) {
          if ('error' in result) {
            Log.warn('updateItemsByIdInCollection: item failed', {
              store: collectionName,
              id: result.id,
              reason: result.error,
            });
            failures.push({ id: result.id, code: JustinErrorCode.DB_ERROR, reason: result.error });
          } else {
            successes.push({ id: result.id });
          }
        }

        return failures.length === 0 ? coreSuccess(successes) : coreFailure(failures, successes);
      }

      const successes: Array<{ id: string }> = [];
      const failures: FailureEntry[] = [];

      for (const { id, update } of updates) {
        try {
          const result = await this.db.updateItemInCollection(collectionName, id, update);
          if (result) {
            successes.push({ id });
          } else {
            failures.push({
              id,
              code: JustinErrorCode.NOT_FOUND,
              reason: `Item with id (${id}) not found`,
            });
          }
        } catch (err) {
          if (!(err instanceof JustInError) || !err.isLogged) {
            Log.warn('updateItemsByIdInCollection: item failed', {
              store: collectionName,
              id,
              error: err,
            });
          }
          failures.push(failureEntryFromError(err, { id }));
        }
      }

      return failures.length === 0 ? coreSuccess(successes) : coreFailure(failures, successes);
    } catch (error) {
      if (!(error instanceof JustInError) || !error.isLogged) {
        Log.error('updateItemsByIdInCollection failed', { store: collectionName, error });
      }
      return coreFailure([failureEntryFromError(error)]);
    }
  }

  // ---------------------------------------------------------------------------
  // Remove
  // ---------------------------------------------------------------------------

  /**
   * Removes an item from the specified collection by ID.
   *
   * @param collectionName - Target collection.
   * @param id - ID of the item to remove.
   * @returns A {@link CoreResult} with `successes: [null]` on success.
   */
  public async removeItemFromCollection(
    collectionName: string,
    id: string,
  ): Promise<CoreResult<null>> {
    try {
      this.checkInitialization();
      const deletedCount = await this.db.removeItemFromCollection(collectionName, id);

      if (deletedCount === 0) {
        return coreFailure([
          { id, code: JustinErrorCode.NOT_FOUND, reason: `Item with id (${id}) not found` },
        ]);
      }
      return coreSuccess([null]);
    } catch (error) {
      if (!(error instanceof JustInError) || !error.isLogged) {
        Log.error('removeItemFromCollection failed', { store: collectionName, id, error });
      }
      return coreFailure([failureEntryFromError(error, { id })]);
    }
  }

  /**
   * Removes multiple items from the specified collection by ID in a single bulk operation.
   *
   * Uses the adapter's bulk delete if available (`ordered: false` — continues on
   * partial failure); otherwise falls back to one-by-one.
   *
   * @param collectionName - Target collection.
   * @param ids - IDs of the items to remove.
   * @returns A {@link CoreResult} with per-item success and failure detail.
   */
  public async removeItemsFromCollection(
    collectionName: string,
    ids: string[],
  ): Promise<CoreResult<{ id: string }>> {
    if (!Array.isArray(ids) || ids.length === 0) return coreSuccess([]);

    try {
      this.checkInitialization();

      if (typeof this.db.removeItemsFromCollection === 'function') {
        const results = await this.db.removeItemsFromCollection(collectionName, ids);
        const successes: Array<{ id: string }> = [];
        const failures: FailureEntry[] = [];

        for (const result of results) {
          if ('error' in result) {
            Log.warn('removeItemsFromCollection: item failed', {
              store: collectionName,
              id: result.id,
              reason: result.error,
            });
            failures.push({ id: result.id, code: JustinErrorCode.DB_ERROR, reason: result.error });
          } else {
            successes.push({ id: result.id });
          }
        }

        return failures.length === 0 ? coreSuccess(successes) : coreFailure(failures, successes);
      }

      const successes: Array<{ id: string }> = [];
      const failures: FailureEntry[] = [];

      for (const id of ids) {
        try {
          const deletedCount = await this.db.removeItemFromCollection(collectionName, id);
          if (deletedCount > 0) {
            successes.push({ id });
          } else {
            failures.push({
              id,
              code: JustinErrorCode.NOT_FOUND,
              reason: `Item with id (${id}) not found`,
            });
          }
        } catch (err) {
          if (!(err instanceof JustInError) || !err.isLogged) {
            Log.warn('removeItemsFromCollection: item failed', {
              store: collectionName,
              id,
              error: err,
            });
          }
          failures.push(failureEntryFromError(err, { id }));
        }
      }

      return failures.length === 0 ? coreSuccess(successes) : coreFailure(failures, successes);
    } catch (error) {
      if (!(error instanceof JustInError) || !error.isLogged) {
        Log.error('removeItemsFromCollection failed', { store: collectionName, error });
      }
      return coreFailure([failureEntryFromError(error)]);
    }
  }

  /**
   * Clears all items in a collection.
   *
   * @param collectionName - Target collection.
   * @returns A {@link CoreResult} with `successes: [null]` on success.
   */
  public async clearCollection(collectionName: string): Promise<CoreResult<null>> {
    try {
      this.checkInitialization();
      await this.db.clearCollection(collectionName);
      return coreSuccess([null]);
    } catch (error) {
      if (!(error instanceof JustInError) || !error.isLogged) {
        Log.error('clearCollection failed', { store: collectionName, error });
      }
      return coreFailure([failureEntryFromError(error)]);
    }
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Returns `true` if the specified collection is empty.
   *
   * @param collectionName - Target collection.
   */
  public async isCollectionEmpty(collectionName: string): Promise<boolean> {
    try {
      this.checkInitialization();
      return await this.db.isCollectionEmpty(collectionName);
    } catch (error) {
      Log.error(`Failed to check if collection is empty: ${collectionName}`, error);
      return false;
    }
  }
}

export { DataManager, configureDB, getPendingConfig, clearPendingConfig };
