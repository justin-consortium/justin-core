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
export type MongoManagerContract = {
  
  /**
   * Adds a single item to the specified collection in the database.
   *
   * @template T The type of the item to insert.
   * @param {string} collection - The name of the collection to insert into.
   * @param {object} item - The item to add to the collection.
   * @returns {Promise<DBAddItemSuccessResult<T> | DBAddItemIssueResult>} Resolves with a success result containing the id of the matched document in the `data` property, or an issue result if issues are encountered.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing required fields, wrong type).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., Node.js MongoDB driver); such errors are caught, logged, and re-thrown.
   * @remarks
   * This method uses the {@link https://mongodb.github.io/node-mongodb-native/7.1/classes/Collection.html#insertOne | insertOne()} method from the MongoDB Node.js driver to perform the insertion.
   */
  addOneItem<T = string>(collection: string, item: object): Promise<DBAddItemSuccessResult<T> | DBAddItemIssueResult>;

  
  /**
   * Adds multiple items to the specified collection in the database.
   *
   * @template T The type of the items to insert.
   * @param {string} collection - The name of the collection to insert into.
   * @param {object[]} items - The array of items to add to the collection.
  * @returns {Promise<DBAddItemsSuccessResult<T> | DBAddItemsIssueResult<T>>} Resolves with a success result containing the added item IDs in the `data` property, or an issue result if issues are encountered.
  *
  *   - For {@link DBAddItemsSuccessResult}, the `data` property contains the array of inserted ids.
  *   - For {@link DBAddItemsIssueResult}, the `data` property contains an array where each element is the id for a successful insertion, or `null` for insertions that failed.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing required fields, wrong type).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., Node.js MongoDB driver); such errors are caught, logged, and re-thrown.
   *
  * @remarks
  * This method uses the {@link https://mongodb.github.io/node-mongodb-native/7.1/classes/Collection.html#insertMany | insertMany()} function from the MongoDB Node.js driver to perform the insertion.
  *
  * If the Node.js MongoDB driver throws a `MongoBulkWriteError`, the implementation processes the error and includes messages for each error in the `errors` array of the returned {@link DBAddItemIssueResult}.
   */
  addMultipleItems<T = (string | null)[]>(collection: string, items: object[]): Promise<DBAddItemsSuccessResult<T> | DBAddItemsIssueResult<T>>;


  /**
   * Retrieves a single item from the specified collection by its ID.
   *
   * @template T The type of the returned document.
   * @param {string} collection - The name of the collection to query.
   * @param {string} id - The ID of the document to retrieve.
   * @returns {Promise<DBGetItemSuccessResult<T> | DBGetItemIssueResult>} Resolves with a success result containing the id of the matched document in the `data` property, or an issue result if no document is found.
   * 
   *  - For {@link DBGetItemSuccessResult}, the `data` property contains the matched document.
   *  - For {@link DBGetItemIssueResult}, the `data` property is `undefined`.
   * @throws {Error} If the input is erroneous or invalid (e.g., missing or malformed ID).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., Node.js MongoDB driver); such errors are caught, logged, and re-thrown.
   *
   * @remarks
   * This method uses the {@link https://www.mongodb.com/docs/manual/reference/method/db.collection.findOne/ | findOne()} function from the MongoDB Node.js driver to perform the query.
   */
  getOneItem<T = unknown>(collection: string, id: string): Promise<DBGetItemSuccessResult<T> | DBGetItemIssueResult>;
  
  /**
   * Finds items in the specified collection matching the given query.
   *
   * @template T The type of the returned documents array.
   * @param {string} collection - The name of the collection to query.
   * @param {object} query - The filter object to match documents.
   * @returns {Promise<DBFindItemsSuccessResult<T> | DBFindItemsIssueResult>} Resolves with a success result containing the matched documents in the `data` property (empty array if nothing matched), or an issue result if issues occurred.
   *
   *   - For {@link DBFindItemsSuccessResult}, the `data` property contains the array of matched documents (empty if no matches).
   *   - For {@link DBFindItemsIssueResult}, the `data` property is `undefined`.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing or malformed query).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., Node.js MongoDB driver); such errors are caught, logged, and re-thrown.
   */
  findItems<T = unknown[]>(collection: string, query: object): Promise<DBFindItemsSuccessResult<T> | DBFindItemsIssueResult>;


  
  /**
   * Updates a single item in the specified collection by its ID.
   *
   * @template T The type of the updated document.
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
   * @throws {Error} If an error occurs in the lower data layer (e.g., Node.js MongoDB driver); such errors are caught, logged, and re-thrown.
   *
   * @remarks
   * This method uses the {@link https://mongodb.github.io/node-mongodb-native/7.1/classes/Collection.html#updateOne | updateOne()} function from the MongoDB Node.js driver to perform the update.
   */
  updateOneItem<T = unknown>(collection: string, id: string, update: Record<string, unknown>): Promise<DBUpdateItemSuccessResult<T> | DBUpdateItemIssueResult<T>>;


  
  /**
   * Updates multiple items in the specified collection matching the given query.
   *
   * @template T The type of the updated documents array.
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
   * @throws {Error} If an error occurs in the lower data layer (e.g., Node.js MongoDB driver); such errors are caught, logged, and re-thrown.
   *
   * @remarks
   * Consider using the {@link https://mongodb.github.io/node-mongodb-native/7.1/classes/Collection.html#bulkWrite | collection.bulkWrite()} function or the {@link https://mongodb.github.io/node-mongodb-native/7.1/classes/Collection.html#updateMany | updateMany()} function from the MongoDB Node.js driver to perform the update.
   */
  updateItems<T = unknown[]>(collection: string, query: object, update: Record<string, unknown>): Promise<DBUpdateItemsSuccessResult<T> | DBUpdateItemsIssueResult<T>>;


  /**
   * Removes a single item from the specified collection by its ID.
   *
   * @param {string} collection - The name of the collection to remove from.
   * @param {string} id - The ID of the document to remove.
   * @returns {Promise<DBRemoveSuccessResult | DBRemoveIssueResult>} Resolves with a success result if the operation was acknowledged, or an issue result if an error occurred.
   *
   *   - For {@link DBRemoveSuccessResult}, the `data` property contains the removed document. Success means the operation was acknowledged (`acknowledged === true`).
   *   - For {@link DBRemoveIssueResult}, the `data` property is `undefined`.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing or malformed ID).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., Node.js MongoDB driver); such errors are caught, logged, and re-thrown.
   *
   * @remarks
   * Consider using the {@link https://mongodb.github.io/node-mongodb-native/7.1/classes/Collection.html#deleteOne | deleteOne()} function from the MongoDB Node.js driver to perform the removal.
   */
  removeOneItem(collection: string, id: string): Promise<DBRemoveSuccessResult | DBRemoveIssueResult>;
  
  
  /**
   * Removes multiple items from the specified collection matching the given query.
   *
   * @param {string} collection - The name of the collection to remove from.
   * @param {object} query - The filter object to match documents for removal.
   * @returns {Promise<DBRemoveSuccessResult | DBRemoveIssueResult>} Resolves with a success result if the operation was acknowledged, or an issue result if an error occurred.
   *
   *   - For {@link DBRemoveSuccessResult}, the `data` property contains the removed documents. Success means the operation was acknowledged (`acknowledged === true`).
   *   - For {@link DBRemoveIssueResult}, the `data` property is `undefined`.
   *
   * @throws {Error} If the input is erroneous or invalid (e.g., missing or malformed query).
   * @throws {Error} If the manager is not initialized.
   * @throws {Error} If an error occurs in the lower data layer (e.g., Node.js MongoDB driver); such errors are caught, logged, and re-thrown.
   *
   * @remarks
   * Consider using the {@link https://mongodb.github.io/node-mongodb-native/7.1/classes/Collection.html#deleteMany | deleteMany()} function from the MongoDB Node.js driver to perform the removal.
   */
  removeItems(collection: string, query: object): Promise<DBRemoveSuccessResult | DBRemoveIssueResult>;
  
  // Allow any other property/method
  [key: string]: unknown;
};

