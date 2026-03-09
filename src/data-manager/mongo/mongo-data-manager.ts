import * as mongoDB from 'mongodb';
import { Readable } from 'stream';
import { CollectionChangeType } from '../types';
import { NO_ID } from '../constants';
import { DeletedDocRecord, InsertedOrUpatedDocRecord, WithId } from './mongo-data-manager.type';
import { handleDbError } from '../helpers';
import { stringToMongoId, asIndexKey, normalizeIndexKey, transformId } from './mongo.helpers';
import { DEFAULT_DB_NAME, DEFAULT_MONGO_URI } from './mongo.constants';
import { createLogger } from '../../logger';

const Log = createLogger({
  context: {
    source: 'mongo-data-manager',
  },
});

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _client: mongoDB.MongoClient | null = null;
let _db: mongoDB.Db | null = null;
let _isConnected = false;

// ---------------------------------------------------------------------------
// Test-only internal setters
// ---------------------------------------------------------------------------

/**
 * Test-only helper to override the MongoDB client instance.
 * @internal
 */
const _setClient = (client: mongoDB.MongoClient): void => {
  _client = client;
};

/**
 * Test-only helper to override the MongoDB database instance.
 * @internal
 */
const _setDatabaseInstance = (db: mongoDB.Db): void => {
  _db = db;
};

/**
 * Test-only helper to override the internal connection flag.
 * @internal
 */
const _setIsConnected = (isConnected: boolean): void => {
  _isConnected = isConnected;
};

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

/**
 * Ensures the MongoDB client and database are initialized.
 *
 * @throws {Error} If the Mongo client, database, or connection flag are not set.
 * @internal
 */
const ensureInitialized = (): void => {
  if (!_isConnected || !_db || !_client) {
    throw new Error('MongoDBManager not initialized. Call init() first.');
  }
};

/**
 * Initializes the MongoDB connection.
 *
 * Uses the provided URI and database name, or falls back to
 * {@link DEFAULT_MONGO_URI} and {@link DEFAULT_DB_NAME}.
 * Subsequent calls are no-ops once connected.
 *
 * @param uri - Connection string for MongoDB. Defaults to {@link DEFAULT_MONGO_URI}.
 * @param dbName - Database name. Defaults to {@link DEFAULT_DB_NAME}.
 * @returns A promise that resolves when the connection is established.
 * @throws {Error} If the connection or database selection fails.
 */
const init = async (
  uri: string = DEFAULT_MONGO_URI,
  dbName: string = DEFAULT_DB_NAME,
): Promise<void> => {
  if (_isConnected) return;

  try {
    _client = new mongoDB.MongoClient(uri);
    await _client.connect();
    _db = _client.db(dbName);
    _isConnected = true;
    Log.debug(`Mongo connected: db=${dbName}`);
  } catch (error) {
    Log.error('Mongo connection failed', error);
    throw error;
  }
};

/**
 * Closes the MongoDB connection, if any.
 *
 * Safe to call multiple times; subsequent calls after the first
 * will be no-ops once the client reference is cleared.
 *
 * @returns A promise that resolves when the client is closed.
 */
