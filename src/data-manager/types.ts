import type { Readable } from 'stream';

export enum CollectionChangeType {
  INSERT = 'insert',
  UPDATE = 'update',
  DELETE = 'delete',
}

// ---------------------------------------------------------------------------
// DB config
// ---------------------------------------------------------------------------

/**
 * Configuration passed to {@link configureDB} before any manager is initialised.
 *
 * The connection is lazy — it is not established until the first manager calls
 * `init()`. All managers in the process share the same connection.
 *
 * @example
 * ```ts
 * configureDB({ dbType: DBType.MONGO, uri: process.env.MONGO_URI });
 * await UserManager.init();
 * ```
 */
export type DBConfig = {
  /** Database type. Currently only `DBType.MONGO` is supported. */
  dbType: import('./constants').DBType;
  /** Connection string for the database. */
  uri: string;
  /** Database name. Falls back to the adapter default if omitted. */
  dbName?: string;
};

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/**
 * Minimal database adapter contract used by {@link DataManager}.
 *
 * Keeps DataManager database-agnostic while letting TypeScript type-check
 * calls against the active adapter.
 *
 * Adapter methods remain throw-based — translation into {@link CoreResult}
 * envelopes happens at the DataManager layer.
 *
 * Bulk methods marked `?` are optional — DataManager falls back to one-by-one
 * when the adapter does not provide them.
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
  addItemsToCollection?: (
    collectionName: string,
    items: object[],
  ) => Promise<Array<{ id: string } | { error: string }>>;

  updateItemInCollection: (
    collectionName: string,
    id: string,
    item: object,
  ) => Promise<object | null>;
  updateItemsInCollection?: (
    collectionName: string,
    updates: Array<{ id: string; update: object }>,
  ) => Promise<Array<{ id: string } | { id: string; error: string }>>;

  getAllInCollection: (collectionName: string) => Promise<object[]>;

  removeItemFromCollection: (collectionName: string, id: string) => Promise<number>;
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
