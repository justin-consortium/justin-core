import * as mongoDB from "mongodb";
import { Readable } from "stream";
import { CollectionChangeType } from "../data-manager.type";
import { NO_ID } from "../data-manager.constants";
import {
  DeletedDocRecord,
  InsertedOrUpatedDocRecord,
  WithId,
} from "./mongo-data-manager.type";
import { Log } from "../../logger/logger-manager";
import { handleDbError } from "../data-manager.helpers";
import {
  toObjectId,
  asIndexKey,
  normalizeIndexKey,
  transformId,
} from "./mongo.helpers";
import { DEFAULT_DB_NAME, DEFAULT_MONGO_URI } from "./mongo.constants";

let _client: mongoDB.MongoClient | null = null;
let _db: mongoDB.Db | null = null;
let _isConnected = false;

/** Internal setters for tests */
const _setClient = (client: mongoDB.MongoClient): void => {
  _client = client;
};
const _setDatabaseInstance = (db: mongoDB.Db): void => {
  _db = db;
};
const _setIsConnected = (isConnected: boolean): void => {
  _isConnected = isConnected;
};

const ensureInitialized = (): void => {
  if (!_isConnected || !_db || !_client) {
    throw new Error("MongoDBManager not initialized. Call init() first.");
  }
};

/**
 * Initializes the MongoDB connection.
 *
 * @param uri - Connection string (defaults to localhost).
 * @param dbName - Database name (defaults to "justin").
 */
const init = async (
  uri: string = DEFAULT_MONGO_URI,
  dbName: string = DEFAULT_DB_NAME
): Promise<void> => {
  if (_isConnected) return;
  try {
    _client = new mongoDB.MongoClient(uri);
    await _client.connect();
    _db = _client.db(dbName);
    _isConnected = true;
    Log.dev(`Mongo connected: db=${dbName}`);
  } catch (error) {
    Log.error("Mongo connection failed", error);
    throw error;
  }
};

/**
 * Closes the MongoDB connection.
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

const getCollectionChangeReadable = (
  collectionName: string,
  changeType: CollectionChangeType
): Readable => {
  ensureInitialized();

  const filterList = [{ $match: { operationType: changeType } }];
  const options =
    changeType === CollectionChangeType.UPDATE
      ? { fullDocument: "updateLookup" }
      : {};

  const changeStream = _db!
    .collection(collectionName)
    .watch(filterList, options as any);

  const collectionChangeReadable = new Readable({
    objectMode: true,
    read() {
      /* no-op */
    },
  });

  changeStream.on(
    "change",
    (nextDoc: DeletedDocRecord | InsertedOrUpatedDocRecord) => {
      let normalizedDoc;
      if (changeType === CollectionChangeType.DELETE) {
        normalizedDoc = {
          id: (nextDoc as DeletedDocRecord).documentKey._id?.toString() || NO_ID,
        };
      } else {
        normalizedDoc = transformId(
          (nextDoc as InsertedOrUpatedDocRecord).fullDocument
        );
      }
      collectionChangeReadable.push(normalizedDoc);
    }
  );

  changeStream.on("error", (error) => {
    Log.error("Change stream error", error);
    collectionChangeReadable.destroy(error);
  });

  (collectionChangeReadable as any).cleanup = async () => {
    try {
      await changeStream.close();
    } catch {
      /* swallow */
    }
  };

  return collectionChangeReadable;
};

/**
 * Ensures a collection exists; optionally applies a validator via `collMod`.
 * Idempotent; safe to call repeatedly.
 *
 * @param collectionName - Target collection name.
 * @param options - Optional `{ validator }` JSON Schema (best-effort).
 */
const ensureStore = async (
  collectionName: string,
  options?: { validator?: mongoDB.Document }
): Promise<void> => {
  ensureInitialized();

  // create if missing
  const exists = await _db!
    .listCollections({ name: collectionName }, { nameOnly: true })
    .hasNext();

  if (!exists) {
    try {
      await _db!.createCollection(collectionName);
      Log.dev(`Created collection ${collectionName}`);
    } catch (err: any) {
      if (err?.codeName !== "NamespaceExists") throw err; // tolerate races
    }
  }

  // optional validator
  if (options?.validator) {
    try {
      await _db!.command({
        collMod: collectionName,
        validator: options.validator,
      });
      Log.dev(`Applied validator to ${collectionName}`);
    } catch (err) {
      Log.warn(`collMod failed for ${collectionName}`, err);
    }
  }
};

/**
 * Ensures indexes exist on a collection. Idempotent by name and by key.
 *
 * @param collectionName - Target collection.
 * @param indexes - Index models to ensure.
 */
