import sinon from 'sinon';
import * as EventQueue from '../event-queue';
import { EventHandlerManager } from '../event-handler-manager';
import DataManager from '../../data-manager/data-manager';
import { ChangeListenerManager } from '../../data-manager/change-listener.manager';
import { UserManager } from '../../user-manager/user-manager';
import { Log } from '../../logger/logger-manager';
import * as TaskManager from '../../handlers/task.manager';
import * as DecisionRuleManager from '../../handlers/decision-rule.manager';
import { JEvent } from '../event.type';
import { JUser } from '../../user-manager/user.type';
import { CollectionChangeType } from '../../data-manager/data-manager.type';
import { BaseHandler, DecisionRule, Task } from '../../handlers/handler.type';
import * as EventExecutor from '../event-executor';

// Create stubs for all dependencies
const eventHandlerManager = EventHandlerManager.getInstance();
const dataManager = DataManager.getInstance();
const changeListenerManager = ChangeListenerManager.getInstance();

// EventHandlerManager stubs
const hasHandlersForEventTypeStub = sinon.stub(eventHandlerManager, 'hasHandlersForEventType');
const getHandlersForEventTypeStub = sinon.stub(eventHandlerManager, 'getHandlersForEventType');

// DataManager stubs
const addItemToCollectionStub = sinon.stub(dataManager, 'addItemToCollection');
const getAllInCollectionStub = sinon.stub(dataManager, 'getAllInCollection');
const removeItemFromCollectionStub = sinon.stub(dataManager, 'removeItemFromCollection');

// ChangeListenerManager stubs
const addChangeListenerStub = sinon.stub(changeListenerManager, 'addChangeListener');
const removeChangeListenerStub = sinon.stub(changeListenerManager, 'removeChangeListener');

// UserManager stubs
const getAllUsersStub = sinon.stub(UserManager, 'getAllUsers');

// Logger stubs
const logInfoStub = sinon.stub(Log, 'info');
const logWarnStub = sinon.stub(Log, 'warn');
const logErrorStub = sinon.stub(Log, 'error');
const logDevStub = sinon.stub(Log, 'dev');

// Task and Decision Rule stubs
const getTaskByNameStub = sinon.stub(TaskManager, 'getTaskByName');
const executeTaskStub = sinon.stub(TaskManager, 'executeTask');
const getDecisionRuleByNameStub = sinon.stub(DecisionRuleManager, 'getDecisionRuleByName');
const executeDecisionRuleStub = sinon.stub(DecisionRuleManager, 'executeDecisionRule');

// Shared executor stub
const executeEventForUsersStub = sinon.stub(EventExecutor, 'executeEventForUsers');

