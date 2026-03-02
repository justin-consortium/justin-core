import { DBRemoveIssueResult, DBRemoveSuccessResult, DBFindItemsIssueResult, DBFindItemsSuccessResult, DBGetItemIssueResult, DBGetItemSuccessResult, DBAddItemIssueResult, DBAddItemsIssueResult, DBAddItemsSuccessResult, DBAddItemSuccessResult, DBUpdateItemIssueResult, DBUpdateItemsIssueResult, DBUpdateItemsSuccessResult, DBUpdateItemSuccessResult } from "../data-manager/mongo/mongo-data-manager.type";
import { JUser, NewUserRecord } from "./user.type";

export type AttributeMap = {
  [index: string]: any;
};

export type UserRecord = {
  id: string;
  attributes: object;
};

// types used for defining manager module/methods
export type UserManagerContract = {
  addOneItem<T = JUser>(collection: string, item: NewUserRecord): Promise<DBAddItemSuccessResult<T> | DBAddItemIssueResult>;
  addMultipleItems<T = (JUser | null)[]>(collection: string, items: NewUserRecord[]): Promise<DBAddItemsSuccessResult<T> | DBAddItemsIssueResult<T>>;

  getOneItem<T = JUser>(collection: string, id: string): Promise<DBGetItemSuccessResult<T> | DBGetItemIssueResult>;
  getOneItemByUniqueIdentifier<T = JUser>(collection: string, uniqueIdentifier: string): Promise<DBGetItemSuccessResult<T> | DBGetItemIssueResult>;
  
  findItems<T = (JUser | null)[]>(collection: string, query: object): Promise<DBFindItemsSuccessResult<T> | DBFindItemsIssueResult>;

  updateOneItem<T = JUser>(collection: string, id: string, update: Record<string, unknown>): Promise<DBUpdateItemSuccessResult<T> | DBUpdateItemIssueResult>;
  updateOneItemByUniqueIdentifier<T = JUser>(collection: string, uniqueIdentifier: string, update: Record<string, unknown>): Promise<DBUpdateItemSuccessResult<T> | DBUpdateItemIssueResult>;


  updateItems<T = (JUser | null)[]>(collection: string, query: object, update: Record<string, unknown>): Promise<DBUpdateItemsSuccessResult<T> | DBUpdateItemsIssueResult<T>>;
  
  
  removeOneItem(collection: string, id: string): Promise<DBRemoveSuccessResult | DBRemoveIssueResult>;
  removeOneItemByUniqueIdentifier(collection: string, uniqueIdentifier: string): Promise<DBRemoveSuccessResult | DBRemoveIssueResult>;

  removeItems(collection: string, query: object): Promise<DBRemoveSuccessResult | DBRemoveIssueResult>;
  
  // Allow any other property/method
  [key: string]: unknown;
};
