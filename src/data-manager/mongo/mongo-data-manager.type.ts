export type WithId = {
  id?: string;
  _id?: string;
};

export type DeletedDocRecord = {
  documentKey: WithId;
};

export type InsertedOrUpatedDocRecord = {
  fullDocument: WithId;
  updateDescription?: object;
};

// types used for defining manager module/methods
export type MongoManagerModule = {
  addOneItem<T = string>(collection: string, item: object): Promise<DBInsertItemSuccessResult<T> | DBInsertItemIssueResult>;
  addMultipleItems<T = (string | null)[]>(collection: string, items: object[]): Promise<DBInsertItemsSuccessResult<T> | DBInsertItemsIssueResult<T>>;
  getOneItem<T = unknown>(collection: string, id: string): Promise<DBGetItemSuccessResult<T> | DBGetItemIssueResult>;
  findItems<T = unknown[]>(collection: string, query: object): Promise<DBFindItemsSuccessResult<T> | DBFindItemsIssueResult>;
  updateOneItem<T = unknown>(collection: string, id: string, update: object): Promise<DBUpdateItemSuccessResult<T> | DBUpdateItemIssueResult<T>>;
  updateItems<T = unknown[]>(collection: string, query: object, update: object): Promise<DBUpdateItemsSuccessResult<T> | DBUpdateItemsIssueResult<T>>;
  removeOneItem(collection: string, id: string): Promise<DBDeleteSuccessResult | DBDeleteIssueResult>;
  removeItems(collection: string, query: object): Promise<DBDeleteSuccessResult | DBDeleteIssueResult>;
  
  // Allow any other property/method
  [key: string]: unknown;
};

export type DBSuccessResult<T = unknown> = {
  success: true;
  data: T;
};

export type DBIssueResult<T = unknown> = {
  success: false;
  issueType: string;
  message: string;
  data?: T;
};

export type DBInsertItemSuccessResult<T = string> = DBSuccessResult<T>;

export type DBInsertItemIssueResult = DBIssueResult;

export type DBInsertItemsSuccessResult<T = string[]> = DBSuccessResult<T> & {
  insertedCount: number;
  insertedIndexIdMap: Record<number, string>;
};

export type insertErrorInfo = {index: number, code: string, message: string};

export type DBInsertItemsIssueResult<T = (string | null)[]> = DBIssueResult & {
  data: T;
  insertedCount: number;
  insertedIndexIdMap: Record<number, string>;
  errors: insertErrorInfo[];
};

export type DBGetItemSuccessResult<T> = DBSuccessResult<T>;

export type DBGetItemIssueResult = DBIssueResult;

export type DBFindItemsSuccessResult<T = unknown[]> = DBSuccessResult<T>;

export type DBFindItemsIssueResult = DBIssueResult;

export type DBUpdateItemSuccessResult<T = unknown> = DBSuccessResult<T> & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: null | string;
};

export type DBUpdateItemIssueResult<T = unknown> = DBIssueResult<T> & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: null | string;
};

type DBUpdateItemsSuccessResult<T = unknown[]> = DBSuccessResult<T> & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedIds: (null | string)[];
};

export type DBUpdateItemsIssueResult<T = unknown[]> = DBIssueResult<T> & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedIds: (null | string)[];
};

export type DBDeleteSuccessResult = DBSuccessResult & {
  deletedCount: number;
};

export type DBDeleteIssueResult = DBIssueResult & {
  deletedCount: number;
};

