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

// types used for defining data manager module/methods
export type MongoManagerModule = {
  addOneItem: (collection: string, item: object) => Promise<DBInsertionItemSuccessResult | DBInsertItemIssueResult>;
  addMultipleItems: (collection: string, items: object[]) => Promise<DBInsertItemsSuccessResult | DBInsertItemsIssueResult>;
  getOneItem: (collection: string, id: string) => Promise<DBGetItemSuccessResult | DBGetItemIssueResult>;
  findItems: (collection: string, query: object) => Promise<DBFindItemsSuccessResult | DBFindItemsIssueResult>;
  updateOneItem: (collection: string, id: string, update: object) => Promise<DBUpdateItemSuccessResult | DBUpdateItemIssueResult>;
  updateItems: (collection: string, query: object, update: object) => Promise<DBUpdateItemsSuccessResult | DBUpdateItemsIssueResult>;
  removeOneItem: (collection: string, id: string) => Promise<DBDeleteSuccessResult | DBDeleteIssueResult>;
  removeItems: (collection: string, query: object) => Promise<DBDeleteSuccessResult | DBDeleteIssueResult>;
  
  // Allow any other property/method
  [key: string]: unknown;
};

export type DBSuccessResult = {
  success: true;
  data: unknown;
};

export type DBIssueResult = {
  success: false;
  issueType: string;
  message: string;
};

export type DBInsertionItemSuccessResult = DBSuccessResult & {
  data: string;
};

export type DBInsertItemIssueResult = DBIssueResult;

export type DBInsertItemsSuccessResult = DBSuccessResult & {
  data: string[];
  insertedIndexIdMap: Record<number, string>;
};

export type insertErrorInfo = {index: number, code: string, message: string};

export type DBInsertItemsIssueResult = DBIssueResult & {
  data: (string | null)[];
  insertedCount: number;
  insertedIndexIdMap: Record<number, string>;
  errors: insertErrorInfo[];
};

export type DBGetItemSuccessResult = DBSuccessResult;

export type DBGetItemIssueResult = DBIssueResult;

export type DBFindItemsSuccessResult = DBSuccessResult & {
  data: unknown[];
};

export type DBFindItemsIssueResult = DBIssueResult;

export type DBUpdateItemSuccessResult = DBSuccessResult & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: null | string;
};

export type DBUpdateItemIssueResult = DBIssueResult & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: null | string;
};

type DBUpdateItemsSuccessResult = DBSuccessResult & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedIds: (null | string)[];
};

export type DBUpdateItemsIssueResult = DBIssueResult & {
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

