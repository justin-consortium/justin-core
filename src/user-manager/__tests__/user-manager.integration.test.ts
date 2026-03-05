import { MongoMemoryReplSet } from 'mongodb-memory-server';
import * as mongoDB from 'mongodb';
import { loggerSpies, waitForMongoReady } from '../../testing';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import DataManager from '../../data-manager/data-manager';
import { UserManager } from '../../user-manager/user-manager';
import { PROTECTED_ATTRIBUTES, USERS } from '../../data-manager/data-manager.constants';

describe('UserManager (integration)', () => {
  let repl: MongoMemoryReplSet;
  let uri: string;
  let logs: ReturnType<typeof loggerSpies>;

  beforeAll(async () => {
    logs = loggerSpies();

    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });

    uri = repl.getUri();
    await waitForMongoReady(uri);

    // Ensure the Mongo adapter is pointed at the in-memory replset for this test run.
    await MongoDBManager.init(uri, 'test-db');

    // Mark DataManager as initialized for this test run.
    await DataManager.getInstance().init();

    await UserManager.init();
  });

  afterAll(async () => {
    try {
      UserManager.shutdown();
      await DataManager.getInstance().close();
      await MongoDBManager.close();
    } finally {
      await repl.stop();
      logs.restore();
    }
  });

  beforeEach(async () => {
    await UserManager.deleteAllUsers();
  });

  it('create → update user → add protected → update protected → delete user', async () => {
    const created = await UserManager.createUser({
      uniqueIdentifier: 'test-1',
      attributes: {
        preferredWakeUpTime: '07:00',
        preferredBedtime: '22:30',
      },
      protectedAttributes: [
        {
          namespace: 'pii',
          protectedAttributes: {
            email: 'test-1@example.com',
            phoneNumber: '555-000-0001',
          },
        },
        {
          namespace: 'fitbit',
          protectedAttributes: { accessToken: 'tok_abc', refreshToken: 'ref_abc' },
        },
      ],
    });

    expect(created).not.toBeNull();
    expect(created?.id).toEqual(expect.any(String));
    expect(created).toMatchObject({
      uniqueIdentifier: 'test-1',
      preferredWakeUpTime: '07:00',
      preferredBedtime: '22:30',
    });

    const userId = created!.id;

    const initialProtected = UserManager.getProtectedAttributesByNamespaces(userId, ['pii', 'fitbit']);
    expect(initialProtected.length).toBe(2);

    const pii = initialProtected.find((d) => d.namespace === 'pii');
    const fitbit = initialProtected.find((d) => d.namespace === 'fitbit');

    expect(pii).toBeTruthy();
    expect(pii).toMatchObject({
      uniqueIdentifier: 'test-1',
      namespace: 'pii',
      protectedAttributes: {
        email: 'test-1@example.com',
        phoneNumber: '555-000-0001',
      },
    });

    expect(fitbit).toBeTruthy();
    expect(fitbit).toMatchObject({
      uniqueIdentifier: 'test-1',
      namespace: 'fitbit',
      protectedAttributes: { accessToken: 'tok_abc', refreshToken: 'ref_abc' },
    });

    const updatedUser = await UserManager.updateUserById(userId, {
      preferredWakeUpTime: '06:30',
    });

    expect(updatedUser).toMatchObject({
      id: userId,
      uniqueIdentifier: 'test-1',
      preferredWakeUpTime: '06:30',
      preferredBedtime: '22:30',
    });

    const addedCalendar = await UserManager.addProtectedAttributesForUser(userId, 'calendar', {
      provider: 'google',
      refreshToken: 'cal_ref_1',
    });

    expect(addedCalendar).not.toBeNull();
    expect(addedCalendar).toMatchObject({
      uniqueIdentifier: 'test-1',
      namespace: 'calendar',
      protectedAttributes: { provider: 'google', refreshToken: 'cal_ref_1' },
    });

    const addedCalendarAgain = await UserManager.addProtectedAttributesForUser(userId, 'calendar', {
      refreshToken: 'should_not_insert',
    });
    expect(addedCalendarAgain).toBeNull();

    const updatedFitbit = await UserManager.updateProtectedAttributesForUser(userId, 'fitbit', {
      accessToken: 'tok_NEW',
      refreshToken: 'ref_NEW',
    });

    expect(updatedFitbit).not.toBeNull();
    expect(updatedFitbit).toMatchObject({
      uniqueIdentifier: 'test-1',
      namespace: 'fitbit',
      protectedAttributes: { accessToken: 'tok_NEW', refreshToken: 'ref_NEW' },
    });

    const fitbitAfter = UserManager.getProtectedAttributesByNamespaces(userId, ['fitbit'])[0];
    expect(fitbitAfter).toMatchObject({
      namespace: 'fitbit',
      protectedAttributes: { accessToken: 'tok_NEW', refreshToken: 'ref_NEW' },
    });

    const deleted = await UserManager.deleteUserById(userId);
    expect(deleted).toBe(true);

    expect(UserManager.getUserById(userId)).toBeNull();
    expect(UserManager.getUserByUniqueIdentifier('test-1')).toBeNull();

    // Verify cascade at the DB level.
    const client = new mongoDB.MongoClient(uri);
    await client.connect();
    const db = client.db('test-db');

    const usersDocs = await db.collection(USERS).find({ uniqueIdentifier: 'test-1' }).toArray();
    const paDocs = await db
      .collection(PROTECTED_ATTRIBUTES)
      .find({ uniqueIdentifier: 'test-1' })
      .toArray();

    await client.close();

    expect(usersDocs.length).toBe(0);
    expect(paDocs.length).toBe(0);
  });

  it('reserved field invariants throw (updateUserById)', async () => {
    const created = await UserManager.createUser({
      uniqueIdentifier: 'test-2',
      attributes: { preferredWakeUpTime: '07:15', preferredBedtime: '22:00' },
    });

    expect(created).not.toBeNull();

    await expect(
      UserManager.updateUserById(created!.id, { uniqueIdentifier: 'test-999' } as any),
    ).rejects.toThrow();

    await expect(UserManager.updateUserById(created!.id, { id: 'nope' } as any)).rejects.toThrow();
  });

  it('protected attributes reject reserved fields', async () => {
    const created = await UserManager.createUser({
      uniqueIdentifier: 'test-3',
      attributes: { preferredWakeUpTime: '06:45', preferredBedtime: '22:15' },
    });

    expect(created).not.toBeNull();

    await expect(
      UserManager.updateProtectedAttributesForUser(created!.id, 'fitbit', {
        namespace: 'evil',
      } as any),
    ).rejects.toThrow();

    await expect(
      UserManager.addProtectedAttributesForUser(created!.id, 'fitbit', {
        uniqueIdentifier: 'evil',
      } as any),
    ).rejects.toThrow();
  });
});
