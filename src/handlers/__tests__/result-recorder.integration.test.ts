import sinon from 'sinon';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import DataManager from '../../data-manager/data-manager';
import {
  handleDecisionRuleResult,
  handleTaskResult,
  setDecisionRuleResultRecorder,
  setTaskResultRecorder,
  setResultRecorderPersistenceEnabled,
} from '../result-recorder';
import { RecordResult } from '../handler.type';
import {
  DECISION_RULE_RESULTS,
  TASK_RESULTS,
} from '../../data-manager/data-manager.constants';
import { Log } from '../../logger/logger-manager';

describe('Result Recorder Integration', () => {
  let mongod: MongoMemoryServer;
  let dataManager: DataManager;
  let devStub: sinon.SinonStub;
  let warnStub: sinon.SinonStub;

  const TAG_DECISION = '[ResultRecorder:decision]';
  const TAG_TASK = '[ResultRecorder:task]';

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.MONGO_URI = uri;
    process.env.DB_NAME = 'testdb';

    dataManager = DataManager.getInstance();
    await dataManager.init();
  });

  afterAll(async () => {
    await dataManager.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await dataManager.clearCollection(DECISION_RULE_RESULTS);
    await dataManager.clearCollection(TASK_RESULTS);

    setDecisionRuleResultRecorder(null as any);
    setTaskResultRecorder(null as any);

    // Ensure persistence is enabled by default for these tests unless a test disables it
    if (typeof setResultRecorderPersistenceEnabled === 'function') {
      setResultRecorderPersistenceEnabled(true);
    }

    devStub = sinon.stub(Log, 'dev');
    warnStub = sinon.stub(Log, 'warn');
  });

  afterEach(() => {
    sinon.restore();
    jest.restoreAllMocks();
  });

  it('should insert decision rule result when no recorder override', async () => {
    const now = new Date();
    const record: RecordResult = {
      steps: [{ step: 'test', result: { status: 'success' }, timestamp: now }],
      event: null as any,
      name: 'r',
      user: null as any,
    };
    await handleDecisionRuleResult(record);

    const client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const docs = await db.collection(DECISION_RULE_RESULTS).find().toArray();
    expect(docs.length).toBe(1);
    expect(docs[0].steps).toEqual(record.steps);
    await client.close();

    // No fallback dev-log from the recorder
    sinon.assert.neverCalledWithMatch(devStub, TAG_DECISION);
  });

  it('should not insert decision rule result when recorder override is set', async () => {
    const callback = jest.fn();
    setDecisionRuleResultRecorder(callback);
    const now = new Date();
    const record: RecordResult = {
      steps: [{ step: 'x', result: { status: 'success' }, timestamp: now }],
      event: null as any,
      name: 'r',
      user: null as any,
    };

    await handleDecisionRuleResult(record);
    expect(callback).toHaveBeenCalledWith(record);

    const client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const docs = await db.collection(DECISION_RULE_RESULTS).find().toArray();
    expect(docs.length).toBe(0);
    await client.close();

    // No fallback dev-log from the recorder
    sinon.assert.neverCalledWithMatch(devStub, TAG_DECISION);
  });

  it('should insert task result when no recorder override', async () => {
    const now = new Date();
    const record: RecordResult = {
      steps: [{ step: 't', result: { status: 'success' }, timestamp: now }],
      event: null as any,
      name: 'r',
      user: null as any,
    };
    await handleTaskResult(record);

    const client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const docs = await db.collection(TASK_RESULTS).find().toArray();
    expect(docs.length).toBe(1);
    expect(docs[0].steps).toEqual(record.steps);
    await client.close();

    // No fallback dev-log from the recorder
    sinon.assert.neverCalledWithMatch(devStub, TAG_TASK);
  });

  it('should fallback to decision recorder when task recorder not set but decision set', async () => {
    const decisionCb = jest.fn();
    setDecisionRuleResultRecorder(decisionCb);
    const now = new Date();
    const record: RecordResult = {
      steps: [{ step: 'f', result: { status: 'success' }, timestamp: now }],
      event: null as any,
      name: 'r',
      user: null as any,
    };

    await handleTaskResult(record);
    expect(decisionCb).toHaveBeenCalledWith(record);

    const client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    const count = await client
      .db(process.env.DB_NAME)
      .collection(TASK_RESULTS)
      .countDocuments();
    // no task collection insert
    expect(count).toBe(0);
    await client.close();

    // No fallback dev-log from the recorder
    sinon.assert.neverCalledWithMatch(devStub, TAG_TASK);
  });

  it('should not insert when hasResultRecord is false', async () => {
    const empty: RecordResult = { steps: [], event: null as any, name: '', user: null as any };
    await handleDecisionRuleResult(empty);
    await handleTaskResult(empty);

    const client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    expect(await db.collection(DECISION_RULE_RESULTS).countDocuments()).toBe(0);
    expect(await db.collection(TASK_RESULTS).countDocuments()).toBe(0);
    await client.close();

    // No fallback dev-log from the recorder
    sinon.assert.neverCalledWithMatch(devStub, TAG_DECISION);
    sinon.assert.neverCalledWithMatch(devStub, TAG_TASK);
  });

  it('decision writer throws → warns and inserts via DB', async () => {
    setDecisionRuleResultRecorder(() => {
      throw new Error('boom');
    });
    const now = new Date();
    const record: RecordResult = {
      steps: [{ step: 'd-writer-throws', result: { status: 'success' }, timestamp: now }],
      event: null as any,
      name: 'decision',
      user: null as any,
    };

    await handleDecisionRuleResult(record);

    const client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const docs = await db.collection(DECISION_RULE_RESULTS).find().toArray();
    expect(docs.length).toBe(1);
    await client.close();

    expect(warnStub.called).toBe(true);
    // No fallback dev-log from the recorder path here
    sinon.assert.neverCalledWithMatch(devStub, TAG_DECISION);
  });

  it('task writer throws → warns and inserts via DB', async () => {
    setTaskResultRecorder(() => {
      throw new Error('boom');
    });
    const now = new Date();
    const record: RecordResult = {
      steps: [{ step: 't-writer-throws', result: { status: 'success' }, timestamp: now }],
      event: null as any,
      name: 'task',
      user: null as any,
    };

    await handleTaskResult(record);

    const client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const docs = await db.collection(TASK_RESULTS).find().toArray();
    expect(docs.length).toBe(1);
    await client.close();

    expect(warnStub.called).toBe(true);
    // No fallback dev-log from the recorder path here
    sinon.assert.neverCalledWithMatch(devStub, TAG_TASK);
  });

  it('DM write rejects → warns and logs to console (no insert)', async () => {
    const rejectStub = jest
      .spyOn(dataManager, 'addItemToCollection')
      .mockRejectedValueOnce(new Error('dm write failed'));

    const now = new Date();
    const record: RecordResult = {
      steps: [{ step: 'dm-write-fails', result: { status: 'success' }, timestamp: now }],
      event: null as any,
      name: 'task',
      user: null as any,
    };

    await handleTaskResult(record);

    const client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    const docs = await db.collection(TASK_RESULTS).find().toArray();
    expect(docs.length).toBe(0);
    await client.close();

    expect(rejectStub).toHaveBeenCalled();
    expect(warnStub.called).toBe(true);
    expect(devStub.calledOnce).toBe(true);
    expect(devStub.firstCall.args[0]).toBe(TAG_TASK);
    expect(devStub.firstCall.args[1]).toEqual(record);
  });

  it('Lite-style: DM getInstance throws → logs to console (no insert)', async () => {
    setDecisionRuleResultRecorder(null as any);
    setTaskResultRecorder(null as any);

    jest.spyOn(DataManager, 'getInstance').mockImplementationOnce(() => {
      throw new Error('no DM in Lite');
    });

    const now = new Date();
    const record: RecordResult = {
      steps: [{ step: 'lite-fallback', result: { status: 'success' }, timestamp: now }],
      event: null as any,
      name: 'decision',
      user: null as any,
    };

    await handleDecisionRuleResult(record);

    const client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    expect(await db.collection(DECISION_RULE_RESULTS).countDocuments()).toBe(0);
    await client.close();

    expect(devStub.calledOnce).toBe(true);
    expect(devStub.firstCall.args[0]).toBe(TAG_DECISION);
    expect(devStub.firstCall.args[1]).toEqual(record);
  });


  it('Lite mode (persistence disabled): logs to console and never touches DB', async () => {
    if (typeof setResultRecorderPersistenceEnabled === 'function') {
      setResultRecorderPersistenceEnabled(false);
    }

    const now = new Date();
    const record: RecordResult = {
      steps: [{ step: 'lite-toggle', result: { status: 'success' }, timestamp: now }],
      event: null as any,
      name: 'task',
      user: null as any,
    };

    // Call both to cover both paths
    await handleDecisionRuleResult(record);
    await handleTaskResult(record);

    const client = new MongoClient(process.env.MONGO_URI!);
    await client.connect();
    const db = client.db(process.env.DB_NAME);
    expect(await db.collection(DECISION_RULE_RESULTS).countDocuments()).toBe(0);
    expect(await db.collection(TASK_RESULTS).countDocuments()).toBe(0);
    await client.close();

    // Should have logged twice (decision + task), with exact tags and full record
    expect(devStub.callCount).toBe(2);
    expect(devStub.getCall(0).args[0]).toBe(TAG_DECISION);
    expect(devStub.getCall(0).args[1]).toEqual(record);
    expect(devStub.getCall(1).args[0]).toBe(TAG_TASK);
    expect(devStub.getCall(1).args[1]).toEqual(record);

    // Optionally re-enable persistence for any following tests
    if (typeof setResultRecorderPersistenceEnabled === 'function') {
      setResultRecorderPersistenceEnabled(true);
    }
  });
});
