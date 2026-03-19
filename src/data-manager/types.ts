import { Readable } from 'stream';

export enum SortDirection {
  ASC = 1,
  DESC = -1,
}

export enum CollectionChangeType {
  INSERT = 'insert',
  UPDATE = 'update',
  DELETE = 'delete',
}

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/**
 * Minimal database adapter contract used by {@link DataManager}.
 *
 * This keeps DataManager database-agnostic while letting TypeScript
 * type-check calls against the active adapter.
 *
 * Adapter methods remain throw-based. Translation into {@link DbResult}
 * and {@link BulkResult} envelopes happens at the {@link DataManager} layer.
 *
 * Bulk methods marked optional (`?`) indicate the adapter may not support
 * them — {@link DataManager} will fall back to one-by-one operations in
 * that case.
 */
export type DataManagerAdapter = {
  init: (...args: any[]) => Promise<void>;
  close: () => Promise<void>;

  ensureStore: (storeName: string, options?: any) => Promise<void>;
  ensureIndexes: (storeName: string, indexes: any[]) => Promise<void>;

  getCollectionChangeReadable: (
    collectionName: string,
    changeType: CollectionChangeType,
  ) => Readable;

  findItemByIdInCollection: (collectionName: string, id: string) => Promise<object | null>;
  findItemsInCollection: (
    collectionName: string,
    criteria: Record<string, any>,
  ) => Promise<object[]>;
  findItemsByIdsInCollection?: (collectionName: string, ids: string[]) => Promise<object[]>;

  addItemToCollection: (collectionName: string, item: object) => Promise<string>;

  /**
   * Bulk insert. Returns per-item results so partial failures can be surfaced.
   *
   * Each entry in the returned array corresponds to the item at the same
   * index in `items`:
   * - `{ id: string }` on success.
   * - `{ error: string }` on failure.
   */
  addItemsToCollection?: (
    collectionName: string,
    items: object[],
  ) => Promise<Array<{ id: string } | { error: string }>>;

  updateItemInCollection: (
    collectionName: string,
    id: string,
    item: object,
  ) => Promise<object | null>;

  /**
   * Bulk update. Returns per-item results so partial failures can be surfaced.
   *
   * Each entry corresponds to the update at the same index in `updates`:
   * - `{ id: string }` on success.
   * - `{ id: string; error: string }` on failure.
   */
  updateItemsInCollection?: (
    collectionName: string,
    updates: Array<{ id: string; update: object }>,
  ) => Promise<Array<{ id: string } | { id: string; error: string }>>;

  getAllInCollection: (collectionName: string) => Promise<object[]>;

  removeItemFromCollection: (collectionName: string, id: string) => Promise<number>;

  /**
   * Bulk delete. Returns per-item results so partial failures can be surfaced.
   *
   * Each entry corresponds to the id at the same index in `ids`:
   * - `{ id: string }` on success.
   * - `{ id: string; error: string }` on failure.
   */
  removeItemsFromCollection?: (
    collectionName: string,
    ids: string[],
  ) => Promise<Array<{ id: string } | { id: string; error: string }>>;

  clearCollection: (collectionName: string) => Promise<boolean>;
  isCollectionEmpty: (collectionName: string) => Promise<boolean>;
};

export type CollectionChangeListener = {
  (document: { fullDocument: object; updateDescription?: object }): Promise<void>;
};

export type CollectionChangeNotifier = {
  stream: Readable;
  criteria: {
    collectionName: string;
    changeType: CollectionChangeType;
  };
  listenerList: CollectionChangeListener[];
};
