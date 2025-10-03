import sinon from 'sinon';
import { JustInLite, JustInLiteWrapper } from '../JustInLite'; // <- adjust path if needed
import * as EventExecutor from '../event/event-executor';
import * as LoggerManager from '../logger/logger-manager';
import * as ResultRecorder from '../handlers/result-recorder';
import { EventHandlerManager } from '../event/event-handler-manager';
import type { JUser, NewUserRecord } from '../user-manager/user.type';

describe('JustInLite (Sinon)', () => {
  let justin: JustInLiteWrapper;
  let ehm: EventHandlerManager;
  let sandbox: sinon.SinonSandbox;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    await JustInLite().killInstance();

    justin = JustInLite();
    ehm = EventHandlerManager.getInstance();
    ehm.clearEventHandlers?.();
  });

  afterEach(async () => {
    sandbox.restore();
    await JustInLite().killInstance();
  });

  describe('Users (in-memory)', () => {
    it('accepts NewUserRecord[] and normalizes to JUser[]', async () => {
      const input: NewUserRecord[] = [
        { uniqueIdentifier: 'u1', initialAttributes: { a: 1 } },
        { uniqueIdentifier: 'u2', initialAttributes: { b: 2 } },
      ];

      const infoStub = sandbox.stub(LoggerManager.Log, 'info');

      const result = await justin.loadUsers(input);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'u1',
        uniqueIdentifier: 'u1',
        attributes: { a: 1 },
      });
      expect(result[1]).toEqual({
        id: 'u2',
        uniqueIdentifier: 'u2',
        attributes: { b: 2 },
      });

      sinon.assert.called(infoStub);
    });

    it('accepts JUser[] and replaces in-memory set atomically', async () => {
      const first: JUser[] = [
        { id: 'a', uniqueIdentifier: 'a', attributes: { foo: 1 } },
      ];
      const second: JUser[] = [
        { id: 'b', uniqueIdentifier: 'b', attributes: { bar: 2 } },
      ];

      await justin.loadUsers(first);
      await justin.loadUsers(second);

      const regSpy = sandbox.spy(ehm, 'registerEventHandlers');
      await justin.registerEventHandlers('EV', ['HandlerA']);
      sinon.assert.calledOnce(regSpy);

      const execStub = sandbox.stub(EventExecutor, 'executeEventForUsers').resolves();

      await justin.publishEvent('EV', new Date());
      sinon.assert.calledOnce(execStub);

      const usersPassed = execStub.getCall(0).args[1] as JUser[];
      expect(usersPassed).toHaveLength(1);
      expect(usersPassed[0].uniqueIdentifier).toBe('b');
    });

    it('throws on missing uniqueIdentifier', async () => {
      const bad: any[] = [{ id: 'x' }];
      await expect(justin.loadUsers(bad as any)).rejects.toThrow(/UniqueIdentifier is missing/i);
    });

    it('throws on duplicates within the same call', async () => {
      const dup: NewUserRecord[] = [
        { uniqueIdentifier: 'z', initialAttributes: { name: 'test' } },
        { uniqueIdentifier: 'z', initialAttributes: { name: 'test' } },
      ];
      await expect(justin.loadUsers(dup)).rejects.toThrow(/duplicate uniqueIdentifier "z"/i);
    });
  });

  describe('Execution / publishEvent', () => {
    it('throws if no users loaded', async () => {
      await justin.registerEventHandlers('EV', ['H']);
      await expect(justin.publishEvent('EV', new Date())).rejects.toThrow(/no users loaded/i);
    });

    it('throws if event type not registered', async () => {
      await justin.loadUsers([{ id: 'u', uniqueIdentifier: 'u', attributes: {} }]);
      await expect(justin.publishEvent('MISSING', new Date())).rejects.toThrow(/No handlers registered/i);
    });

    it('builds event and calls shared executor once', async () => {
      await justin.registerEventHandlers('EV', ['H']);
      await justin.loadUsers([{ id: 'u', uniqueIdentifier: 'u', attributes: {} }]);

      const execStub = sandbox.stub(EventExecutor, 'executeEventForUsers').resolves();
      const ts = new Date('2025-01-01T00:00:00Z');
      const details = { cloudEventId: '123' };

      await justin.publishEvent('EV', ts, details);

      sinon.assert.calledOnce(execStub);
      const [eventArg, usersArg] = execStub.getCall(0).args;
      expect(eventArg).toMatchObject({
        eventType: 'EV',
        generatedTimestamp: ts,
        eventDetails: details,
      });
      expect((usersArg as JUser[])[0].uniqueIdentifier).toBe('u');
    });

    it('idempotencyKey skips duplicate within same warm instance', async () => {
      await justin.registerEventHandlers('EV', ['H']);
      await justin.loadUsers([{ id: 'u', uniqueIdentifier: 'u', attributes: {} }]);

      const warnStub = sandbox.stub(LoggerManager.Log, 'warn');
      const execStub = sandbox.stub(EventExecutor, 'executeEventForUsers').resolves();

      const key = 'k-1';
      await justin.publishEvent('EV', new Date(), {}, key);
      await justin.publishEvent('EV', new Date(), {}, key); // duplicate: skip

      sinon.assert.calledOnce(execStub);
      sinon.assert.calledWithMatch(warnStub, sinon.match(/duplicate execution skipped/i));
    });
  });

  describe('Logger & Writers', () => {
    it('configureLogger delegates to setLogger', () => {
      const setLoggerStub = sandbox.stub(LoggerManager, 'setLogger');
      const fakeLogger = { info: () => {}, warn: () => {}, error: () => {}, dev: () => {} } as any;

      justin.configureLogger(fakeLogger);
      sinon.assert.calledOnceWithExactly(setLoggerStub, fakeLogger);
    });

    it('setLoggingLevels delegates to setLogLevels', () => {
      const setLevelsStub = sandbox.stub(LoggerManager, 'setLogLevels');
      justin.setLoggingLevels({ info: false, dev: true });
      sinon.assert.calledOnceWithExactly(setLevelsStub, { info: false, dev: true });
    });

    it('configureTaskResultWriter, configureDecisionRuleResultWriter delegate to result-recorder', () => {
      const taskStub = sandbox.stub(ResultRecorder, 'setTaskResultRecorder');
      const ruleStub = sandbox.stub(ResultRecorder, 'setDecisionRuleResultRecorder');

      const fn = async () => {};
      justin.configureTaskResultWriter(fn);
      justin.configureDecisionRuleResultWriter(fn);

      sinon.assert.calledOnceWithExactly(taskStub, fn);
      sinon.assert.calledOnceWithExactly(ruleStub, fn);
    });
  });
});
