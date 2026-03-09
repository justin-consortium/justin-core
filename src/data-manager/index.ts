import { MongoDBManager } from './mongo/mongo-data-manager';
import { EventEmitter } from 'events';
import { ChangeListenerManager } from './change-listener.manager';
import { CollectionChangeType, DataManagerAdapter } from './types';
import { DBType, USERS } from './constants';
import { handleDbError } from './helpers';
import { Readable } from 'stream';
import { createLogger } from '../logger';

const Log = createLogger({
  context: {
    source: 'data-manager',
  },
});

/**
 * Manages database operations and collection change listeners.
 */
class DataManager extends EventEmitter {
  protected static instance: DataManager | null = null;

  // NOTE: typed against an adapter contract (DB-agnostic)
  private db: DataManagerAdapter = MongoDBManager;

  private changeListenerManager = ChangeListenerManager.getInstance();
  private isInitialized = false;
  private initializedAt: Date | null = null;

  private constructor() {
    super();
    this.isInitialized = false;
    this.initializedAt = new Date();
  }

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  /**
   * Retrieves the singleton instance of DataManager.
   * @returns {DataManager} The singleton instance.
   */
  public static getInstance(): DataManager {
    if (!DataManager.instance) {
      DataManager.instance = new DataManager();
    }
    return DataManager.instance;
  }

  /**
   * Deletes the singleton instance of DataManager.
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
   * @param {DBType} dbType - The type of database to initialize. Defaults to MongoDB.
   * @returns {Promise<void>} Resolves when initialization is complete.
   * @throws {Error} If initialization fails.
   */
  public async init(dbType: DBType = DBType.MONGO): Promise<void> {
    try {
      if (this.getInitializationStatus() && dbType === DBType.MONGO) return;
      if (dbType !== DBType.MONGO) {
        throw new Error('MongoDB is the only supported DB type');
      }
      await this.db.init();
      this.isInitialized = true;
    } catch (error) {
      handleDbError('Failed to initialize DataManager', 'init', error);
    }
  }

  /**
   * Closes the DataManager and removes all listeners.
   * @returns {Promise<void>} Resolves when closed.
   * @throws {Error} If the DataManager has not been initialized or close fails.
   */
  public async close(): Promise<void> {
    try {
      this.checkInitialization();
      this.changeListenerManager.clearChangeListeners();
      await this.db.close();
      this.isInitialized = false;
      Log.debug('DataManager closed and uninitialized');
    } catch (error) {
      handleDbError('Failed to close DataManager', 'close', error);
    }
  }

  /**
   * Returns whether the DataManager has been initialized.
   * @returns {boolean} Initialization status.
   */
  public getInitializationStatus(): boolean {
    return this.isInitialized;
  }

  /**
   * Throws if the DataManager has not been initialized.
   * @throws {Error} If the DataManager has not been initialized.
   */
  public checkInitialization(): void {
    if (!this.isInitialized) {
      throw new Error('DataManager has not been initialized');
    }
  }

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  /**
   * Ensures a store exists and applies adapter-supported options (idempotent).
   * @param {string} storeName - The collection/table name.
   * @param {object} [options] - Optional storage options (adapter-specific).
   * @throws {Error} If the DataManager has not been initialized or the operation fails.
   */
  public async ensureStore(storeName: string, options?: { validator?: unknown }): Promise<void> {
    this.checkInitialization();
    await this.db.ensureStore(storeName, options as any);
  }

  /**
   * Ensures indexes exist on a store (idempotent by name and key).
   * @param {string} storeName - The collection/table name.
   * @param {Array<{name?: string; key: unknown; unique?: boolean; partialFilterExpression?: unknown}>} indexes
   * @throws {Error} If the DataManager has not been initialized or the operation fails.
   */
  public async ensureIndexes(
    storeName: string,
    indexes: Array<{
      name?: string;
      key: unknown;
      unique?: boolean;
      partialFilterExpression?: unknown;
    }>,
  ): Promise<void> {
    this.checkInitialization();
    await this.db.ensureIndexes(storeName, indexes as any);
  }

  // ---------------------------------------------------------------------------
  // Change streams
  // ---------------------------------------------------------------------------

  /**
   * Provides a change stream for a specific collection and change type.
   * @param {string} collectionName - The name of the collection to monitor.
   * @param {CollectionChangeType} changeType - The type of change to monitor.
   * @returns {Readable} A readable stream of change events.
   * @throws {Error} If the DataManager has not been initialized.
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
   * @template T - The expected type of the item.
   * @param {string} collectionName - The name of the collection.
   * @param {string} id - The ID of the item to find.
   * @returns {Promise<T | null>} Resolves with the found item or `null` if not found.
   * @throws {Error} If the DataManager has not been initialized or the query fails.
   */
  public async findItemByIdInCollection<T>(collectionName: string, id: string): Promise<T | null> {
    try {
      this.checkInitialization();
      const item = await this.db.findItemByIdInCollection(collectionName, id);
      return item as T | null;
    } catch (error) {
      return handleDbError(
        `Failed to find item by ID in collection: ${collectionName}`,
        'findItemByIdInCollection',
        error,
      );
    }
  }

