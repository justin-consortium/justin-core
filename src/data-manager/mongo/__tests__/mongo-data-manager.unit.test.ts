import { EventEmitter } from 'events';
import * as mongoDB from 'mongodb';
import { Readable } from 'stream';
import { Log } from '../../../logger/logger-manager';
import { CollectionChangeType } from '../../data-manager.type';

jest.mock('../../data-manager.helpers', () => ({
  handleDbError: jest.fn((msg: string, err: unknown) => {
    return null;
  }),
}));

jest.mock('../mongo.helpers', () => ({
  toObjectId: jest.fn(),
  asIndexKey: jest.fn(),
  normalizeIndexKey: jest.fn(),
  transformId: jest.fn(),
}));

import { handleDbError } from '../../data-manager.helpers';
import {
  toObjectId,
  asIndexKey,
  normalizeIndexKey,
  transformId,
} from '../mongo.helpers';

import {
  MongoDBManager,
  TestingMongoDBManager,
} from '../mongo-data-manager';

describe('MongoDBManager (unit)', () => {
  let devSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  let fakeCollection: any;
  let fakeDb: any;
  let fakeClient: any;

  beforeEach(() => {
    jest.restoreAllMocks();

    devSpy = jest.spyOn(Log, 'dev').mockImplementation(() => {});
    warnSpy = jest.spyOn(Log, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(Log, 'error').mockImplementation(() => {});

    fakeCollection = {
      watch: jest.fn(),
      listIndexes: jest.fn(),
      createIndexes: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      insertOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      deleteOne: jest.fn(),
      deleteMany: jest.fn(),
      countDocuments: jest.fn(),
    };

    fakeDb = {
      collection: jest.fn(() => fakeCollection),
      listCollections: jest.fn(),
      createCollection: jest.fn(),
      command: jest.fn(),
    };

    fakeClient = {
      close: jest.fn(),
    };

    TestingMongoDBManager._setDatabaseInstance(fakeDb as any);
    TestingMongoDBManager._setClient(fakeClient as any);
    TestingMongoDBManager._setIsConnected(true);

    (toObjectId as jest.Mock).mockReturnValue(new mongoDB.ObjectId());
    (transformId as jest.Mock).mockImplementation((doc) => doc);
    (asIndexKey as jest.Mock).mockImplementation((k) => k);
    (normalizeIndexKey as jest.Mock).mockImplementation((k) => {
      if (typeof k === 'string') return `${k}:1`;
      return 'key:1';
    });
  });

  afterEach(() => {
    devSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('ensureInitialized', () => {
    it('throws if not connected', () => {
      TestingMongoDBManager._setIsConnected(false);

      expect(() => MongoDBManager.ensureInitialized()).toThrow(
        'MongoDBManager not initialized. Call init() first.'
      );
    });

    it('does not throw if connected', () => {
      expect(() => MongoDBManager.ensureInitialized()).not.toThrow();
    });
  });

  describe('ensureStore', () => {
    it('creates collection when it does not exist', async () => {
      fakeDb.listCollections.mockReturnValue({
        hasNext: jest.fn().mockResolvedValue(false),
      });

      await MongoDBManager.ensureStore('users');

      expect(fakeDb.listCollections).toHaveBeenCalledWith(
        { name: 'users' },
        { nameOnly: true }
      );
      expect(fakeDb.createCollection).toHaveBeenCalledWith('users');
      expect(devSpy).toHaveBeenCalledWith('Created collection users');
    });

    it('does not create collection when it exists', async () => {
      fakeDb.listCollections.mockReturnValue({
        hasNext: jest.fn().mockResolvedValue(true),
      });

      await MongoDBManager.ensureStore('users');

      expect(fakeDb.createCollection).not.toHaveBeenCalled();
    });

    it('applies validator when provided', async () => {
      fakeDb.listCollections.mockReturnValue({
        hasNext: jest.fn().mockResolvedValue(true),
      });

      await MongoDBManager.ensureStore('users', {
        validator: { $jsonSchema: { bsonType: 'object' } },
      });

      expect(fakeDb.command).toHaveBeenCalledWith({
        collMod: 'users',
        validator: { $jsonSchema: { bsonType: 'object' } },
      });
      expect(devSpy).toHaveBeenCalledWith('Applied validator to users');
    });

    it('logs a warning when collMod fails', async () => {
      fakeDb.listCollections.mockReturnValue({
        hasNext: jest.fn().mockResolvedValue(true),
      });
      fakeDb.command.mockRejectedValueOnce(new Error('nope'));

      await MongoDBManager.ensureStore('users', {
        validator: { x: 1 },
      });

      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('ensureIndexes', () => {
    it('returns early when no indexes provided', async () => {
      await MongoDBManager.ensureIndexes('users', []);
      expect(fakeDb.collection).not.toHaveBeenCalled();
    });

    it('creates indexes that do not already exist', async () => {
      fakeCollection.listIndexes.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { name: 'existing', key: { existing: 1 } },
        ]),
      });

      (normalizeIndexKey as jest.Mock).mockImplementation((key) => {
        if (typeof key === 'string') return `${key}:1`;
        if ((key as any).existing) return 'existing:1';
        if ((key as any).newField) return 'newField:1';
        return 'key:1';
      });

      await MongoDBManager.ensureIndexes('users', [
        {
          name: 'newIndex',
          key: { newField: 1 },
          unique: true,
        },
        {
          key: { existing: 1 },
        },
      ]);

      expect(fakeDb.collection).toHaveBeenCalledWith('users');
      expect(fakeCollection.createIndexes).toHaveBeenCalledTimes(1);
      const callArg = fakeCollection.createIndexes.mock.calls[0][0];
      expect(callArg).toHaveLength(1);
      expect(callArg[0]).toMatchObject({
        key: { newField: 1 },
        name: 'newIndex',
        unique: true,
      });
      expect(devSpy).toHaveBeenCalledWith(
        expect.stringContaining('Created 1 index(es) on users')
      );
    });
  });

  describe('findItemByIdInCollection', () => {
    it('returns null if toObjectId returns null', async () => {
      (toObjectId as jest.Mock).mockReturnValueOnce(null);

      const result = await MongoDBManager.findItemByIdInCollection(
        'users',
        'bad-id'
      );

      expect(result).toBeNull();
      expect(fakeCollection.findOne).not.toHaveBeenCalled();
    });

    it('returns transformed doc when found', async () => {
      const fakeMongoDoc = { _id: 'a', name: 'test' };
      fakeCollection.findOne.mockResolvedValue(fakeMongoDoc);
      (transformId as jest.Mock).mockReturnValue({ id: 'a', name: 'test' });

      const result = await MongoDBManager.findItemByIdInCollection(
        'users',
        'good-id'
      );

      expect(fakeCollection.findOne).toHaveBeenCalledWith({
        _id: expect.any(mongoDB.ObjectId),
      });
      expect(transformId).toHaveBeenCalledWith(fakeMongoDoc);
      expect(result).toEqual({ id: 'a', name: 'test' });
    });

    it('delegates to handleDbError on failure', async () => {
      fakeCollection.findOne.mockRejectedValueOnce(new Error('boom'));

      const result = await MongoDBManager.findItemByIdInCollection(
        'users',
        'good-id'
      );

      expect(handleDbError).toHaveBeenCalledWith(
        'Error finding item with id good-id in users',
        expect.any(Error)
      );
      expect(result).toBeNull();
    });
  });

  describe('findItemsInCollection', () => {
    it('returns transformed list', async () => {
      fakeCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: '1' }, { _id: '2' }]),
      });
      (transformId as jest.Mock)
        .mockReturnValueOnce({ id: '1' })
        .mockReturnValueOnce({ id: '2' });

      const result = await MongoDBManager.findItemsInCollection('users', {
        active: true,
      });

      expect(fakeCollection.find).toHaveBeenCalledWith({ active: true });
      expect(result).toEqual([{ id: '1' }, { id: '2' }]);
    });

    it('delegates to handleDbError on failure', async () => {
      fakeCollection.find.mockImplementation(() => {
        throw new Error('query failed');
      });

      const result = await MongoDBManager.findItemsInCollection('users', {});

      expect(handleDbError).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('addItemToCollection', () => {
    it('inserts and returns transformed doc', async () => {
      fakeCollection.insertOne.mockResolvedValue({
        insertedId: 'abc123',
      });
      (transformId as jest.Mock).mockReturnValue({ id: 'abc123', name: 'x' });

      const result = await MongoDBManager.addItemToCollection('users', {
        name: 'x',
      });

      expect(fakeCollection.insertOne).toHaveBeenCalledWith({ name: 'x' });
      expect(transformId).toHaveBeenCalledWith({
        _id: 'abc123',
        name: 'x',
      });
      expect(result).toEqual({ id: 'abc123', name: 'x' });
    });

    it('delegates to handleDbError on failure', async () => {
      fakeCollection.insertOne.mockRejectedValueOnce(new Error('insert bad'));

      const result = await MongoDBManager.addItemToCollection('users', {
        name: 'x',
      });

      expect(handleDbError).toHaveBeenCalledWith(
        'Error inserting item into users',
        expect.any(Error)
      );
      expect(result).toBeNull();
    });
  });

  describe('updateItemInCollection', () => {
    it('returns null when toObjectId fails', async () => {
      (toObjectId as jest.Mock).mockReturnValueOnce(null);

      const result = await MongoDBManager.updateItemInCollection(
        'users',
        'bad-id',
        { name: 'x' }
      );

      expect(result).toBeNull();
      expect(fakeCollection.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('updates and returns transformed doc', async () => {
      const fakeUpdated = { _id: '1', name: 'updated' };
      fakeCollection.findOneAndUpdate.mockResolvedValue(fakeUpdated);
      (transformId as jest.Mock).mockReturnValue({ id: '1', name: 'updated' });

      const result = await MongoDBManager.updateItemInCollection(
        'users',
        'good-id',
        { name: 'updated' }
      );

      expect(fakeCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: expect.any(mongoDB.ObjectId) },
        { $set: { name: 'updated' } },
        { returnDocument: 'after' }
      );
      expect(result).toEqual({ id: '1', name: 'updated' });
    });
  });

  describe('getAllInCollection', () => {
    it('returns transformed docs', async () => {
      fakeCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: '1' }]),
      });
      (transformId as jest.Mock).mockReturnValue({ id: '1' });

      const result = await MongoDBManager.getAllInCollection('users');

      expect(result).toEqual([{ id: '1' }]);
    });
  });

  describe('removeItemFromCollection', () => {
    it('returns false when toObjectId fails', async () => {
      (toObjectId as jest.Mock).mockReturnValueOnce(null);

      const result = await MongoDBManager.removeItemFromCollection(
        'users',
        'bad-id'
      );

      expect(result).toBe(false);
      expect(fakeCollection.deleteOne).not.toHaveBeenCalled();
    });

    it('returns true when delete is acknowledged', async () => {
      fakeCollection.deleteOne.mockResolvedValue({ acknowledged: true });

      const result = await MongoDBManager.removeItemFromCollection(
        'users',
        'good-id'
      );

      expect(result).toBe(true);
    });
  });

  describe('clearCollection', () => {
    it('deletes all and returns acknowledged', async () => {
      fakeCollection.deleteMany.mockResolvedValue({ acknowledged: true });

      const result = await MongoDBManager.clearCollection('users');

      expect(fakeCollection.deleteMany).toHaveBeenCalledWith({});
      expect(result).toBe(true);
    });
  });

  describe('isCollectionEmpty', () => {
    it('returns true when count is 0', async () => {
      fakeCollection.countDocuments.mockResolvedValue(0);

      const result = await MongoDBManager.isCollectionEmpty('users');

      expect(result).toBe(true);
    });

    it('returns false when count is > 0', async () => {
      fakeCollection.countDocuments.mockResolvedValue(1);

      const result = await MongoDBManager.isCollectionEmpty('users');

      expect(result).toBe(false);
    });
  });

  describe('getCollectionChangeReadable', () => {
    it('creates a readable that pushes normalized docs on change (DELETE)', () => {
      const emitter = new EventEmitter();
      fakeCollection.watch.mockReturnValue(emitter);

      const readable = MongoDBManager.getCollectionChangeReadable(
        'users',
        CollectionChangeType.DELETE
      );

      emitter.emit('change', {
        documentKey: { _id: new mongoDB.ObjectId('64b5fcf45a9930c381d2f111') },
      });

      const chunk = (readable as Readable).read() as any;
      expect(chunk).toEqual({
        id: '64b5fcf45a9930c381d2f111',
      });
    });

    it('creates a readable that pushes transformed docs on change (INSERT)', () => {
      const emitter = new EventEmitter();
      fakeCollection.watch.mockReturnValue(emitter);
      (transformId as jest.Mock).mockReturnValue({ id: '123', name: 'foo' });

      const readable = MongoDBManager.getCollectionChangeReadable(
        'users',
        CollectionChangeType.INSERT
      );

      emitter.emit('change', {
        fullDocument: { _id: '123', name: 'foo' },
      });

      const chunk = (readable as Readable).read() as any;
      expect(transformId).toHaveBeenCalledWith({ _id: '123', name: 'foo' });
      expect(chunk).toEqual({ id: '123', name: 'foo' });
    });

    it('destroys readable on error and logs (handled)', (done) => {
      const emitter = new EventEmitter();
      fakeCollection.watch.mockReturnValue(emitter);

      const readable = MongoDBManager.getCollectionChangeReadable(
        'users',
        CollectionChangeType.INSERT
      );

      // attach an error handler so Node doesn't treat it as unhandled
      readable.on('error', (err) => {
        expect(errorSpy).toHaveBeenCalledWith('Change stream error', err);
        done();
      });

      const err = new Error('stream broke');
      emitter.emit('error', err);
    });
  });

  describe('close', () => {
    it('closes client and resets state', async () => {
      await MongoDBManager.close();

      expect(fakeClient.close).toHaveBeenCalled();
      await MongoDBManager.close();
    });
  });
});