const ensureIndexes = async (
  collectionName: string,
  indexes: Array<{
    name?: string;
    key: mongoDB.IndexSpecification;
    unique?: boolean;
    partialFilterExpression?: mongoDB.Document;
  }>
): Promise<void> => {
  ensureInitialized();
  if (!indexes?.length) return;

  const coll = _db!.collection(collectionName);

  const existing = await coll.listIndexes().toArray();
  const byName = new Set<string>(existing.map((i: any) => String(i.name)));
  const keySigs = new Set<string>(
    existing.map((i: any) => normalizeIndexKey(i.key as mongoDB.IndexSpecification))
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
  Log.dev(
    `Created ${createModels.length} index(es) on ${collectionName}: ${createModels
      .map((m) => m.name || JSON.stringify(m.key))
      .join(", ")}`
  );
};

const findItemByIdInCollection = async (
  collectionName: string,
  id: string
): Promise<object | null> => {
  ensureInitialized();
  const objectId = toObjectId(id);
  if (!objectId) return null;

  try {
    const foundDoc = await _db!
      .collection(collectionName)
      .findOne({ _id: objectId });
    return transformId(foundDoc);
  } catch (error) {
    return handleDbError(
      `Error finding item with id ${id} in ${collectionName}`,
      error
    );
  }
};

const findItemsInCollection = async (
  collectionName: string,
  filter: object
): Promise<object[]> => {
  ensureInitialized();

  try {
    const cursor = _db!.collection(collectionName).find(filter);
    const results = await cursor.toArray();
    return results.map(transformId);
  } catch (error) {
    return handleDbError(
      `Error finding items in ${collectionName} with filter ${JSON.stringify(
        filter
      )}`,
      error
    );
  }
};

const addItemToCollection = async (
  collectionName: string,
  item: object
): Promise<WithId> => {
  ensureInitialized();

  try {
    const { insertedId } = await _db!.collection(collectionName).insertOne(item);
    return transformId({ _id: insertedId, ...item });
  } catch (error) {
    return handleDbError(`Error inserting item into ${collectionName}`, error);
  }
};

const updateItemInCollection = async (
  collectionName: string,
  id: string,
  item: object
): Promise<object | null> => {
  ensureInitialized();
  const objectId = toObjectId(id);
  if (!objectId) return null;

  try {
    const updatedItem = await _db!
      .collection(collectionName)
      .findOneAndUpdate(
        { _id: objectId },
        { $set: item },
        { returnDocument: "after" }
      );
    return transformId(updatedItem);
  } catch (error) {
    return handleDbError(
      `Error updating item with id ${id} in ${collectionName}`,
      error
    );
  }
};

const getAllInCollection = async (collectionName: string): Promise<object[]> => {
  ensureInitialized();

  try {
    const results = await _db!.collection(collectionName).find({}).toArray();
    return results.map(transformId);
  } catch (error) {
    return handleDbError(`Error getting all items in ${collectionName}`, error);
  }
};

const removeItemFromCollection = async (
  collectionName: string,
  id: string
): Promise<boolean> => {
  ensureInitialized();
  const objectId = toObjectId(id);
  if (!objectId) return false;

  try {
    const { acknowledged } = await _db!
      .collection(collectionName)
      .deleteOne({ _id: objectId });
    return acknowledged;
  } catch (error) {
    return handleDbError(
      `Error removing item with id ${id} from ${collectionName}`,
      error
    );
  }
};

const clearCollection = async (collectionName: string): Promise<boolean> => {
  ensureInitialized();

  try {
    const { acknowledged } = await _db!
      .collection(collectionName)
      .deleteMany({});
    return acknowledged;
  } catch (error) {
    return handleDbError(`Error clearing collection ${collectionName}`, error);
  }
};

const isCollectionEmpty = async (collectionName: string): Promise<boolean> => {
  ensureInitialized();

  try {
    const count = await _db!
      .collection(collectionName)
      .countDocuments({}, { limit: 1 });
    return count === 0;
  } catch (error) {
    return handleDbError(
      `Error counting documents in ${collectionName}`,
      error
    );
  }
};

/**
 * Thin Mongo adapter used internally by DataManager.
 * Not re-exported from the package entry.
 */
export const MongoDBManager = {
  /**
   * Creates a collection if missing and applies a validator (best-effort).
   * Idempotent.
   */
  ensureStore,
  /**
   * Ensures indexes exist. Idempotent by name and key.
   */
  ensureIndexes,

  init,
  close,
  ensureInitialized,
  getCollectionChangeReadable,
  findItemByIdInCollection,
  findItemsInCollection,
  addItemToCollection,
  updateItemInCollection,
  getAllInCollection,
  removeItemFromCollection,
  clearCollection,
  isCollectionEmpty,
};

/** test-only (not exported from index) */
export const TestingMongoDBManager = {
  ...MongoDBManager,
  _setDatabaseInstance,
  _setClient,
  _setIsConnected,
};