// TODO: remove MongoManagerExperimentalContract after discussion
export type MongoManagerExperimentalContract = {
  addOneItem<T = string>(collection: string, item: object): Promise<DBAddItemSuccessResult<T> | DBAddItemIssueResult>;
  addMultipleItems<T = (string | null)[]>(collection: string, items: object[]): Promise<DBAddItemsSuccessResult<T> | DBAddItemsIssueResult<T>>;
  
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

export type DBAddItemSuccessResult<T = string> = DBSuccessResult<T>;

export type DBAddItemIssueResult<T=undefined> = DBIssueResult<T>;

export type DBAddItemsSuccessResult<T = string[]> = DBSuccessResult<T> & {
  insertedCount: number;
  insertedIndexIdMap: Record<number, string>;
};

export type addErrorInfo = {index: number, code: string, message: string};

export type DBAddItemsIssueResult<T = (string | null)[]> = DBIssueResult & {
  data: T;
  insertedCount: number;
  insertedIndexIdMap: Record<number, string>;
  errors: addErrorInfo[];
};

export type DBGetItemSuccessResult<T> = DBSuccessResult<T>;

export type DBGetItemIssueResult<T=undefined>  = DBIssueResult<T>;

export type DBFindItemsSuccessResult<T = unknown[]> = DBSuccessResult<T>;

export type DBFindItemsIssueResult<T=undefined> = DBIssueResult<T>;

export type DBUpdateItemSuccessResult<T = unknown> = DBSuccessResult<T> & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: null | string;
};

export type DBUpdateItemIssueResult<T = undefined> = DBIssueResult<T> & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: null | string;
};

export type DBUpdateItemsSuccessResult<T = unknown[]> = DBSuccessResult<T> & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedIds: null | string;
};

export type DBUpdateItemsIssueResult<T = unknown[]> = DBIssueResult<T> & {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedIds: null | string;
};

export type DBRemoveSuccessResult<T=undefined> = DBSuccessResult<T> & {
  deletedCount: number;
};

export type DBRemoveIssueResult<T=undefined> = DBIssueResult<T> & {
  deletedCount: number;
};