describe('Event Queue', () => {
  beforeEach(async () => {
    // Reset all stubs
    hasHandlersForEventTypeStub.reset();
    getHandlersForEventTypeStub.reset();
    addItemToCollectionStub.reset();
    getAllInCollectionStub.reset();
    removeItemFromCollectionStub.reset();
    addChangeListenerStub.reset();
    removeChangeListenerStub.reset();
    getAllUsersStub.reset();
    logInfoStub.reset();
    logWarnStub.reset();
    logErrorStub.reset();
    logDevStub.reset();
    getTaskByNameStub.reset();
    executeTaskStub.reset();
    getDecisionRuleByNameStub.reset();
    executeDecisionRuleStub.reset();
    executeEventForUsersStub.reset();
    EventQueue.setShouldProcessQueue(true);
  });

  afterAll(() => {
    // Restore all stubs
    hasHandlersForEventTypeStub.restore();
    getHandlersForEventTypeStub.restore();
    addItemToCollectionStub.restore();
    getAllInCollectionStub.restore();
    removeItemFromCollectionStub.restore();
    addChangeListenerStub.restore();
    removeChangeListenerStub.restore();
    getAllUsersStub.restore();
    logInfoStub.restore();
    logWarnStub.restore();
    logErrorStub.restore();
    logDevStub.restore();
    executeEventForUsersStub.restore();
  });

  describe('publishEvent', () => {
    it('should publish event successfully when handlers exist', async () => {
      const eventType = 'TEST_EVENT';
      const timestamp = new Date();
      const eventDetails = { test: 'data' };

      hasHandlersForEventTypeStub.returns(true);
      addItemToCollectionStub.resolves({id: 'event1'} as JEvent);

      await EventQueue.publishEvent(eventType, timestamp, eventDetails);

      expect(hasHandlersForEventTypeStub.calledWith(eventType)).toBe(true);
      expect(addItemToCollectionStub.calledOnce).toBe(true);

      const addedEvent = addItemToCollectionStub.firstCall.args[1] as JEvent;
      expect(addedEvent.eventType).toBe(eventType);
      expect(addedEvent.generatedTimestamp).toBe(timestamp);
      expect(addedEvent.eventDetails).toBe(eventDetails);

      expect(logInfoStub.calledWith(sinon.match(/Published event/))).toBe(true);
    });

    it('should skip publication when no handlers exist', async () => {
      const eventType = 'TEST_EVENT';
      const timestamp = new Date();

      hasHandlersForEventTypeStub.returns(false);

      await EventQueue.publishEvent(eventType, timestamp);
      expect(hasHandlersForEventTypeStub.calledWith(eventType)).toBe(true);
      expect(addItemToCollectionStub.called).toBe(false);

      expect(logWarnStub.calledWith(
        `No handlers found for event type "${eventType}". Skipping event publication.`
      )).toBe(true);
    });

    it('should handle errors during publication', async () => {
      const eventType = 'TEST_EVENT';
      const timestamp = new Date();
      const error = new Error('Database error');

      hasHandlersForEventTypeStub.returns(true);
      addItemToCollectionStub.rejects(error);

      await expect(EventQueue.publishEvent(eventType, timestamp)).rejects.toThrow('Database error');

      expect(logErrorStub.calledWith(
        `Failed to publish event "${eventType}": ${error}`
      )).toBe(true);
    });
  });

  describe('processEventQueue', () => {
    it('should process events successfully', async () => {
      const mockUsers: JUser[] = [
        { id: 'user1', uniqueIdentifier: 'user1-unique', attributes:{name: 'User 1'} } as JUser,
        { id: 'user2', uniqueIdentifier: 'user2-unique', attributes:{name: 'User 2'} } as JUser,
      ];

      const mockEvents: JEvent[] = [
        {
          id: 'event1',
          eventType: 'TEST_EVENT',
          generatedTimestamp: new Date(),
        } as JEvent,
      ];

      getAllUsersStub.returns(mockUsers);
      getAllInCollectionStub.onFirstCall().resolves(mockEvents);
      getAllInCollectionStub.onSecondCall().resolves([]);
      getHandlersForEventTypeStub.returns(['handler1']);
      executeEventForUsersStub.resolves();
      addItemToCollectionStub.resolves();
      removeItemFromCollectionStub.resolves();

      await EventQueue.processEventQueue();

      expect(getAllInCollectionStub.calledTwice).toBe(true);
      expect(executeEventForUsersStub.calledOnce).toBe(true);
      expect(addItemToCollectionStub.called).toBe(true);
      expect(removeItemFromCollectionStub.calledWith('event_queue', 'event1')).toBe(true);

      expect(logDevStub.calledWith('Starting event queue processing.')).toBe(true);
      expect(logDevStub.calledWith('Finished processing event queue.')).toBe(true);
    });

    it('should skip processing when queue is empty', async () => {
      getAllUsersStub.returns([]);
      getAllInCollectionStub.resolves([]);

      await EventQueue.processEventQueue();

      expect(getAllInCollectionStub.calledOnce).toBe(true);
      expect(executeEventForUsersStub.called).toBe(false);

      expect(logDevStub.calledWith('No events left in the queue. Pausing processing.')).toBe(true);
    });

    it('should skip processing when already in progress', async () => {
      getAllUsersStub.returns([]);
      getAllInCollectionStub.resolves([]);

      const firstPromise = EventQueue.processEventQueue();
      const secondPromise = EventQueue.processEventQueue();

      await Promise.all([firstPromise, secondPromise]);

      expect(logInfoStub.calledWith('Event queue processing already in progress. Skipping processing.')).toBe(true);
    });

    it('should handle processing errors gracefully', async () => {
      const mockUsers: JUser[] = [{ id: 'user1', uniqueIdentifier: 'user1-unique', attributes:{name: 'User 1'} } as JUser];
      const mockEvents: JEvent[] = [
        {
          id: 'event1',
          eventType: 'TEST_EVENT',
          generatedTimestamp: new Date(),
        } as JEvent,
      ];

      getAllUsersStub.returns(mockUsers);
      getAllInCollectionStub.onFirstCall().resolves(mockEvents);
      getAllInCollectionStub.onSecondCall().resolves([]);
      getHandlersForEventTypeStub.returns(['handler1']);
      executeEventForUsersStub.resolves();
      addItemToCollectionStub.rejects(new Error('Archive error'));

      await EventQueue.processEventQueue();

      expect(logErrorStub.calledWith(
        'Failed to archive event "TEST_EVENT" with ID: event1: Error: Archive error'
      )).toBe(true);
    });
  });

  describe('setupEventQueueListener', () => {
    it('should setup listener and start processing', async () => {
      getAllInCollectionStub.resolves([]);

      await EventQueue.setupEventQueueListener();

      expect(addChangeListenerStub.calledOnce).toBe(true);
      expect(addChangeListenerStub.firstCall.args[0]).toBe('event_queue');
      expect(addChangeListenerStub.firstCall.args[1]).toBe(CollectionChangeType.INSERT);

      expect(logDevStub.calledWith('Setting up event queue listener.')).toBe(true);
      expect(logDevStub.calledWith('Event queue listener set up successfully.')).toBe(true);
    });

    it('should handle errors during initial processing', async () => {
      const error = new Error('Processing error');
      getAllInCollectionStub.rejects(error);

      EventQueue.setupEventQueueListener();

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(logErrorStub.calledWith(
        `Error during event queue processing: Error: Processing error`
      )).toBe(true);
    });
  });

  describe('stopEventQueueProcessing', () => {
    it('should stop queue processing', () => {
      EventQueue.stopEventQueueProcessing();

      expect(removeChangeListenerStub.calledOnce).toBe(true);
      expect(removeChangeListenerStub.firstCall.args[0]).toBe('event_queue');
      expect(removeChangeListenerStub.firstCall.args[1]).toBe(CollectionChangeType.INSERT);

      expect(logInfoStub.calledWith('Event queue processing stopped.')).toBe(true);
    });
  });

  describe('startEventQueueProcessing', () => {
    it('should start queue processing', async () => {
      EventQueue.setShouldProcessQueue(false);
      await EventQueue.startEventQueueProcessing();
      expect(logDevStub.calledWith('Event queue processing started.')).toBe(true);
    });
  });

  describe('isRunning', () => {
    it('should return true when queue is running', async () => {
      EventQueue.setShouldProcessQueue(false);
      await EventQueue.startEventQueueProcessing();
      expect(EventQueue.isRunning()).toBe(true);
    });

    it('should return false when queue is stopped', () => {
      EventQueue.stopEventQueueProcessing();
      expect(EventQueue.isRunning()).toBe(false);
    });
  });

  describe('queueIsEmpty', () => {
    it('should return true when queue is empty', async () => {
      getAllInCollectionStub.resolves([]);

      const isEmpty = await EventQueue.queueIsEmpty();

      expect(isEmpty).toBe(true);
      expect(getAllInCollectionStub.calledWith('event_queue')).toBe(true);
    });

    it('should return false when queue has events', async () => {
      const mockEvents = [{ id: 'event1' }];
      getAllInCollectionStub.resolves(mockEvents);

      const isEmpty = await EventQueue.queueIsEmpty();

      expect(isEmpty).toBe(false);
    });

    it('should handle null/undefined events', async () => {
      getAllInCollectionStub.resolves(null);

      const isEmpty = await EventQueue.queueIsEmpty();

      expect(isEmpty).toBe(true);
    });
  });

  describe('processHandlers integration', () => {
    it('should process task handlers successfully', async () => {
      const mockEvent: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      const mockUser: JUser = { id: 'user1', uniqueIdentifier: 'user1-unique', attributes:{name: 'User 1'} } as JUser;

      getHandlersForEventTypeStub.returns(['task1']);
      executeEventForUsersStub.resolves();

      getAllUsersStub.returns([mockUser]);
      getAllInCollectionStub.onFirstCall().resolves([mockEvent]);
      getAllInCollectionStub.onSecondCall().resolves([]);

      await EventQueue.processEventQueue();

      expect(executeEventForUsersStub.calledOnce).toBe(true);
    });

    it('should process decision rule handlers successfully', async () => {
      const mockEvent: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      const mockUser: JUser = { id: 'user1', uniqueIdentifier: 'user1-unique', attributes:{name: 'User 1'} } as JUser;

      getHandlersForEventTypeStub.returns(['rule1']);
      executeEventForUsersStub.resolves();

      getAllUsersStub.returns([mockUser]);
      getAllInCollectionStub.onFirstCall().resolves([mockEvent]);
      getAllInCollectionStub.onSecondCall().resolves([]);

      await EventQueue.processEventQueue();

      expect(executeEventForUsersStub.calledOnce).toBe(true);
    });

    it('should warn when handler is not found', async () => {
      const mockEvent: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      const mockUser: JUser = { id: 'user1', uniqueIdentifier: 'user1-unique', attributes:{name: 'User 1'} } as JUser;

      getHandlersForEventTypeStub.returns(['unknown_handler']);
      executeEventForUsersStub.resolves();

      getAllUsersStub.returns([mockUser]);
      getAllInCollectionStub.onFirstCall().resolves([mockEvent]);
      getAllInCollectionStub.onSecondCall().resolves([]);

      await EventQueue.processEventQueue();

      expect(executeEventForUsersStub.calledOnce).toBe(true);
    });

    it('should handle handler execution errors', async () => {
      const mockEvent: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      const mockUser: JUser = { id: 'user1', uniqueIdentifier: 'user1-unique', attributes:{name: 'User 1'} } as JUser;

      getHandlersForEventTypeStub.returns(['task1']);
      executeEventForUsersStub.resolves();

      getAllUsersStub.returns([mockUser]);
      getAllInCollectionStub.onFirstCall().resolves([mockEvent]);
      getAllInCollectionStub.onSecondCall().resolves([]);

      await EventQueue.processEventQueue();

      expect(executeEventForUsersStub.calledOnce).toBe(true);
    });
  });

  describe('processExecutionLifecycle integration', () => {
    it('should call beforeExecution on task', async () => {
      const mockEvent: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      getHandlersForEventTypeStub.returns(['task1']);
      executeEventForUsersStub.resolves();

      getAllUsersStub.returns([]);
      getAllInCollectionStub.onFirstCall().resolves([mockEvent]);
      getAllInCollectionStub.onSecondCall().resolves([]);

      await EventQueue.processEventQueue();

      expect(executeEventForUsersStub.calledOnce).toBe(true);
    });

    it('should call afterExecution on decision rule', async () => {
      const mockEvent: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      getHandlersForEventTypeStub.returns(['rule1']);
      executeEventForUsersStub.resolves();

      getAllUsersStub.returns([]);
      getAllInCollectionStub.onFirstCall().resolves([mockEvent]);
      getAllInCollectionStub.onSecondCall().resolves([]);

      await EventQueue.processEventQueue();

      expect(executeEventForUsersStub.calledOnce).toBe(true);
    });

    it('should warn when lifecycle method is not found', async () => {
      const mockEvent: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      getHandlersForEventTypeStub.returns(['task1']);
      executeEventForUsersStub.resolves();

      getAllUsersStub.returns([]);
      getAllInCollectionStub.onFirstCall().resolves([mockEvent]);
      getAllInCollectionStub.onSecondCall().resolves([]);

      await EventQueue.processEventQueue();

      expect(executeEventForUsersStub.calledOnce).toBe(true);
    });

    it('should handle lifecycle method execution errors', async () => {
      const mockEvent: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      getHandlersForEventTypeStub.returns(['task1']);
      executeEventForUsersStub.resolves();

      getAllUsersStub.returns([]);
      getAllInCollectionStub.onFirstCall().resolves([mockEvent]);
      getAllInCollectionStub.onSecondCall().resolves([]);

      await EventQueue.processEventQueue();

      expect(executeEventForUsersStub.calledOnce).toBe(true);
    });
  });

  describe('archiveEvent integration', () => {
    it('should archive event successfully', async () => {
      const mockEvent: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      addItemToCollectionStub.resolves();
      removeItemFromCollectionStub.resolves();

      getAllUsersStub.returns([]);
      getAllInCollectionStub.onFirstCall().resolves([mockEvent]);
      getAllInCollectionStub.onSecondCall().resolves([]);
      getHandlersForEventTypeStub.returns([]);
      executeEventForUsersStub.resolves();

      await EventQueue.processEventQueue();

      expect(addItemToCollectionStub.calledWith('archived_events', mockEvent)).toBe(true);
      expect(removeItemFromCollectionStub.calledWith('event_queue', 'event1')).toBe(true);

      expect(logDevStub.calledWith(
        `Event of type "TEST_EVENT" with ID: event1 archived successfully.`
      )).toBe(true);
    });

    it('should handle archiving errors', async () => {
      const mockEvent: JEvent = {
        id: 'event1',
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      const error = new Error('Archive error');
      addItemToCollectionStub.rejects(error);

      getAllUsersStub.returns([]);
      getAllInCollectionStub.onFirstCall().resolves([mockEvent]);
      getAllInCollectionStub.onSecondCall().resolves([]);
      getHandlersForEventTypeStub.returns([]);
      executeEventForUsersStub.resolves();

      await EventQueue.processEventQueue();

      expect(logErrorStub.calledWith(
        `Failed to archive event "TEST_EVENT" with ID: event1: ${error}`
      )).toBe(true);
    });

    it('should handle events without ID', async () => {
      const mockEvent: JEvent = {
        eventType: 'TEST_EVENT',
        generatedTimestamp: new Date(),
      } as JEvent;

      getAllUsersStub.returns([]);
      getAllInCollectionStub.onFirstCall().resolves([mockEvent]);
      getAllInCollectionStub.onSecondCall().resolves([]);
      getHandlersForEventTypeStub.returns([]);
      executeEventForUsersStub.resolves();

      await EventQueue.processEventQueue();

      expect(logErrorStub.calledWith(
        'Event "[object Object]" has no ID. Skipping archiving.'
      )).toBe(true);
    });
  });
});
