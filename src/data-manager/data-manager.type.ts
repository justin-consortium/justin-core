import { Readable } from 'stream';
import { DBInsertItemIssueResult, DBInsertItemSuccessResult, DBInsertItemsSuccessResult, DBInsertItemsIssueResult, DBGetItemSuccessResult, DBGetItemIssueResult  } from './mongo/mongo-data-manager.type';

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
export type DataManagerModule = {
  addOneItem<T = string>(collection: string, item: object): Promise<DBInsertItemSuccessResult<T> | DBInsertItemIssueResult>;
  addMultipleItems<T = (object | null)[]>(collection: string, items: object[]): Promise<DBInsertItemsSuccessResult<T> | DBInsertItemsIssueResult<T>>;
  getOneItem<T = unknown>(collection: string, id: string): Promise<DBGetItemSuccessResult<T> | DBGetItemIssueResult>;
  // TODO: continue from here
  findItems<T = unknown[]>(collection: string, query: object): Promise<DBFindItemsSuccessResult<T> | DBFindItemsIssueResult>;
  updateOneItem<T = unknown>(collection: string, id: string, update: object): Promise<DBUpdateItemSuccessResult<T> | DBUpdateItemIssueResult<T>>;
  updateItems<T = unknown[]>(collection: string, query: object, update: object): Promise<DBUpdateItemsSuccessResult<T> | DBUpdateItemsIssueResult<T>>;
  removeOneItem(collection: string, id: string): Promise<DBDeleteSuccessResult | DBDeleteIssueResult>;
  removeItems(collection: string, query: object): Promise<DBDeleteSuccessResult | DBDeleteIssueResult>;
  
  // Allow any other property/method
  [key: string]: unknown;
};