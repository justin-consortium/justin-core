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
   * @template T The type of the return data within the result. Defaults to `object` if not specified.
   * @param {string} collection - The name of the collection to insert into.
   * @param {object} item - The item to add to the collection.
   * @returns {Promise<DBAddItemSuccessResult<T> | DBAddItemIssueResult>} Resolves with the result of the insert operation.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing required fields, wrong type).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., [SpecificDB]Manager); such errors are caught, logged, and re-thrown.
   */
  addOneItem<T = object>(collection: string, item: object): Promise<DBAddItemSuccessResult<T> | DBAddItemIssueResult>;

    /**
   * Adds multiple items to the specified collection in the database.
   *
   * @template T The type of the return data within the result. Defaults to `(object | null)[]` if not specified, where each element is the item for successful insertions or `null` for failed insertions.
   * @param {string} collection - The name of the collection to insert into.
   * @param {object[]} items - The array of items to add to the collection.
  * @returns {Promise<DBAddItemsSuccessResult<T> | DBAddItemsIssueResult<T>>} Resolves with a success result containing the added items in the `data` property, or an issue result if issues are encountered.
  *
  *   - For {@link DBAddItemsSuccessResult}, the `data` property contains the array of inserted items.
  *   - For {@link DBAddItemsIssueResult}, the `data` property contains an array where each element is the item for a successful insertion, or `null` for insertions that failed.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing required fields, wrong type).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., [SpecificDB]Manager); such errors are caught, logged, and re-thrown.
   */
  addMultipleItems<T = (object | null)[]>(collection: string, items: object[]): Promise<DBAddItemsSuccessResult<T> | DBAddItemsIssueResult<T>>;

    /**
   * Retrieves a single item from the specified collection by its ID.
   *
   * @template T The type of the return data within the result. Defaults to `object` if not specified.
   * @param {string} collection - The name of the collection to query.
   * @param {string} id - The ID of the document to retrieve.
   * @returns {Promise<DBGetItemSuccessResult<T> | DBGetItemIssueResult>} Resolves with a success result containing the item in the `data` property, or an issue result if no document is found.
   * 
   *  - For {@link DBGetItemSuccessResult}, the `data` property contains the matched item.
   *  - For {@link DBGetItemIssueResult}, the `data` property is `undefined`.
   * @throws {Error} If the input is erroneous or invalid (e.g., missing or malformed ID).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., [SpecificDB]Manager); such errors are caught, logged, and re-thrown.
   */
  getOneItem<T = object>(collection: string, id: string): Promise<DBGetItemSuccessResult<T> | DBGetItemIssueResult>;

   /**
   * Finds items in the specified collection matching the given query.
   *
   * @template T The type of the return data within the result. Defaults to `(object | null)[]` if not specified, where each element is the matched item for successful matches or `null` for items that failed to match.
   * @param {string} collection - The name of the collection to query.
   * @param {object} query - The filter object to match documents.
   * @returns {Promise<DBFindItemsSuccessResult<T> | DBFindItemsIssueResult>} Resolves with a success result containing the matched items in the `data` property (empty array if nothing matched), or an issue result if issues occurred.
   *
   *   - For {@link DBFindItemsSuccessResult}, the `data` property contains the array of matched documents (empty if no matches).
   *   - For {@link DBFindItemsIssueResult}, the `data` property is `undefined`.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing or malformed query).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., [SpecificDB]Manager); such errors are caught, logged, and re-thrown.
   */
  findItems<T = (object | null)[]>(collection: string, query: object): Promise<DBFindItemsSuccessResult<T> | DBFindItemsIssueResult>;

    /**
   * Updates a single item in the specified collection by its ID.
   *
   * @template T The type of the return data within the result. Defaults to `object` if not specified.
   * @param {string} collection - The name of the collection to update.
   * @param {string} id - The ID of the document to update.
   * @param {Record<string, unknown>} update - The update object to apply.
   * @returns {Promise<DBUpdateItemSuccessResult<T> | DBUpdateItemIssueResult<T>>} Resolves with a success result containing the updated document in the `data` property if the update was successful, or an issue result if issues occurred.
   *
   *   - For {@link DBUpdateItemSuccessResult}, the `data` property contains the updated document. Success means the operation was acknowledged and either `upsertedCount === 1` or `matchedCount === 1`.
   *   - For {@link DBUpdateItemIssueResult}, the `data` property is `undefined`.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing or malformed ID or update object).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., [SpecificDB]Manager); such errors are caught, logged, and re-thrown.
   */
  updateOneItem<T = object>(collection: string, id: string, update: Record<string, unknown>): Promise<DBUpdateItemSuccessResult<T> | DBUpdateItemIssueResult>;


  // TODO: Do we support partial success? 
  /**
   * Updates multiple items in the specified collection matching the given query.
   *
   * @template T The type of the return data within the result. Defaults to `object[]` if not specified, where each element is the updated document for successful updates.
   * @param {string} collection - The name of the collection to update.
   * @param {object} query - The filter object to match documents.
   * @param {Record<string, unknown>} update - The update object to apply.
   * @returns {Promise<DBUpdateItemsSuccessResult<T> | DBUpdateItemsIssueResult<T>>} Resolves with a success result containing the updated documents in the `data` property if the update was successful, or an issue result if issues occurred.
   *
   *   - For {@link DBUpdateItemsSuccessResult}, the `data` property contains the updated documents. Success means the operation was acknowledged and either `upsertedCount === 1` or `matchedCount === 1`.
   *   - For {@link DBUpdateItemsIssueResult}, the `data` property is `undefined`.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing or malformed query or update object).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., [SpecificDB]Manager); such errors are caught, logged, and re-thrown.
   */
  updateItems<T = object[]>(collection: string, query: object, update: Record<string, unknown>): Promise<DBUpdateItemsSuccessResult<T> | DBUpdateItemsIssueResult<T>>;

  // TODO: do we want to return the removed document in the success case?
    /**
   * Removes a single item from the specified collection by its ID.
   *
   * @param {string} collection - The name of the collection to remove from.
   * @param {string} id - The ID of the document to remove.
   * @returns {Promise<DBRemoveSuccessResult | DBRemoveIssueResult>} Resolves with a success result if the operation was acknowledged, or an issue result if an error occurred.
   *
   *   - For {@link DBRemoveSuccessResult}, the `data` property is `undefined`.
   *   - For {@link DBRemoveIssueResult}, the `data` property is `undefined`.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing or malformed ID).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., [SpecificDB]Manager); such errors are caught, logged, and re-thrown.
  */
  removeOneItem(collection: string, id: string): Promise<DBRemoveSuccessResult | DBRemoveIssueResult>;

  /**
   * Removes multiple items from the specified collection matching the given query.
   *
   * @param {string} collection - The name of the collection to remove from.
   * @param {object} query - The filter object to match documents for removal.
   * @returns {Promise<DBRemoveSuccessResult | DBRemoveIssueResult>} Resolves with a success result if the operation was acknowledged, or an issue result if an error occurred.
   *
   *   - For {@link DBRemoveSuccessResult}, the `data` property is `undefined`.
   *   - For {@link DBRemoveIssueResult}, the `data` property is `undefined`.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing or malformed query).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., [SpecificDB]Manager); such errors are caught, logged, and re-thrown.
   *
   * @remarks
   * Consider using the {@link https://mongodb.github.io/node-mongodb-native/7.1/classes/Collection.html#deleteMany | deleteMany()} function from the MongoDB Node.js driver to perform the removal.
   */
  removeItems(collection: string, query: object): Promise<DBRemoveSuccessResult | DBRemoveIssueResult>;
  
  // Allow any other property/method
  [key: string]: unknown;
};