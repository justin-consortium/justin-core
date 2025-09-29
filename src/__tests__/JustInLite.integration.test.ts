import sinon from 'sinon';
import { JustInLite, JustInLiteWrapper } from '../JustInLite';
import { EventHandlerManager } from '../event/event-handler-manager';
import * as EventExecutor from '../event/event-executor';
import { Log } from '../logger/logger-manager';
import type { JUser, NewUserRecord } from '../user-manager/user.type';
import type { JEvent } from '../event/event.type';

const eventHandlerManager = EventHandlerManager.getInstance();

// EHM stubs
const registerEventHandlersStub = sinon.stub(eventHandlerManager, 'registerEventHandlers');
const unregisterEventHandlersStub = sinon.stub(eventHandlerManager, 'unregisterEventHandlers');
const hasHandlersForEventTypeStub = sinon.stub(eventHandlerManager, 'hasHandlersForEventType');

// Executor stub
const executeEventForUsersStub = sinon.stub(EventExecutor, 'executeEventForUsers');

// Logger stubs
const logInfoStub = sinon.stub(Log, 'info');
const logWarnStub = sinon.stub(Log, 'warn');
const logErrorStub = sinon.stub(Log, 'error');
const logDevStub = sinon.stub(Log, 'dev');

describe('JustInLite', () => {
  let lite: ReturnType<typeof JustInLite>;

  beforeEach(async () => {
    registerEventHandlersStub.reset();
    unregisterEventHandlersStub.reset();
    hasHandlersForEventTypeStub.reset();
    executeEventForUsersStub.reset();
    logInfoStub.reset();
    logWarnStub.reset();
    logErrorStub.reset();
    logDevStub.reset();

    await JustInLiteWrapper.killInstance();
    lite = JustInLite();
  });

  afterEach(async () => {
    await JustInLiteWrapper.killInstance();
  });

  afterAll(() => {
    // fully restore stubs
    registerEventHandlersStub.restore();
    unregisterEventHandlersStub.restore();
    hasHandlersForEventTypeStub.restore();
    executeEventForUsersStub.restore();
    logInfoStub.restore();
    logWarnStub.restore();
    logErrorStub.restore();
    logDevStub.restore();
  });

  describe('addUsers', () => {
    it('adds JUser[] and replaces previous set', async () => {
      const users1: JUser[] = [
        { id: 'a', uniqueIdentifier: 'a', attributes: { n: 1 } } as JUser,
      ];
      const users2: JUser[] = [
        { id: 'b', uniqueIdentifier: 'b', attributes: { n: 2 } } as JUser,
        { id: 'c', uniqueIdentifier: 'c', attributes: { n: 3 } } as JUser,
      ];

      const added1 = await lite.addUsers(users1);
      expect(added1.length).toBe(1);
      expect(added1[0]?.uniqueIdentifier).toBe('a');

      const added2 = await lite.addUsers(users2);
      expect(added2.length).toBe(2);
      expect(added2[0]?.uniqueIdentifier).toBe('b');
      expect(added2[1]?.uniqueIdentifier).toBe('c');
      expect(logInfoStub.calledWithMatch('added 2 users')).toBe(true);
    });

    it('adds from NewUserRecord[] and normalizes to JUser[]', async () => {
      const recs: NewUserRecord[] = [
        { uniqueIdentifier: 'u1', initialAttributes: { x: 1 } },
        { uniqueIdentifier: 'u2', initialAttributes: { x: 2 } },
      ];
      const out = await lite.addUsers(recs);
      expect(out.length).toBe(2);
      expect(out[0]?.uniqueIdentifier).toBe('u1');
      expect(out[0]?.attributes?.x).toBe(1);
      expect(out[1]?.uniqueIdentifier).toBe('u2');
    });

    it('throws on missing uniqueIdentifier', async () => {
      await expect(
        lite.addUsers([{ id: 'no-uid', attributes: {} } as unknown as JUser])
      ).rejects.toThrow("missing required 'uniqueIdentifier'");
      expect(logErrorStub.calledWithMatch("missing required 'uniqueIdentifier'")).toBe(true);
    });

    it('throws on duplicate uniqueIdentifier in same call', async () => {
      await expect(
        lite.addUsers([
          { id: 'x', uniqueIdentifier: 'dup', attributes: {} } as JUser,
          { id: 'y', uniqueIdentifier: 'dup', attributes: {} } as JUser,
        ])
      ).rejects.toThrow('duplicate uniqueIdentifier "dup"');
      expect(logErrorStub.calledWithMatch('duplicate uniqueIdentifier "dup"')).toBe(true);
    });
  });

  describe('registration', () => {
    it('registerEventHandlers caches and forwards to manager', async () => {
      registerEventHandlersStub.resolves();

      await lite.registerEventHandlers('E1', ['A', 'B']);
      expect(registerEventHandlersStub.calledWith('E1', ['A', 'B'], false)).toBe(true);

      const defs = lite.getRegisteredEvents();
      expect(defs['E1']).toEqual(['A', 'B']);
    });

    it('registerEventHandlers prevents duplicate registration', async () => {
      registerEventHandlersStub.resolves();

      await lite.registerEventHandlers('E1', ['A']);
      await expect(lite.registerEventHandlers('E1', ['B'])).rejects.toThrow('already registered');
    });

    it('unregisterEventHandlers removes cache and manager mapping', async () => {
      registerEventHandlersStub.resolves();

      await lite.registerEventHandlers('E1', ['A']);
      lite.unregisterEventHandlers('E1');

      expect(unregisterEventHandlersStub.calledWith('E1')).toBe(true);
      const defs = lite.getRegisteredEvents();
      expect(defs['E1']).toBeUndefined();
    });
  });

  describe('publishEvent', () => {
    it('executes event for loaded users when handlers exist', async () => {
      await lite.addUsers([
        { id: 'u1', uniqueIdentifier: 'u1', attributes: {} } as JUser,
        { id: 'u2', uniqueIdentifier: 'u2', attributes: {} } as JUser,
      ]);
      hasHandlersForEventTypeStub.returns(true);
      executeEventForUsersStub.resolves();

      const ts = new Date();
      await lite.publishEvent('E1', ts, { k: 'v' });

      expect(hasHandlersForEventTypeStub.calledWith('E1')).toBe(true);
      expect(executeEventForUsersStub.calledOnce).toBe(true);

      const call = executeEventForUsersStub.firstCall;
      const eventArg = call.args[0] as JEvent;
      const usersArg = call.args[1] as JUser[];

      expect(eventArg.eventType).toBe('E1');
      expect(eventArg.generatedTimestamp).toBe(ts);
      expect((eventArg.eventDetails as any).k).toBe('v');
      expect(usersArg.length).toBe(2);
    });

    it('skips duplicate when idempotencyKey has been seen', async () => {
      await lite.addUsers([{ id: 'u1', uniqueIdentifier: 'u1', attributes: {} } as JUser]);
      hasHandlersForEventTypeStub.returns(true);
      executeEventForUsersStub.resolves();

      const ts = new Date();
      await lite.publishEvent('E1', ts, {}, 'dup-key');
      await lite.publishEvent('E1', ts, {}, 'dup-key');

      expect(executeEventForUsersStub.calledOnce).toBe(true);
      expect(logWarnStub.calledWithMatch('duplicate execution skipped for key: dup-key')).toBe(true);
    });

    it('throws when no users loaded', async () => {
      hasHandlersForEventTypeStub.returns(true);
      await expect(lite.publishEvent('E1', new Date())).rejects.toThrow('no users loaded');
    });

    it('throws when no handlers registered for event', async () => {
      await lite.addUsers([{ id: 'u1', uniqueIdentifier: 'u1', attributes: {} } as JUser]);
      hasHandlersForEventTypeStub.returns(false);
      await expect(lite.publishEvent('E1', new Date())).rejects.toThrow('No handlers registered');
    });
  });
});
