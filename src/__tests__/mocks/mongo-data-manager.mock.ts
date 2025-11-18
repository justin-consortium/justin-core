export type MongoManagerMock = ReturnType<typeof createMongoManagerMock>;

export function createMongoManagerMock() {
  return {
    // lifecycle
    init: jest.fn(async () => {}),
    ensureStore: jest.fn(async (_storeName: string, _options?: unknown) => {}),
    ensureIndexes: jest.fn(async (_storeName: string, _indexes?: unknown) => {}),
    close: jest.fn(async () => {}),

    // CRUD
    addItemToCollection: jest.fn(),
    updateItemInCollection: jest.fn(),
    removeItemFromCollection: jest.fn(),
    getAllInCollection: jest.fn(),
    clearCollection: jest.fn(async (_storeName: string) => {}),
    isCollectionEmpty: jest.fn(),
    findItemByIdInCollection: jest.fn(),
    findItemsInCollection: jest.fn(),

    // change streams
    getCollectionChangeReadable: jest.fn(),
  };
}

// src/__tests__/helpers/mongo-fakes.ts

export type FakeCollection = {
  watch: jest.Mock;
  listIndexes: jest.Mock;
  createIndexes: jest.Mock;
  findOne: jest.Mock;
  find: jest.Mock;
  insertOne: jest.Mock;
  findOneAndUpdate: jest.Mock;
  updateOne: jest.Mock;
  deleteOne: jest.Mock;
  deleteMany: jest.Mock;
  countDocuments: jest.Mock;
};

export type FakeDb = {
  collection: jest.Mock;
  listCollections: jest.Mock;
  createCollection: jest.Mock;
  command: jest.Mock;
};

export type FakeClient = {
  close: jest.Mock;
};

export type FakeMongo = {
  collection: FakeCollection;
  db: FakeDb;
  client: FakeClient;
};

export function makeFakeMongo(): FakeMongo {
  const collection: FakeCollection = {
    watch: jest.fn(),
    listIndexes: jest.fn(),
    createIndexes: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    insertOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    countDocuments: jest.fn(),
  };

  const db: FakeDb = {
    collection: jest.fn(() => collection),
    listCollections: jest.fn(),
    createCollection: jest.fn(),
    command: jest.fn(),
  };

  const client: FakeClient = {
    close: jest.fn(),
  };

  return { collection, db, client };
}