  /**
   * Finds items by criteria in a specified collection.
   * @template T - The expected type of the items.
   * @param {string} collectionName - The name of the collection.
   * @param {object} criteria - Key-value pairs to search for.
   * @returns {Promise<T[]>} Resolves with matching items.
   * @throws {Error} If the DataManager has not been initialized or the query fails.
   */
  public async findItemsInCollection<T>(
    collectionName: string,
    criteria: Record<string, any>,
  ): Promise<T[]> {
    if (!criteria || !collectionName) {
      return [];
    }

    try {
      this.checkInitialization();
      const itemList = await this.db.findItemsInCollection(collectionName, criteria);
      return itemList as T[];
    } catch (error) {
      return handleDbError(
        `Failed to find items by criteria in collection: ${collectionName}`,
        'findItemsInCollection',
        error,
      );
    }
  }

  /**
   * Finds multiple items by ID in a single bulk query.
   *
   * Uses adapter bulk find if available; otherwise falls back to one-by-one.
   * Order of results is not guaranteed to match the input order.
   *
   * @template T - The expected type of the items.
   * @param {string} collectionName - The name of the collection.
   * @param {string[]} ids - IDs to look up.
   * @returns {Promise<T[]>} Found items (may be fewer than requested if some ids do not exist).
   * @throws {Error} If the DataManager has not been initialized or the query fails.
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
      return handleDbError(
        `Failed to bulk-find items in collection: ${collectionName}`,
        'findItemsByIdsInCollection',
        error,
      );
    }
  }

  /**
   * Retrieves all items from a collection.
   * @template T - The expected type of the items.
   * @param {string} collectionName - The name of the collection.
   * @returns {Promise<T[]>} Resolves with all items in the collection.
   * @throws {Error} If the DataManager has not been initialized or the query fails.
   */
  public async getAllInCollection<T>(collectionName: string): Promise<T[]> {
    try {
      this.checkInitialization();
      return (await this.db.getAllInCollection(collectionName)) as T[];
    } catch (error) {
      return handleDbError(
        `Failed to retrieve items from collection: ${collectionName}`,
        'getAllInCollection',
        error,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Add
  // ---------------------------------------------------------------------------

  /**
   * Adds an item to a specified collection.
   * @template T - The type of the item being added.
   * @param {string} collectionName - The name of the collection.
   * @param {T} item - The item to add.
   * @returns {Promise<T & { id: string }>} Resolves with the added item including its new id.
   * @throws {Error} If the DataManager has not been initialized or the insert fails.
   */
  public async addItemToCollection<T extends object>(
    collectionName: string,
    item: T,
  ): Promise<T & { id: string }> {
    try {
      this.checkInitialization();
      const id = await this.db.addItemToCollection(collectionName, item);
      const newItem = { id, ...item };

      if (collectionName === USERS) {
        this.emit('userAdded', newItem);
      }

      return newItem;
    } catch (error) {
      return handleDbError(
        `Failed to add item to collection: ${collectionName}`,
        'addItemToCollection',
        error,
      );
    }
  }

  /**
   * Adds multiple items to a specified collection.
   *
   * Uses adapter bulk insert if available; otherwise falls back to one-by-one.
   *
   * @template T - The type of the items being added.
   * @param {string} collectionName - The collection name.
   * @param {T[]} items - The items to insert.
   * @returns {Promise<Array<T & { id: string }>>} Inserted items with their new ids.
   * @throws {Error} If the DataManager has not been initialized or the insert fails.
   */
  public async addItemsToCollection<T extends object>(
    collectionName: string,
    items: T[],
  ): Promise<Array<T & { id: string }>> {
    try {
      this.checkInitialization();

      if (!Array.isArray(items) || items.length === 0) return [];

      if (typeof this.db.addItemsToCollection === 'function') {
        const ids = await this.db.addItemsToCollection(collectionName, items);
        const created = ids.map((id, idx) => ({ id, ...(items[idx] as any) })) as Array<T & { id: string }>;

        if (collectionName === USERS) {
          for (const item of created) {
            this.emit('userAdded', item);
          }
        }

        return created;
      }

      // Fallback: insert one-by-one.
      const created: Array<T & { id: string }> = [];
      for (const item of items) {
        const out = await this.addItemToCollection(collectionName, item);
        created.push(out);
      }

      return created;
    } catch (error) {
      return handleDbError(
        `Failed to add items to collection: ${collectionName}`,
        'addItemsToCollection',
        error,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * Updates an item in a collection by ID.
   * @param {string} collectionName - The name of the collection.
   * @param {string} id - The ID of the item to update.
   * @param {object} updateObject - The update data.
   * @returns {Promise<object | null>} Resolves with the updated item or `null` if not found.
   * @throws {Error} If the DataManager has not been initialized or the update fails.
   */
  public async updateItemByIdInCollection(
    collectionName: string,
    id: string,
    updateObject: object,
  ): Promise<object | null> {
    try {
      this.checkInitialization();
      const updatedItem = await this.db.updateItemInCollection(collectionName, id, updateObject);

      if (collectionName === USERS) {
        this.emit('userUpdated', { id, ...updateObject });
      }

      return updatedItem;
    } catch (error) {
      return handleDbError(
        `Failed to update item in collection: ${collectionName}`,
        'updateItemByIdInCollection',
        error,
      );
    }
  }

  /**
   * Updates multiple items in a collection by ID in a single bulk operation.
   *
   * Uses adapter bulk write if available; otherwise falls back to one-by-one.
   *
   * @param {string} collectionName - The name of the collection.
   * @param {Array<{ id: string; update: object }>} updates - Array of `{ id, update }` pairs to apply.
   * @returns {Promise<number>} Number of documents actually modified.
   * @throws {Error} If the DataManager has not been initialized or the update fails.
   */
  public async updateItemsByIdInCollection(
    collectionName: string,
    updates: Array<{ id: string; update: object }>,
  ): Promise<number> {
    try {
      this.checkInitialization();

      if (!Array.isArray(updates) || updates.length === 0) return 0;

      if (typeof this.db.updateItemsInCollection === 'function') {
        return await this.db.updateItemsInCollection(collectionName, updates);
      }

      // Fallback: update one-by-one.
      let modified = 0;
      for (const { id, update } of updates) {
        const result = await this.db.updateItemInCollection(collectionName, id, update);
        if (result) modified++;
      }
      return modified;
    } catch (error) {
      return handleDbError(
        `Failed to bulk-update items in collection: ${collectionName}`,
        'updateItemsByIdInCollection',
        error,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Remove
  // ---------------------------------------------------------------------------

  /**
   * Removes an item from a collection by ID.
   *
   * Returns the number of documents deleted (1 if deleted, 0 if not found).
   * Throws if the id is invalid or the operation fails.
   *
   * @param {string} collectionName - The name of the collection.
   * @param {string} id - The ID of the item to remove.
   * @returns {Promise<number>} Number of documents deleted (0 or 1).
   * @throws {Error} If the id is invalid, the DataManager has not been initialized, or the operation fails.
   */
  public async removeItemFromCollection(collectionName: string, id: string): Promise<number> {
    try {
      this.checkInitialization();
      const deletedCount = await this.db.removeItemFromCollection(collectionName, id);

      if (deletedCount > 0 && collectionName === USERS) {
        this.emit('userDeleted', id);
      }

      return deletedCount;
    } catch (error) {
      return handleDbError(
        `Failed to remove item from collection: ${collectionName}`,
        'removeItemFromCollection',
        error,
      );
    }
  }

  /**
   * Removes multiple items from a collection by ID in a single bulk operation.
   *
   * Uses adapter bulk delete if available; otherwise falls back to one-by-one.
   * Partial success is acceptable — returns the count of documents actually deleted.
   *
   * @param {string} collectionName - The name of the collection.
   * @param {string[]} ids - IDs of the items to remove.
   * @returns {Promise<number>} Number of documents actually deleted.
   * @throws {Error} If the DataManager has not been initialized or the operation fails.
   */
  public async removeItemsFromCollection(
    collectionName: string,
    ids: string[],
  ): Promise<number> {
    try {
      this.checkInitialization();

      if (!Array.isArray(ids) || ids.length === 0) return 0;

      if (typeof this.db.removeItemsFromCollection === 'function') {
        return await this.db.removeItemsFromCollection(collectionName, ids);
      }

      // Fallback: remove one-by-one.
      let deletedCount = 0;
      for (const id of ids) {
        const result = await this.db.removeItemFromCollection(collectionName, id);
        deletedCount += result;
      }
      return deletedCount;
    } catch (error) {
      return handleDbError(
        `Failed to bulk-remove items from collection: ${collectionName}`,
        'removeItemsFromCollection',
        error,
      );
    }
  }

  /**
   * Clears all items in a collection.
   * @param {string} collectionName - The name of the collection.
   * @returns {Promise<void>} Resolves when the collection is cleared.
   * @throws {Error} If the DataManager has not been initialized or the operation fails.
   */
  public async clearCollection(collectionName: string): Promise<void> {
    try {
      this.checkInitialization();
      await this.db.clearCollection(collectionName);
    } catch (error) {
      handleDbError(`Failed to clear collection: ${collectionName}`, 'clearCollection', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Checks if a collection is empty.
   * @param {string} collectionName - The name of the collection.
   * @returns {Promise<boolean>} Resolves with `true` if the collection is empty.
   * @throws {Error} If the DataManager has not been initialized or the operation fails.
   */
  public async isCollectionEmpty(collectionName: string): Promise<boolean> {
    try {
      this.checkInitialization();
      return await this.db.isCollectionEmpty(collectionName);
    } catch (error) {
      return handleDbError(
        `Failed to check if collection is empty: ${collectionName}`,
        'isCollectionEmpty',
        error,
      );
    }
  }
}

export default DataManager;
