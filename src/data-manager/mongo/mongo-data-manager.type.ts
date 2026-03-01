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
type MongoManagerModule = {
  addOneItem: (collection: string, item: object) => Promise<DBInsertionSuccessResult | DBInsertionIssueResult>;
  addMultipleItems: (collection: string, items: object[]) => Promise<DBInsertionsSuccessResult | DBInsertionsIssueResult>;
  getOneItem: (collection: string, id: string) => Promise<DBGetItemSuccessResult | DBGetItemIssueResult>;
  findItems: (collection: string, query: object) => Promise<DBFindItemsSuccessResult | DBFindItemsIssueResult>;
  updateOneItem: (collection: string, id: string, update: object) => Promise<DBUpdateItemSuccessResult | DBUpdateItemIssueResult>;
  updateItems: (collection: string, query: object, update: object) => Promise<DBUpdateItemsSuccessResult | DBUpdateItemsIssueResult>;
  removeOneItem: (collection: string, id: string) => Promise<DBDeleteSuccessResult | DBDeleteIssueResult>;
  removeItems: (collection: string, query: object) => Promise<DBDeleteSuccessResult | DBDeleteIssueResult>;
};

type DBSuccessResult = {
  success: true;
  data: object;
};

type DBIssueResult = {
  success: false;
  issueType: string;
  message: string;
};

type DBInsertionSuccessResult = DBSuccessResult & {
  data: string;
};

type DBInsertionIssueResult = DBIssueResult;

type DBInsertionsSuccessResult = DBSuccessResult & {
  data: string[];
  insertedIndexIdMap: Record<number, string>;
};

type insertErrorInfo = {index: number, code: string, message: string};


type DBInsertionsIssueResult = DBIssueResult & {
  data: (string | null)[];
  insertedCount: number;
  insertedIndexIdMap: Record<number, string>;
  errors: insertErrorInfo[];
};

type DBGetItemSuccessResult = DBSuccessResult;

type DBGetItemIssueResult = DBIssueResult;

type DBFindItemsSuccessResult = DBSuccessResult;

type DBFindItemsIssueResult = DBIssueResult;

type DBUpdateItemSuccessResult = DBSuccessResult & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: null | string;
};

type DBUpdateItemIssueResult = DBIssueResult & {
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

type DBUpdateItemsIssueResult = DBIssueResult & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedIds: (null | string)[];
};

type DBDeleteSuccessResult = DBSuccessResult & {
  deletedCount: number;
};

type DBDeleteIssueResult = DBIssueResult & {
  deletedCount: number;
};

