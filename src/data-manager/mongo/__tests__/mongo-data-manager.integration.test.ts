import { MongoMemoryReplSet } from 'mongodb-memory-server';
import * as mongoDB from 'mongodb';
import { MongoDBManager } from '../mongo-data-manager';
import { loggerSpies } from '../../../__tests__/mocks';

describe('MongoDBManager (integration)', () => {
  let repl: MongoMemoryReplSet;
  let uri: string;
  let logs: ReturnType<typeof loggerSpies>;

  beforeAll(async () => {
    logs = loggerSpies();

    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });
    uri = repl.getUri();

    await MongoDBManager.init(uri, 'test-db');
  });

  afterAll(async () => {
    await MongoDBManager.close();
    await repl.stop();
    logs.restore();
    jest.restoreAllMocks();
  });

  it('creates a collection via ensureStore', async () => {
    await MongoDBManager.ensureStore('users');

    const client = new mongoDB.MongoClient(uri);
    await client.connect();
    const db = client.db('test-db');

    const found = await db
      .listCollections({ name: 'users' }, { nameOnly: true })
      .hasNext();

    await client.close();

    expect(found).toBe(true);
  });

  it('can insert, fetch by id, update, and delete', async () => {
    const inserted = await MongoDBManager.addItemToCollection('users', {
      name: 'Alice',
      role: 'admin',
    });

    expect(inserted).toHaveProperty('id');
    expect(inserted).toMatchObject({ name: 'Alice', role: 'admin' });

    const found = await MongoDBManager.findItemByIdInCollection(
      'users',
      inserted.id as string,
    );
    expect(found).not.toBeNull();
    expect(found).toMatchObject({ name: 'Alice', role: 'admin' });

    const updated = await MongoDBManager.updateItemInCollection(
      'users',
      inserted.id as string,
      { role: 'user' },
    );
    expect(updated).not.toBeNull();
    expect(updated).toMatchObject({ role: 'user' });

    const all = await MongoDBManager.getAllInCollection('users');
    expect(all.length).toBeGreaterThan(0);

    const removed = await MongoDBManager.removeItemFromCollection(
      'users',
      inserted.id as string,
    );
    expect(removed).toBe(true);

    const cleared = await MongoDBManager.clearCollection('users');
    expect(cleared).toBe(true);
  });

  it('can create indexes that show up in listIndexes', async () => {
    await MongoDBManager.ensureStore('indexed');

    await MongoDBManager.ensureIndexes('indexed', [
      {
        name: 'by_name',
        key: { name: 1 },
        unique: false,
      },
    ]);

    const client = new mongoDB.MongoClient(uri);
    await client.connect();
    const db = client.db('test-db');
    const coll = db.collection('indexed');

    const indexes = await coll.listIndexes().toArray();

    await client.close();

    const names = indexes.map((i) => i.name);
    expect(names).toContain('by_name');
  });
});
