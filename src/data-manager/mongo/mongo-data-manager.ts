import * as mongoDB from "mongodb";
import { Readable } from "stream";
import { CollectionChangeType } from "../data-manager.type";
import { WithId } from "./mongo-data-manager.type";
import { Log } from "../../logger/logger-manager";
import { handleDbError } from "../data-manager.helpers";
import { toObjectId, asIndexKey, normalizeIndexKey } from "./mongo.helpers";
import { DEFAULT_DB_NAME, DEFAULT_MONGO_URI } from "./mongo.constants";

let _client: mongoDB.MongoClient | null = null;
let _db: mongoDB.Db | null = null;
let _isConnected = false;

/** Internal setters for tests */
const _setClient = (c: mongoDB.MongoClient | null) => (_client = c);
const _setDatabaseInstance = (db: mongoDB.Db | null) => (_db = db);
const _setIsConnected = (v: boolean) => (_isConnected = v);

/**
 * Adapter for MongoDB used by the DataManager facade.
 * Internal to core; not re-exported from the package entry.
 */
export const MongoDBManager = {
  /**
   * Connect and select a database.
   * Safe to call more than once; subsequent calls no-op if already connected.
   *
   * @param uri - Mongo connection string.
   * @param dbName - Database name to use.
   */
  async connect(uri: string = DEFAULT_MONGO_URI, dbName: string = DEFAULT_DB_NAME): Promise<void> {
    if (_isConnected && _client && _db) return;

    try {
      _client = new mongoDB.MongoClient(uri);
      await _client.connect();
      _db = _client.db(dbName);
      _isConnected = true;
      Log.dev(`MongoDBManager connected to ${dbName}`);
    } catch (err) {
      handleDbError("Error connecting to MongoDB", err);
      throw err;
    }
  },

  /**
   * Close the MongoDB client.
   * No-ops if already closed.
   */
  async disconnect(): Promise<void> {
    try {
      if (_client) await _client.close();
    } catch (err) {
      handleDbError("Error disconnecting MongoDB", err);
    } finally {
      _client = null;
      _db = null;
      _isConnected = false;
      Log.dev("MongoDBManager disconnected");
    }
  },

  /**
   * Guard that throws if the adapter is not ready.
   */
  ensureInitialized(): void {
    if (!_client || !_db || !_isConnected) {
      const msg = "MongoDB client not initialized";
      Log.error(msg);
      throw new Error(msg);
    }
  },

  // ---------------------------------------------------------------------------
  // Provisioning (minimal, idempotent)
  // ---------------------------------------------------------------------------

  /**
   * Ensure a collection exists. Optionally apply basic schema validation with `collMod`.
   * Idempotent: creates the collection if missing; otherwise best-effort `collMod`.
   *
   * @param storeName - Collection name.
   * @param options - Optional validation settings.
   */
  async ensureStore(
    storeName: string,
    options?: {
      validation?: {
        validator?: Record<string, unknown>;
        validationLevel?: "off" | "strict" | "moderate";
        validationAction?: "error" | "warn";
      };
    }
  ): Promise<void> {
    this.ensureInitialized();
    if (!storeName) return;

    // create if missing
    const exists = await _db!.listCollections({ name: storeName }, { nameOnly: true }).hasNext();
    if (!exists) {
      await _db!.createCollection(storeName, {
        validator: options?.validation?.validator,
        validationLevel: options?.validation?.validationLevel,
        validationAction: options?.validation?.validationAction,
      });
      Log.dev(`ensureStore: created '${storeName}'`);
      return;
    }

    // best-effort collMod for validator; ignore if unsupported
    if (options?.validation) {
      const cmd: Record<string, unknown> = { collMod: storeName };
      if (options.validation.validator) cmd.validator = options.validation.validator;
      if (options.validation.validationLevel) cmd.validationLevel = options.validation.validationLevel;
      if (options.validation.validationAction) cmd.validationAction = options.validation.validationAction;

      try {
        await _db!.command(cmd);
        Log.dev(`ensureStore: applied collMod to '${storeName}'`);
      } catch (e) {
        Log.warn(`ensureStore: collMod skipped for '${storeName}': ${(e as Error).message}`);
      }
    }
  },

  /**
   * Ensure the given named indexes exist on a collection.
   * Idempotent by **index name** or **key**: if either already exists, we skip it.
   *
   * @param storeName - Collection name.
   * @param indexes - Indexes to ensure. Provide a `name` for clean idempotency.
   *
   * @example
   * await ensureIndexes('users', [
   *   { name: 'email_1', key: { email: 1 }, unique: true },
   *   { name: 'createdAt_-1', key: { createdAt: -1 } },
   * ]);
   */
  async ensureIndexes(
    storeName: string,
    indexes: Array<{ name: string; key: mongoDB.IndexSpecification; unique?: boolean }>
  ): Promise<void> {
    this.ensureInitialized();
    if (!storeName || !indexes?.length) return;

    const coll = _db!.collection(storeName);
    const existing = await coll.indexes(); // [{ name, key, ... }]

    const existingNames = new Set(existing.map((idx) => idx.name));
    const existingKeySigs = new Set(
      existing.map((idx) => normalizeIndexKey(idx.key as any))
    );

    const toCreate: mongoDB.IndexDescription[] = [];

    for (const idx of indexes) {
      if (!idx?.name || !idx?.key) continue;

      const byName = existingNames.has(idx.name);
      const byKey = existingKeySigs.has(normalizeIndexKey(idx.key));
      if (byName || byKey) continue; // idempotent by name OR key

      toCreate.push({
        name: idx.name,
        key: asIndexKey(idx.key), // normalize union → object/Map for the driver
        unique: idx.unique,
      });
    }

    if (toCreate.length > 0) {
      await coll.createIndexes(toCreate);
      Log.dev(`ensureIndexes: created ${toCreate.length} index(es) on '${storeName}'`);
    }
  },

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Insert a document. Returns the inserted doc with `id` as a string.
   *
   * @param collectionName - Target collection.
   * @param item - Document to insert.
   */
  async addItemToCollection<T extends WithId>(collectionName: string, item: T): Promise<T> {
    this.ensureInitialized();
    if (!collectionName) throw new Error("collectionName is required");

    try {
      const coll = _db!.collection(collectionName);
      const doc = { ...item } as any;

      // Respect provided id if it's a valid ObjectId; otherwise Mongo assigns.
      let _id: mongoDB.ObjectId | undefined;
      if (doc.id) {
        const maybe = toObjectId(doc.id);
        if (maybe) _id = maybe;
      }
      delete doc.id; // don't persist "id" alongside _id

      const res = await coll.insertOne(_id ? { _id, ...doc } : doc);
      const id = (res.insertedId || _id) as mongoDB.ObjectId;
      return { ...(item as any), id: id.toHexString() } as T;
    } catch (err) {
      handleDbError(`addItemToCollection failed for ${collectionName}`, err);
      throw err;
    }
  },

  /**
   * Update a document by id. Returns the updated doc with `id`, or `null` if not found.
   *
   * @param collectionName - Target collection.
   * @param id - Document id (string ObjectId).
   * @param updates - Partial update payload.
   */
  async updateItemInCollection<T extends WithId>(
    collectionName: string,
    id: string,
    updates: Partial<T>
  ): Promise<T | null> {
    this.ensureInitialized();
    if (!collectionName) throw new Error("collectionName is required");
    if (!id) throw new Error("id is required");

    try {
      const _id = toObjectId(id);
      if (!_id) throw new Error("Invalid id");

      const coll = _db!.collection(collectionName);
      const { id: _ignore, _id: __ignore, ...safe } = (updates ?? {}) as any;

      const res = await coll.findOneAndUpdate({ _id }, { $set: safe }, { returnDocument: "after" });
      if (!res?.value) return null;

      const v = res.value as any;
      return { ...v, id: v._id?.toHexString?.() ?? v.id } as T;
    } catch (err) {
      handleDbError(`updateItemInCollection failed for ${collectionName}`, err);
      throw err;
    }
  },

  /**
   * Delete a document by id.
   *
   * @param collectionName - Target collection.
   * @param id - Document id (string ObjectId).
   * @returns `true` if a document was deleted.
   */
  async deleteItemFromCollection(collectionName: string, id: string): Promise<boolean> {
    this.ensureInitialized();
    if (!collectionName) throw new Error("collectionName is required");
    if (!id) throw new Error("id is required");

    try {
      const _id = toObjectId(id);
      if (!_id) throw new Error("Invalid id");

      const coll = _db!.collection(collectionName);
      const res = await coll.deleteOne({ _id });
      return res.deletedCount === 1;
    } catch (err) {
      handleDbError(`deleteItemFromCollection failed for ${collectionName}`, err);
      throw err;
    }
  },

  /**
   * Read a single document by id.
   *
   * @param collectionName - Target collection.
   * @param id - Document id (string ObjectId).
   */
  async findItemInCollectionById<T extends WithId>(collectionName: string, id: string): Promise<T | null> {
    this.ensureInitialized();
    if (!collectionName) throw new Error("collectionName is required");
    if (!id) throw new Error("id is required");

    try {
      const _id = toObjectId(id);
      if (!_id) throw new Error("Invalid id");

      const coll = _db!.collection(collectionName);
      const doc = await coll.findOne({ _id });
      if (!doc) return null;

      const v = doc as any;
      return { ...v, id: v._id?.toHexString?.() ?? v.id } as T;
    } catch (err) {
      handleDbError(`findItemInCollectionById failed for ${collectionName}`, err);
      throw err;
    }
  },

  /**
   * Find multiple documents by a simple filter.
   *
   * @param collectionName - Target collection.
   * @param filter - Basic query object.
   */
  async findItemsInCollection<T extends WithId>(
    collectionName: string,
    filter: Record<string, unknown>
  ): Promise<T[] | null> {
    this.ensureInitialized();
    if (!collectionName) return null;

    try {
      const coll = _db!.collection(collectionName);
      const arr = await coll.find(filter ?? {}).toArray();
      return arr.map((v: any) => ({ ...v, id: v._id?.toHexString?.() ?? v.id }));
    } catch (err) {
      handleDbError(`findItemsInCollection failed for ${collectionName}`, err);
      throw err;
    }
  },

  /**
   * Read all documents in a collection.
   *
   * @param collectionName - Target collection.
   */
  async getAllItemsFromCollection<T extends WithId>(collectionName: string): Promise<T[]> {
    this.ensureInitialized();
    if (!collectionName) return [];

    try {
      const coll = _db!.collection(collectionName);
      const arr = await coll.find({}).toArray();
      return arr.map((v: any) => ({ ...v, id: v._id?.toHexString?.() ?? v.id }));
    } catch (err) {
      handleDbError(`getAllItemsFromCollection failed for ${collectionName}`, err);
      throw err;
    }
  },

  /**
   * Change stream for one collection filtered by operation type.
   * Keeps the pipeline minimal.
   *
   * @param collectionName - Target collection.
   * @param changeType - Operation type ('insert' | 'update' | 'delete').
   */
  getCollectionChangeReadable(collectionName: string, changeType: CollectionChangeType): Readable {
    this.ensureInitialized();
    const coll = _db!.collection(collectionName);
    const pipeline = [{ $match: { operationType: changeType } }];
    return coll.watch(pipeline, { fullDocument: "updateLookup" }) as unknown as Readable;
  },
};

/**
 * Testing-only helpers. Not for production use.
 * @internal
 */
export const TestingMongoDBManager = {
  ...MongoDBManager,
  _setDatabaseInstance,
  _setClient,
  _setIsConnected,
};
