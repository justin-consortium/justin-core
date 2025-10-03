// src/event/__tests__/event-executor.spec.ts
import sinon from 'sinon';
import { executeEventForUsers } from '../event-executor';
import { EventHandlerManager } from '../event-handler-manager';

import * as TaskManager from '../../handlers/task.manager';
import * as DecisionRuleManager from '../../handlers/decision-rule.manager';
import { Log } from '../../logger/logger-manager';

import type { JEvent } from '../event.type';
import type { JUser } from '../../user-manager/user.type';
import type { Task, DecisionRule } from '../../handlers/handler.type';

// Shared stubs for modules / singletons (same pattern as your other tests)
const handlerManager = EventHandlerManager.getInstance();

const getHandlersForEventTypeStub = sinon.stub(handlerManager, 'getHandlersForEventType');

const getTaskByNameStub = sinon.stub(TaskManager, 'getTaskByName');
const executeTaskStub = sinon.stub(TaskManager, 'executeTask');

const getDecisionRuleByNameStub = sinon.stub(DecisionRuleManager, 'getDecisionRuleByName');
const executeDecisionRuleStub = sinon.stub(DecisionRuleManager, 'executeDecisionRule');

const logWarnStub = sinon.stub(Log, 'warn');
const logErrorStub = sinon.stub(Log, 'error');

