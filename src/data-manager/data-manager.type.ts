import { Readable } from 'stream';
import { DBAddItemIssueResult, DBAddItemSuccessResult, DBAddItemsSuccessResult, DBAddItemsIssueResult, DBGetItemSuccessResult, DBGetItemIssueResult, DBFindItemsSuccessResult, DBFindItemsIssueResult, DBUpdateItemSuccessResult, DBUpdateItemIssueResult, DBUpdateItemsSuccessResult, DBUpdateItemsIssueResult, DBRemoveSuccessResult, DBRemoveIssueResult  } from './mongo/mongo-data-manager.type';

export enum SortDirection {
  ASC = 1,
  DESC = -1,
}

export enum CollectionChangeType {
  INSERT = 'insert',
  UPDATE = 'update',
  DELETE = 'delete',
}

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


// types used for defining manager module/methods
export type DataManagerContract = {
  
  /**
   * Adds a single item to the specified collection.
   *
   * @template T The type of the item to insert.
   * @param {string} collection - The name of the collection to insert into.
   * @param {object} item - The item to add to the collection.
   * @returns {Promise<DBAddItemSuccessResult<T> | DBAddItemIssueResult>} Resolves with the result of the insert operation.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing required fields, wrong type).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., Node.js MongoDB driver); such errors are caught, logged, and re-thrown.
   */
  addOneItem<T = object>(collection: string, item: object): Promise<DBAddItemSuccessResult<T> | DBAddItemIssueResult>;
  addMultipleItems<T = (object | null)[]>(collection: string, items: object[]): Promise<DBAddItemsSuccessResult<T> | DBAddItemsIssueResult<T>>;
  getOneItem<T = object>(collection: string, id: string): Promise<DBGetItemSuccessResult<T> | DBGetItemIssueResult>;
  findItems<T = (object | null)[]>(collection: string, query: object): Promise<DBFindItemsSuccessResult<T> | DBFindItemsIssueResult>;
  updateOneItem<T = object>(collection: string, id: string, update: Record<string, unknown>): Promise<DBUpdateItemSuccessResult<T> | DBUpdateItemIssueResult>;
  updateItems<T = object[]>(collection: string, query: object, update: Record<string, unknown>): Promise<DBUpdateItemsSuccessResult<T> | DBUpdateItemsIssueResult<T>>;
  removeOneItem(collection: string, id: string): Promise<DBRemoveSuccessResult | DBRemoveIssueResult>;
  removeItems(collection: string, query: object): Promise<DBRemoveSuccessResult | DBRemoveIssueResult>;
  
  // Allow any other property/method
  [key: string]: unknown;
};