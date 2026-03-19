import { MongoDBManager } from './mongo/mongo-data-manager';
import { EventEmitter } from 'events';
import { ChangeListenerManager } from './change-listener.manager';
import { CollectionChangeType, DataManagerAdapter } from './types';
import { CoreResult, FailureEntry } from '../types';
import { DBType, USERS } from './constants';
import { handleError, coreSuccess, coreFailure, failureEntryFromError } from '../utils';
import { JustInError, JustinErrorCode } from '../errors';
import { Readable } from 'stream';
import { createLogger } from '../logger';

const Log = createLogger({
  context: {
    source: 'data-manager',
  },
});

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
 * before the manager is operational and an envelope would be meaningless.
 */
class DataManager extends EventEmitter {
  protected static instance: DataManager | null = null;

  // NOTE: typed against an adapter contract (DB-agnostic)
  private db: DataManagerAdapter = MongoDBManager;

  private changeListenerManager = ChangeListenerManager.getInstance();
  private isInitialized = false;

  private constructor() {
    super();
    this.isInitialized = false;
  }

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  /**
   * Retrieves the singleton instance of DataManager.
   *
   * @returns The singleton instance.
   */
  public static getInstance(): DataManager {
    if (!DataManager.instance) {
      DataManager.instance = new DataManager();
    }
    return DataManager.instance;
  }