describe('executeEventForUsers', () => {
  const event: JEvent = {
    eventType: 'TEST_EVENT',
    generatedTimestamp: new Date(),
  } as JEvent;

  const users: JUser[] = [
    { id: 'u1', uniqueIdentifier: 'u1', attributes: {} } as JUser,
    { id: 'u2', uniqueIdentifier: 'u2', attributes: {} } as JUser,
  ];

  beforeEach(() => {
    getHandlersForEventTypeStub.reset();
    getTaskByNameStub.reset();
    executeTaskStub.reset();
    getDecisionRuleByNameStub.reset();
    executeDecisionRuleStub.reset();
    logWarnStub.reset();
    logErrorStub.reset();
  });

  afterAll(() => {
    getHandlersForEventTypeStub.restore();
    getTaskByNameStub.restore();
    executeTaskStub.restore();
    getDecisionRuleByNameStub.restore();
    executeDecisionRuleStub.restore();
    logWarnStub.restore();
    logErrorStub.restore();
  });

  describe('when no handlers are registered', () => {
    it('returns early and warns', async () => {
      getHandlersForEventTypeStub.returns([]);

      await executeEventForUsers(event, users, handlerManager);

      expect(getHandlersForEventTypeStub.calledWith('TEST_EVENT')).toBe(true);
      expect(logWarnStub.calledWith('No handlers registered for event type "TEST_EVENT".')).toBe(true);
      expect(getTaskByNameStub.called).toBe(false);
      expect(getDecisionRuleByNameStub.called).toBe(false);
      expect(executeTaskStub.called).toBe(false);
      expect(executeDecisionRuleStub.called).toBe(false);
    });
  });

  describe('task path', () => {
    it('runs beforeExecution once, executes per user, runs afterExecution once', async () => {
      getHandlersForEventTypeStub.returns(['taskA']);

      const mockTask: Task = {
        name: 'taskA',
        beforeExecution: () => {},
        afterExecution: () => {},
      } as unknown as Task;

      const beforeStub = sinon.stub(mockTask, 'beforeExecution').resolves();
      const afterStub = sinon.stub(mockTask, 'afterExecution').resolves();

      getTaskByNameStub.withArgs('taskA').returns(mockTask);
      getDecisionRuleByNameStub.withArgs('taskA').returns(undefined);
      executeTaskStub.resolves();

      await executeEventForUsers(event, users, handlerManager);

      expect(beforeStub.calledOnceWith(event)).toBe(true);
      expect(executeTaskStub.calledTwice).toBe(true);
      expect(executeTaskStub.firstCall.calledWith(mockTask, event, users[0])).toBe(true);
      expect(executeTaskStub.secondCall.calledWith(mockTask, event, users[1])).toBe(true);
      expect(afterStub.calledOnceWith(event)).toBe(true);
    });

    it('logs beforeExecution error and still runs per-user and afterExecution', async () => {
      getHandlersForEventTypeStub.returns(['taskA']);

      const mockTask: Task = {
        name: 'taskA',
        beforeExecution: () => {},
        afterExecution: () => {},
      } as unknown as Task;

      const beforeStub = sinon.stub(mockTask, 'beforeExecution').rejects(new Error('boom-before'));
      const afterStub = sinon.stub(mockTask, 'afterExecution').resolves();

      getTaskByNameStub.withArgs('taskA').returns(mockTask);
      getDecisionRuleByNameStub.withArgs('taskA').returns(undefined);
      executeTaskStub.resolves();

      await executeEventForUsers(event, users, handlerManager);

      expect(beforeStub.calledOnceWith(event)).toBe(true);
      expect(logErrorStub.calledWith(
        'beforeExecution error for "taskA" on event "TEST_EVENT": Error: boom-before'
      )).toBe(true);
      expect(executeTaskStub.calledTwice).toBe(true);
      expect(afterStub.calledOnceWith(event)).toBe(true);
    });

    it('logs execution error per user and continues', async () => {
      getHandlersForEventTypeStub.returns(['taskA']);

      const mockTask: Task = { name: 'taskA' } as Task;
      getTaskByNameStub.withArgs('taskA').returns(mockTask);
      getDecisionRuleByNameStub.withArgs('taskA').returns(undefined);

      executeTaskStub.onFirstCall().rejects(new Error('u1-fail'));
      executeTaskStub.onSecondCall().resolves();

      await executeEventForUsers(event, users, handlerManager);

      expect(executeTaskStub.calledTwice).toBe(true);
      expect(logErrorStub.calledWith(
        'Execution error for "taskA" on user "u1" (event "TEST_EVENT"): Error: u1-fail'
      )).toBe(true);
    });

    it('logs afterExecution error and completes', async () => {
      getHandlersForEventTypeStub.returns(['taskA']);

      const mockTask: Task = {
        name: 'taskA',
        beforeExecution: () => {},
        afterExecution: () => {},
      } as unknown as Task;

      sinon.stub(mockTask, 'beforeExecution').resolves();
      const afterStub = sinon.stub(mockTask, 'afterExecution').rejects(new Error('boom-after'));

      getTaskByNameStub.withArgs('taskA').returns(mockTask);
      getDecisionRuleByNameStub.withArgs('taskA').returns(undefined);
      executeTaskStub.resolves();

      await executeEventForUsers(event, users, handlerManager);

      expect(afterStub.calledOnceWith(event)).toBe(true);
      expect(logErrorStub.calledWith(
        'afterExecution error for "taskA" on event "TEST_EVENT": Error: boom-after'
      )).toBe(true);
    });
  });

  describe('decision rule path', () => {
    it('runs beforeExecution once, executes per user, runs afterExecution once', async () => {
      getHandlersForEventTypeStub.returns(['ruleA']);

      const mockRule: DecisionRule = {
        name: 'ruleA',
        beforeExecution: () => {},
        afterExecution: () => {},
      } as unknown as DecisionRule;

      const beforeStub = sinon.stub(mockRule, 'beforeExecution').resolves();
      const afterStub = sinon.stub(mockRule, 'afterExecution').resolves();

      getTaskByNameStub.withArgs('ruleA').returns(undefined);
      getDecisionRuleByNameStub.withArgs('ruleA').returns(mockRule);
      executeDecisionRuleStub.resolves();

      await executeEventForUsers(event, users, handlerManager);

      expect(beforeStub.calledOnceWith(event)).toBe(true);
      expect(executeDecisionRuleStub.calledTwice).toBe(true);
      expect(executeDecisionRuleStub.firstCall.calledWith(mockRule, event, users[0])).toBe(true);
      expect(executeDecisionRuleStub.secondCall.calledWith(mockRule, event, users[1])).toBe(true);
      expect(afterStub.calledOnceWith(event)).toBe(true);
    });

    it('logs execution error per user and continues', async () => {
      getHandlersForEventTypeStub.returns(['ruleA']);

      const mockRule: DecisionRule = { name: 'ruleA' } as DecisionRule;

      getTaskByNameStub.withArgs('ruleA').returns(undefined);
      getDecisionRuleByNameStub.withArgs('ruleA').returns(mockRule);

      executeDecisionRuleStub.onFirstCall().rejects(new Error('u1-fail'));
      executeDecisionRuleStub.onSecondCall().resolves();

      await executeEventForUsers(event, users, handlerManager);

      expect(executeDecisionRuleStub.calledTwice).toBe(true);
      expect(logErrorStub.calledWith(
        'Execution error for "ruleA" on user "u1" (event "TEST_EVENT"): Error: u1-fail'
      )).toBe(true);
    });

    it('logs lifecycle errors and continues', async () => {
      getHandlersForEventTypeStub.returns(['ruleA']);

      const mockRule: DecisionRule = {
        name: 'ruleA',
        beforeExecution: () => {},
        afterExecution: () => {},
      } as unknown as DecisionRule;

      const beforeStub = sinon.stub(mockRule, 'beforeExecution').rejects(new Error('boom-before'));
      const afterStub = sinon.stub(mockRule, 'afterExecution').rejects(new Error('boom-after'));

      getTaskByNameStub.withArgs('ruleA').returns(undefined);
      getDecisionRuleByNameStub.withArgs('ruleA').returns(mockRule);
      executeDecisionRuleStub.resolves();

      await executeEventForUsers(event, users, handlerManager);

      expect(beforeStub.calledOnceWith(event)).toBe(true);
      expect(logErrorStub.calledWith(
        'beforeExecution error for "ruleA" on event "TEST_EVENT": Error: boom-before'
      )).toBe(true);

      expect(executeDecisionRuleStub.calledTwice).toBe(true);

      expect(afterStub.calledOnceWith(event)).toBe(true);
      expect(logErrorStub.calledWith(
        'afterExecution error for "ruleA" on event "TEST_EVENT": Error: boom-after'
      )).toBe(true);
    });
  });

  describe('unknown handler', () => {
    it('warns per user when neither task nor rule is found', async () => {
      getHandlersForEventTypeStub.returns(['ghost']);
      getTaskByNameStub.withArgs('ghost').returns(undefined);
      getDecisionRuleByNameStub.withArgs('ghost').returns(undefined);

      await executeEventForUsers(event, users, handlerManager);

      expect(logWarnStub.calledTwice).toBe(true);
      expect(logWarnStub.firstCall.calledWith('Handler "ghost" not found; skipping.')).toBe(true);
      expect(logWarnStub.secondCall.calledWith('Handler "ghost" not found; skipping.')).toBe(true);
    });
  });
});