const close = async (): Promise<void> => {
  if (!_client) return;
  try {
    await _client.close();
  } finally {
    _isConnected = false;
    _db = null;
    _client = null;
  }
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Ensures a collection exists; optionally applies a validator via `collMod`.
 *
 * This method is idempotent:
 * - Creates the collection if it does not exist.
 * - Applies the provided JSON schema validator on top of an existing collection,
 *   best-effort (warnings are logged but not thrown).
 *
 * @param collectionName - Target collection name.
 * @param options - Optional validator configuration.
 * @throws {Error} If the MongoDBManager has not been initialized or the operation fails.
 */
const ensureStore = async (
  collectionName: string,
  options?: { validator?: mongoDB.Document },
): Promise<void> => {
  ensureInitialized();

  const exists = await _db!.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();

  if (!exists) {
    try {
      await _db!.createCollection(collectionName);
      Log.debug(`Created collection ${collectionName}`);
    } catch (err: any) {
      // Tolerate concurrent creation races.
      if (err?.codeName !== 'NamespaceExists') throw err;
    }
  }

  if (options?.validator) {
    try {
      await _db!.command({
        collMod: collectionName,
        validator: options.validator,
      });
      Log.debug(`Applied validator to ${collectionName}`);
    } catch (err) {
      Log.warn(`collMod failed for ${collectionName}`, err);
    }
  }
};

/**
 * Ensures indexes exist on a collection. Idempotent by name and by key.
 *
 * Existing indexes are discovered and compared by:
 * - Name (if provided).
 * - Canonicalized key signature via {@link normalizeIndexKey}.
 *
 * Only missing indexes are created.
 *
 * @param collectionName - Target collection.
 * @param indexes - Index models to ensure.
 * @throws {Error} If the MongoDBManager has not been initialized or the operation fails.
 */
const ensureIndexes = async (
  collectionName: string,
  indexes: Array<{
    name?: string;
    key: mongoDB.IndexSpecification;
    unique?: boolean;
    partialFilterExpression?: mongoDB.Document;
  }>,
): Promise<void> => {
  ensureInitialized();
  if (!indexes?.length) return;

  const coll = _db!.collection(collectionName);
  const existing = await coll.listIndexes().toArray();
  const byName = new Set<string>(existing.map((i: any) => String(i.name)));
  const keySigs = new Set<string>(
    existing.map((i: any) => normalizeIndexKey(i.key as mongoDB.IndexSpecification)),
  );

  const createModels: mongoDB.IndexDescription[] = [];

  for (const spec of indexes) {
    const key = asIndexKey(spec.key);
    const sig = normalizeIndexKey(key as mongoDB.IndexSpecification);
    const name = spec.name;

    if (name && byName.has(name)) continue;
    if (keySigs.has(sig)) continue;

    const model: mongoDB.IndexDescription = {
      key: key as any,
      ...(name ? { name } : null),
      ...(spec.unique ? { unique: true } : null),
      ...(spec.partialFilterExpression
        ? { partialFilterExpression: spec.partialFilterExpression }
        : null),
    } as mongoDB.IndexDescription;

    createModels.push(model);
  }

  if (!createModels.length) return;

  await coll.createIndexes(createModels);
  Log.debug(
    `Created ${createModels.length} index(es) on ${collectionName}: ${createModels
      .map((m) => m.name || JSON.stringify(m.key))
      .join(', ')}`,
  );
};

// ---------------------------------------------------------------------------
// Change streams
// ---------------------------------------------------------------------------

/**
 * Creates a readable stream of collection change events for a specific
 * collection and change type, backed by a MongoDB change stream.
 *
 * The resulting {@link Readable} emits normalized documents:
 *
 * - For {@link CollectionChangeType.DELETE}, an object with just `id`.
 * - For inserts/updates, a document passed through {@link transformId}.
 *
 * The readable has a `cleanup()` method attached (as a dynamic property)
 * that will close the underlying change stream when invoked.
 *
 * @param collectionName - The collection to watch.
 * @param changeType - The type of change to observe (insert, update, delete).
 * @returns A readable stream of normalized change payloads.
 * @throws {Error} If the MongoDBManager has not been initialized.
 */
const getCollectionChangeReadable = (
  collectionName: string,
  changeType: CollectionChangeType,
): Readable => {
  ensureInitialized();

  const filterList = [{ $match: { operationType: changeType } }];
  const options =
    changeType === CollectionChangeType.UPDATE ? { fullDocument: 'updateLookup' } : {};

  const changeStream = _db!.collection(collectionName).watch(filterList, options as any);

  const collectionChangeReadable = new Readable({
    objectMode: true,
    read() {
      /* no-op */
    },
  });

  changeStream.on('change', (nextDoc: DeletedDocRecord | InsertedOrUpatedDocRecord) => {
    let normalizedDoc;
    if (changeType === CollectionChangeType.DELETE) {
      normalizedDoc = {
        id: (nextDoc as DeletedDocRecord).documentKey._id?.toString() || NO_ID,
      };
    } else {
      normalizedDoc = transformId((nextDoc as InsertedOrUpatedDocRecord).fullDocument);
    }
    collectionChangeReadable.push(normalizedDoc);
  });

  changeStream.on('error', (error) => {
    Log.error('Change stream error', error);
    collectionChangeReadable.destroy(error);
  });

  // Attach a cleanup hook so higher layers can explicitly close the stream.
  (collectionChangeReadable as any).cleanup = async () => {
    try {
      await changeStream.close();
    } catch {
      /* swallow */
    }
  };

  return collectionChangeReadable;
};

// ---------------------------------------------------------------------------
// Find
// ---------------------------------------------------------------------------

/**
 * Finds a single item by Mongo `_id` in the given collection.
 *
 * The returned document has `_id` transformed into a string `id`
 * via {@link transformId}. Returns `null` if no document is found.
 *
 * @param collectionName - Target collection name.
 * @param id - String representation of the `_id`.
 * @returns A normalized document or `null` if not found.
 * @throws {Error} If the id is not a valid ObjectId, the MongoDBManager has not been
 * initialized, or the query fails.
 */
const findItemByIdInCollection = async (
  collectionName: string,
  id: string,
): Promise<object | null> => {
  ensureInitialized();
  const objectId = stringToMongoId(id);

  try {
    const foundDoc = await _db!.collection(collectionName).findOne({ _id: objectId });
    return transformId(foundDoc);
  } catch (error) {
    return handleDbError(
      `Error finding item with id ${id} in ${collectionName}`,
      'findItemByIdInCollection',
      error,
    );
  }
};

/**
 * Finds items in a collection matching the given filter.
 *
 * All results are normalized via {@link transformId} to expose
 * an `id` string field instead of `_id`.
 *
 * @param collectionName - Target collection name.
 * @param filter - MongoDB filter object.
 * @returns An array of normalized documents.
 * @throws {Error} If the MongoDBManager has not been initialized or the query fails.
 */
const findItemsInCollection = async (collectionName: string, filter: object): Promise<object[]> => {
  ensureInitialized();

  try {
    const cursor = _db!.collection(collectionName).find(filter);
    const results = await cursor.toArray();
    return results.map(transformId);
  } catch (error) {
    return handleDbError(
      `Error finding items in ${collectionName} with filter ${JSON.stringify(filter)}`,
      'findItemsInCollection',
      error,
    );
  }
};

/**
 * Finds multiple items by ID in a single `find` call.
 *
 * All ids must be valid ObjectIds — any invalid id throws immediately
 * and the query is not issued. Results are normalized via {@link transformId}.
 * Order of results is not guaranteed to match the input order.
 *
 * @param collectionName - Target collection name.
 * @param ids - String representations of the `_id` values to find.
 * @returns Normalized documents for all ids that were found.
 * @throws {Error} If any id is not a valid ObjectId, the MongoDBManager has not been
 * initialized, or the query fails.
 */
const findItemsByIdsInCollection = async (
  collectionName: string,
  ids: string[],
): Promise<object[]> => {
  ensureInitialized();

  if (!Array.isArray(ids) || ids.length === 0) return [];

  // stringToMongoId throws on invalid id — any bad id aborts the whole operation.
  const objectIds = ids.map((id) => stringToMongoId(id));

  try {
    const results = await _db!
      .collection(collectionName)
      .find({ _id: { $in: objectIds } })
      .toArray();
    return results.map(transformId);
  } catch (error) {
    return handleDbError(
      `Error finding items by ids in ${collectionName}`,
      'findItemsByIdsInCollection',
      error,
    );
  }
};

/**
 * Retrieves all items from a collection.
 *
 * Returns an array of documents with `_id` normalized to `id` via {@link transformId}.
 *
 * @param collectionName - Target collection name.
 * @returns An array of normalized documents.
 * @throws {Error} If the MongoDBManager has not been initialized or the query fails.
 */
const getAllInCollection = async (collectionName: string): Promise<object[]> => {
  ensureInitialized();

  try {
    const results = await _db!.collection(collectionName).find({}).toArray();
    return results.map(transformId);
  } catch (error) {
    return handleDbError(
      `Error getting all items in ${collectionName}`,
      'getAllInCollection',
      error,
    );
  }
};

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

/**
 * Inserts an item into a collection and returns the stringified Mongo `_id`.
 *
 * Any existing `id` or `_id` fields on the input object are stripped before
 * insertion so that MongoDB remains the single source of truth for the primary key.
 *
 * @param collectionName - Target collection name.
 * @param item - The object to insert.
 * @returns The inserted `_id` as a string.
 * @throws {Error} If the MongoDBManager has not been initialized or the insert fails.
 */
const addItemToCollection = async (collectionName: string, item: object): Promise<string> => {
  ensureInitialized();

  const { id, _id, ...filteredObject } = item as WithId;

  try {
    const { insertedId } = await _db!.collection(collectionName).insertOne(filteredObject);

    Log.debug(`Item added to ${collectionName}`, { id: insertedId.toString() });

    return insertedId.toString();
  } catch (error) {
    return handleDbError(
      `Error inserting item into ${collectionName}`,
      'addItemToCollection',
      error,
    );
  }
};

/**
 * Inserts multiple items into a collection and returns the inserted ids.
 *
 * Any existing `id` or `_id` fields on the input objects are stripped before insertion.
 *
 * @param collectionName - Target collection name.
 * @param items - The objects to insert.
 * @returns Inserted `_id` values as strings.
 * @throws {Error} If the MongoDBManager has not been initialized or the insert fails.
 */
const addItemsToCollection = async (collectionName: string, items: object[]): Promise<string[]> => {
  ensureInitialized();

  if (!Array.isArray(items) || items.length === 0) return [];

  const filtered = items.map((item) => {
    const { id, _id, ...rest } = item as WithId;
    return rest;
  });

  try {
    const result = await _db!.collection(collectionName).insertMany(filtered, { ordered: true });
    const ids = Object.values(result.insertedIds).map((oid) => oid.toString());

    Log.debug(`Items added to ${collectionName}`, { count: ids.length });

    return ids;
  } catch (error) {
    return handleDbError(
      `Error inserting many items into ${collectionName}`,
      'addItemsToCollection',
      error,
    );
  }
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Updates an item by ID in a collection and returns the updated document.
 *
 * The update is applied as `$set` on the provided `item` object.
 * The returned document is normalized via {@link transformId}.
 * Returns `null` if no document matched the given id.
 *
 * @param collectionName - Target collection name.
 * @param id - String representation of the `_id`.
 * @param item - Partial document to `$set`.
 * @returns The updated and normalized document, or `null` if not found.
 * @throws {Error} If the id is not a valid ObjectId, the MongoDBManager has not been
 * initialized, or the update fails.
 */
const updateItemInCollection = async (
  collectionName: string,
  id: string,
  item: object,
): Promise<object | null> => {
  ensureInitialized();
  const objectId = stringToMongoId(id);

  try {
    const coll = _db!.collection(collectionName);
    const { matchedCount, modifiedCount } = await coll.updateOne({ _id: objectId }, { $set: item });

    if (matchedCount !== 1) {
      Log.warn(`Update failed for item with id ${id} in ${collectionName}: no match`);
      return null;
    }

    if (modifiedCount === 0) {
      Log.warn(`No changes made for item with id ${id} in ${collectionName}`);
    }

    const updatedDoc = await coll.findOne({ _id: objectId });
    return transformId(updatedDoc);
  } catch (error) {
    return handleDbError(
      `Error updating item with id ${id} in ${collectionName}`,
      'updateItemInCollection',
      error,
    );
  }
};

/**
 * Updates multiple items in a collection by ID in a single `bulkWrite` call.
 *
 * All ids must be valid ObjectIds — any invalid id throws immediately
 * and no updates are issued. The `update` object is applied as `$set`
 * on each matched document.
 *
 * @param collectionName - Target collection name.
 * @param updates - Array of `{ id, update }` pairs.
 * @returns Number of documents actually modified.
 * @throws {Error} If any id is not a valid ObjectId, the MongoDBManager has not been
 * initialized, or the operation fails.
 */
const updateItemsInCollection = async (
  collectionName: string,
  updates: Array<{ id: string; update: object }>,
): Promise<number> => {
  ensureInitialized();

  if (!Array.isArray(updates) || updates.length === 0) return 0;

  // stringToMongoId throws on invalid id — any bad id aborts the whole operation.
  const ops: mongoDB.AnyBulkWriteOperation[] = updates.map(({ id, update }) => ({
    updateOne: { filter: { _id: stringToMongoId(id) }, update: { $set: update } },
  }));

  try {
    const result = await _db!.collection(collectionName).bulkWrite(ops, { ordered: false });
    Log.debug(`Bulk updated ${result.modifiedCount} item(s) in ${collectionName}`);
    return result.modifiedCount;
  } catch (error) {
    return handleDbError(
      `Error bulk-updating items in ${collectionName}`,
      'updateItemsInCollection',
      error,
    );
  }
};

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

/**
 * Removes a single item by ID from a collection.
 *
 * Returns the number of documents deleted (1 if deleted, 0 if not found).
 *
 * @param collectionName - Target collection name.
 * @param id - String representation of the `_id`.
 * @returns Number of documents deleted (0 or 1).
 * @throws {Error} If the id is not a valid ObjectId, the MongoDBManager has not been
 * initialized, or the operation fails.
 */
const removeItemFromCollection = async (collectionName: string, id: string): Promise<number> => {
  ensureInitialized();
  const objectId = stringToMongoId(id);

  try {
    const { deletedCount } = await _db!
      .collection(collectionName)
      .deleteOne({ _id: objectId });

    if (deletedCount === 0) {
      Log.warn(`No deletion made for item with id ${id} in ${collectionName}: not found.`);
    }

    return deletedCount;
  } catch (error) {
    return handleDbError(
      `Error removing item with id ${id} from ${collectionName}`,
      'removeItemFromCollection',
      error,
    );
  }
};

/**
 * Removes multiple items from a collection by ID in a single `deleteMany` call.
 *
 * All ids must be valid ObjectIds — any invalid id throws immediately
 * and no deletes are issued. Partial success (some ids not found) is acceptable
 * and returns the count of documents actually deleted.
 *
 * @param collectionName - Target collection name.
 * @param ids - String representations of the `_id` values to delete.
 * @returns Number of documents actually deleted.
 * @throws {Error} If any id is not a valid ObjectId, the MongoDBManager has not been
 * initialized, or the operation fails.
 */
const removeItemsFromCollection = async (
  collectionName: string,
  ids: string[],
): Promise<number> => {
  ensureInitialized();

  if (!Array.isArray(ids) || ids.length === 0) return 0;

  // stringToMongoId throws on invalid id — any bad id aborts the whole operation.
  const objectIds = ids.map((id) => stringToMongoId(id));

  try {
    const { deletedCount } = await _db!
      .collection(collectionName)
      .deleteMany({ _id: { $in: objectIds } });

    if (deletedCount < ids.length) {
      Log.warn(
        `Bulk remove from ${collectionName}: requested ${ids.length}, deleted ${deletedCount}`,
      );
    }

    Log.debug(`Bulk removed ${deletedCount} item(s) from ${collectionName}`);
    return deletedCount;
  } catch (error) {
    return handleDbError(
      `Error bulk-removing items from ${collectionName}`,
      'removeItemsFromCollection',
      error,
    );
  }
};

/**
 * Clears all items in a collection using `deleteMany({})`.
 *
 * Returns `true` if the operation was acknowledged by MongoDB.
 *
 * @param collectionName - Target collection name.
 * @returns `true` if the operation was acknowledged.
 * @throws {Error} If the MongoDBManager has not been initialized or the operation fails.
 */
const clearCollection = async (collectionName: string): Promise<boolean> => {
  ensureInitialized();

  try {
    const { acknowledged } = await _db!.collection(collectionName).deleteMany({});
    return acknowledged;
  } catch (error) {
    return handleDbError(`Error clearing collection ${collectionName}`, 'clearCollection', error);
  }
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Checks if a collection is empty.
 *
 * Uses a `countDocuments` call with `limit: 1` for efficiency.
 *
 * @param collectionName - Target collection name.
 * @returns `true` if the collection contains zero documents, `false` otherwise.
 * @throws {Error} If the MongoDBManager has not been initialized or the operation fails.
 */
const isCollectionEmpty = async (collectionName: string): Promise<boolean> => {
  ensureInitialized();

  try {
    const count = await _db!.collection(collectionName).countDocuments({}, { limit: 1 });
    return count === 0;
  } catch (error) {
    return handleDbError(
      `Error counting documents in ${collectionName}`,
      'isCollectionEmpty',
      error,
    );
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Thin Mongo adapter used internally by the {@link DataManager}.
 *
 * This module is not re-exported from the package entry; higher-level
 * code should depend on the adapter-agnostic `DataManager` instead.
 */
export const MongoDBManager = {
  // connection lifecycle
  init,
  close,
  ensureInitialized,

  // schema
  ensureStore,
  ensureIndexes,

  // change streams
  getCollectionChangeReadable,

  // find
  findItemByIdInCollection,
  findItemsInCollection,
  findItemsByIdsInCollection,
  getAllInCollection,

  // add
  addItemToCollection,
  addItemsToCollection,

  // update
  updateItemInCollection,
  updateItemsInCollection,

  // remove
  removeItemFromCollection,
  removeItemsFromCollection,
  clearCollection,

  // utility
  isCollectionEmpty,
};

/**
 * Test-only variant of {@link MongoDBManager} that exposes
 * internal setters for dependency injection.
 *
 * Not exported from the package entry.
 *
 * @internal
 */
export const TestingMongoDBManager = {
  ...MongoDBManager,
  _setDatabaseInstance,
  _setClient,
  _setIsConnected,
};