  /**
   * Deletes the singleton instance.
   *
   * @internal
   */
  protected static killInstance(): void {
    if (DataManager.instance) {
      DataManager.instance = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initializes the DataManager with the specified database type.
   *
   * @param dbType - The type of database to initialize. Defaults to MongoDB.
   * @returns Resolves when initialization is complete.
   * @throws {JustInError} If the db type is unsupported or initialization fails.
   */
  public async init(dbType: DBType = DBType.MONGO): Promise<void> {
    try {
      if (this.getInitializationStatus() && dbType === DBType.MONGO) return;
      if (dbType !== DBType.MONGO) {
        return handleError('MongoDB is the only supported DB type', 'init', {
          code: JustinErrorCode.VALIDATION_ERROR,
        });
      }
      await this.db.init();
      this.isInitialized = true;
    } catch (error) {
      return handleError('Failed to initialize DataManager', 'init', { error });
    }
  }

  /**
   * Closes the DataManager and removes all listeners.
   *
   * @returns Resolves when closed.
   * @throws {JustInError} If the DataManager has not been initialized or close fails.
   */
  public async close(): Promise<void> {
    try {
      this.checkInitialization();
      await this.changeListenerManager.clearChangeListeners();
      await this.db.close();
      this.isInitialized = false;
      Log.debug('DataManager closed and uninitialized');
    } catch (error) {
      return handleError('Failed to close DataManager', 'close', { error });
    }
  }

  /**
   * Returns whether the DataManager has been initialized.
   *
   * @returns `true` if initialized.
   */
  public getInitializationStatus(): boolean {
    return this.isInitialized;
  }

  /**
   * Throws if the DataManager has not been initialized.
   *
   * @throws {JustInError} If not initialized.
   * @internal
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
   * @param collectionName - The name of the collection to ensure.
   * @param options - Optional adapter-specific store options.
   * @returns Resolves when the store is confirmed to exist.
   * @throws {JustInError} If the DataManager has not been initialized or the operation fails.
   */
  public async ensureStore(collectionName: string, options?: any): Promise<void> {
    try {
      this.checkInitialization();
      await this.db.ensureStore(collectionName, options);
    } catch (error) {
      return handleError(
        `Failed to ensure store: ${collectionName}`,
        'ensureStore',
        { error },
      );
    }
  }

  /**
   * Ensures indexes exist on a collection.
   *
   * @param collectionName - The name of the collection.
   * @param indexes - Index definitions to ensure.
   * @returns Resolves when all indexes are confirmed.
   * @throws {JustInError} If the DataManager has not been initialized or the operation fails.
   */
  public async ensureIndexes(collectionName: string, indexes: any[]): Promise<void> {
    try {
      this.checkInitialization();
      await this.db.ensureIndexes(collectionName, indexes);
    } catch (error) {
      return handleError(
        `Failed to ensure indexes on: ${collectionName}`,
        'ensureIndexes',
        { error },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Change streams
  // ---------------------------------------------------------------------------

  /**
   * Provides a change stream for a specific collection and change type.
   *
   * @param collectionName - The name of the collection to monitor.
   * @param changeType - The type of change to monitor.
   * @returns A readable stream of change events.
   * @throws {JustInError} If the DataManager has not been initialized.
   */
  public getChangeStream(collectionName: string, changeType: CollectionChangeType): Readable {
    this.checkInitialization();
    return this.db.getCollectionChangeReadable(collectionName, changeType);
  }

  // ---------------------------------------------------------------------------
  // Find
  // ---------------------------------------------------------------------------

  /**
   * Finds an item by ID in a specified collection.
   *
   * Returns `null` if no document matches — this is not an error condition.
   *
   * @template T - The expected type of the item.
   * @param collectionName - The name of the collection.
   * @param id - The ID of the item to find.
   * @returns The found item or `null` if not found or if the query fails.
   */
  public async findItemByIdInCollection<T>(
    collectionName: string,
    id: string,
  ): Promise<T | null> {
    try {
      this.checkInitialization();
      const item = await this.db.findItemByIdInCollection(collectionName, id);
      return item as T | null;
    } catch (error) {
      Log.error(`Failed to find item by ID in collection: ${collectionName}`, error);
      return null;
    }
  }

  /**
   * Finds items by criteria in a specified collection.
   *
   * Returns an empty array if no documents match — this is not an error condition.
   *
   * @template T - The expected type of the items.
   * @param collectionName - The name of the collection.
   * @param criteria - Key-value pairs to search for.
   * @returns Matching items, or an empty array if none found or if the query fails.
   */
  public async findItemsInCollection<T>(
    collectionName: string,
    criteria: Record<string, any>,
  ): Promise<T[]> {
    if (!criteria || !collectionName) return [];

    try {
      this.checkInitialization();
      const itemList = await this.db.findItemsInCollection(collectionName, criteria);
      return itemList as T[];
    } catch (error) {
      Log.error(`Failed to find items by criteria in collection: ${collectionName}`, error);
      return [];
    }
  }

  /**
   * Finds multiple items by ID in a single bulk query.
   *
   * Uses adapter bulk find if available; otherwise falls back to one-by-one.
   * Order of results is not guaranteed to match the input order.
   * Returns an empty array if no ids match — this is not an error condition.
   *
   * @template T - The expected type of the items.
   * @param collectionName - The name of the collection.
   * @param ids - IDs to look up.
   * @returns Found items (could be fewer than requested if some ids do not exist), or an empty array if the query fails.
   */
  public async findItemsByIdsInCollection<T>(
    collectionName: string,
    ids: string[],
  ): Promise<T[]> {
    try {
      this.checkInitialization();

      if (!Array.isArray(ids) || ids.length === 0) return [];

      if (typeof this.db.findItemsByIdsInCollection === 'function') {
        return (await this.db.findItemsByIdsInCollection(collectionName, ids)) as T[];
      }

      // Fallback: find one-by-one.
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
   * @template T - The expected type of the items.
   * @param collectionName - The name of the collection.
   * @returns All items in the collection, an empty array if none exist, or an empty array if the query fails.
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
   * Adds an item to a specified collection.
   *
   * @template T - The type of the item being added.
   * @param collectionName - The name of the collection.
   * @param item - The item to add.
   * @returns A {@link CoreResult} with the added item (including assigned `id`) on success.
   */
  public async addItemToCollection<T extends object>(
    collectionName: string,
    item: T,
  ): Promise<CoreResult<T & { id: string }>> {
    try {
      this.checkInitialization();
      const id = await this.db.addItemToCollection(collectionName, item);
      const newItem = { id, ...item } as T & { id: string };

      if (collectionName === USERS) {
        this.emit('userAdded', newItem);
      }

      return coreSuccess([newItem]);
    } catch (error) {
      if (!(error instanceof JustInError) || !error.isLogged) {
        Log.error('addItemToCollection failed', { store: collectionName, error });
      }
      return coreFailure([failureEntryFromError(error)]);
    }
  }

  /**
   * Adds multiple items to a specified collection.
   *
   * Uses adapter bulk insert if available (`ordered: false` — continues on
   * partial failure); otherwise falls back to one-by-one.
   *
   * @template T - The type of the items being added.
   * @param collectionName - The collection name.
   * @param items - The items to insert.
   * @returns A {@link CoreResult} with per-item success and failure detail.
   */
  public async addItemsToCollection<T extends object>(
    collectionName: string,
    items: T[],
  ): Promise<CoreResult<T & { id: string }>> {
    if (!Array.isArray(items) || items.length === 0) {
      return coreSuccess([]);
    }

    try {
      this.checkInitialization();

      if (typeof this.db.addItemsToCollection === 'function') {
        const results = await this.db.addItemsToCollection(collectionName, items);

        const successes: Array<T & { id: string }> = [];
        const failures: FailureEntry[] = [];

        for (let i = 0; i < results.length; i++) {
          const result = results[i];

          if ('id' in result) {
            const inserted = { id: result.id, ...items[i] } as T & { id: string };
            successes.push(inserted);

            if (collectionName === USERS) {
              this.emit('userAdded', inserted);
            }
          } else {
            Log.warn('addItemsToCollection: item failed', { store: collectionName, reason: result.error });
            failures.push({ code: JustinErrorCode.DB_ERROR, reason: result.error });
          }
        }

        return failures.length === 0 ? coreSuccess(successes) : coreFailure(failures, successes);
      }

      // Fallback: insert one-by-one, collect results.
      const successes: Array<T & { id: string }> = [];
      const failures: FailureEntry[] = [];

      for (const item of items) {
        try {
          const id = await this.db.addItemToCollection(collectionName, item);
          const inserted = { id, ...item } as T & { id: string };
          successes.push(inserted);

          if (collectionName === USERS) {
            this.emit('userAdded', inserted);
          }
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
   * Updates an item in a collection by ID.
   *
   * @param collectionName - The name of the collection.
   * @param id - The ID of the item to update.
   * @param updateObject - The update data.
   * @returns A {@link CoreResult} with the updated item on success, or failure detail.
   */
  public async updateItemByIdInCollection(
    collectionName: string,
    id: string,
    updateObject: object,
  ): Promise<CoreResult<object>> {
    try {
      this.checkInitialization();
      const updatedItem = await this.db.updateItemInCollection(collectionName, id, updateObject);

      if (collectionName === USERS) {
        this.emit('userUpdated', { id, ...updateObject });
      }

      if (!updatedItem) {
        return coreFailure([{ id, code: JustinErrorCode.NOT_FOUND, reason: `Item with id (${id}) not found` }]);
      }
      return coreSuccess([updatedItem]);
    } catch (error) {
      if (!(error instanceof JustInError) || !error.isLogged) {
        Log.error('updateItemByIdInCollection failed', { store: collectionName, id, error });
      }
      return coreFailure([failureEntryFromError(error, { id })]);
    }
  }

  /**
   * Updates multiple items in a collection by ID in a single bulk operation.
   *
   * Uses adapter bulk write if available (`ordered: false` — continues on
   * partial failure); otherwise falls back to one-by-one.
   *
   * @param collectionName - The name of the collection.
   * @param updates - Array of `{ id, update }` pairs to apply.
   * @returns A {@link CoreResult} with per-item success and failure detail.
   */
  public async updateItemsByIdInCollection(
    collectionName: string,
    updates: Array<{ id: string; update: object }>,
  ): Promise<CoreResult<{ id: string }>> {
    if (!Array.isArray(updates) || updates.length === 0) {
      return coreSuccess([]);
    }

    try {
      this.checkInitialization();

      if (typeof this.db.updateItemsInCollection === 'function') {
        const results = await this.db.updateItemsInCollection(collectionName, updates);

        const successes: Array<{ id: string }> = [];
        const failures: FailureEntry[] = [];

        for (const result of results) {
          if ('error' in result) {
            Log.warn('updateItemsByIdInCollection: item failed', { store: collectionName, id: result.id, reason: result.error });
            failures.push({ id: result.id, code: JustinErrorCode.DB_ERROR, reason: result.error });
          } else {
            successes.push({ id: result.id });
          }
        }

        return failures.length === 0 ? coreSuccess(successes) : coreFailure(failures, successes);
      }

      // Fallback: update one-by-one, collect results.
      const successes: Array<{ id: string }> = [];
      const failures: FailureEntry[] = [];

      for (const { id, update } of updates) {
        try {
          const result = await this.db.updateItemInCollection(collectionName, id, update);
          if (result) {
            successes.push({ id });
          } else {
            Log.warn('updateItemsByIdInCollection: item not found', { store: collectionName, id });
            failures.push({ id, code: JustinErrorCode.NOT_FOUND, reason: `Item with id (${id}) not found` });
          }
        } catch (err) {
          if (!(err instanceof JustInError) || !err.isLogged) {
            Log.warn('updateItemsByIdInCollection: item failed', { store: collectionName, id, error: err });
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
   * Removes an item from a collection by ID.
   *
   * @param collectionName - The name of the collection.
   * @param id - The ID of the item to remove.
   * @returns A {@link CoreResult} with `successes: [null]` if deleted, or failure detail.
   */
  public async removeItemFromCollection(
    collectionName: string,
    id: string,
  ): Promise<CoreResult<null>> {
    try {
      this.checkInitialization();
      const deletedCount = await this.db.removeItemFromCollection(collectionName, id);

      if (deletedCount > 0 && collectionName === USERS) {
        this.emit('userDeleted', id);
      }

      if (deletedCount === 0) {
        return coreFailure([{ id, code: JustinErrorCode.NOT_FOUND, reason: `Item with id (${id}) not found` }]);
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
   * Removes multiple items from a collection by ID in a single bulk operation.
   *
   * Uses adapter bulk delete if available (`ordered: false` — continues on
   * partial failure); otherwise falls back to one-by-one.
   *
   * @param collectionName - The name of the collection.
   * @param ids - IDs of the items to remove.
   * @returns A {@link CoreResult} with per-item success and failure detail.
   */
  public async removeItemsFromCollection(
    collectionName: string,
    ids: string[],
  ): Promise<CoreResult<{ id: string }>> {
    if (!Array.isArray(ids) || ids.length === 0) {
      return coreSuccess([]);
    }

    try {
      this.checkInitialization();

      if (typeof this.db.removeItemsFromCollection === 'function') {
        const results = await this.db.removeItemsFromCollection(collectionName, ids);

        const successes: Array<{ id: string }> = [];
        const failures: FailureEntry[] = [];

        for (const result of results) {
          if ('error' in result) {
            Log.warn('removeItemsFromCollection: item failed', { store: collectionName, id: result.id, reason: result.error });
            failures.push({ id: result.id, code: JustinErrorCode.DB_ERROR, reason: result.error });
          } else {
            successes.push({ id: result.id });

            if (collectionName === USERS) {
              this.emit('userDeleted', result.id);
            }
          }
        }

        return failures.length === 0 ? coreSuccess(successes) : coreFailure(failures, successes);
      }

      // Fallback: remove one-by-one, collect results.
      const successes: Array<{ id: string }> = [];
      const failures: FailureEntry[] = [];

      for (const id of ids) {
        try {
          const deletedCount = await this.db.removeItemFromCollection(collectionName, id);
          if (deletedCount > 0) {
            successes.push({ id });

            if (collectionName === USERS) {
              this.emit('userDeleted', id);
            }
          } else {
            Log.warn('removeItemsFromCollection: item not found', { store: collectionName, id });
            failures.push({ id, code: JustinErrorCode.NOT_FOUND, reason: `Item with id (${id}) not found` });
          }
        } catch (err) {
          if (!(err instanceof JustInError) || !err.isLogged) {
            Log.warn('removeItemsFromCollection: item failed', { store: collectionName, id, error: err });
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
   * @param collectionName - The name of the collection.
   * @returns A {@link CoreResult} with `successes: [null]` on success, or failure detail.
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
   * Checks if a collection is empty.
   *
   * @param collectionName - The name of the collection.
   * @returns `true` if the collection is empty, `false` if not or if the query fails.
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

export default DataManager;
