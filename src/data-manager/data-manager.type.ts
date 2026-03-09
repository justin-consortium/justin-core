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

/**
 * Minimal database adapter contract used by {@link DataManager}.
 *
 * This keeps DataManager database-agnostic while letting TypeScript
 * type-check calls against the active adapter.
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
  addItemsToCollection?: (collectionName: string, items: object[]) => Promise<string[]>;

  updateItemInCollection: (
    collectionName: string,
    id: string,
    item: object,
  ) => Promise<object | null>;
  updateItemsInCollection?: (
    collectionName: string,
    updates: Array<{ id: string; update: object }>,
  ) => Promise<number>;

  getAllInCollection: (collectionName: string) => Promise<object[]>;

  removeItemFromCollection: (collectionName: string, id: string) => Promise<number>;
  removeItemsFromCollection?: (collectionName: string, ids: string[]) => Promise<number>;

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
