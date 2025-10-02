import { EventHandlerManager } from './event/event-handler-manager';
import { registerTask as coreRegisterTask } from './handlers/task.manager';
import { registerDecisionRule as coreRegisterDecisionRule } from './handlers/decision-rule.manager';
import { executeEventForUsers } from './event/event-executor';

import {
  setLogger,
  setLogLevels,
  Log,
  logLevels,
} from './logger/logger-manager';
import type {
  TaskRegistration,
  DecisionRuleRegistration,
  RecordResultFunction,
} from './handlers/handler.type';
import type { Logger } from './logger/logger.interface';
import type { JEvent } from './event/event.type';
import type { JUser, NewUserRecord } from './user-manager/user.type';

import {
  setDecisionRuleResultRecorder,
  setTaskResultRecorder,
  setResultRecorderPersistenceEnabled,
} from './handlers/result-recorder';

/**
 * JustInLiteWrapper provides a minimal, serverless-oriented interface for 3rd-party apps:
 * - configure logger & result writers
 * - register tasks, decision rules, and event handlers
 * - keep users in-memory for the current warm instance
 * - run registered events immediately (no DB/queue)
 */
export class JustInLiteWrapper {
  protected static instance: JustInLiteWrapper | null = null;

  /** In-memory idempotency (per warm instance only). */
  private processedKeys = new Set<string>();

  private readonly eventHandlerManager: EventHandlerManager =
    EventHandlerManager.getInstance();

  /** In-memory users for this warm instance (keyed by uniqueIdentifier). */
  private users: Map<string, JUser> = new Map();

  /** Local cache of event definitions (eventType → ordered handler names). */
  private readonly eventDefinitions = new Map<string, string[]>();

  protected constructor() {
    // Lite/serverless: never touch DataManager from the recorder module.
    setResultRecorderPersistenceEnabled(false);
  }

  /** Returns the singleton Lite instance. */
  public static getInstance(): JustInLiteWrapper {
    if (!JustInLiteWrapper.instance) {
      JustInLiteWrapper.instance = new JustInLiteWrapper();
    }
    return JustInLiteWrapper.instance;
  }

  /**
   * Reset the singleton (useful for tests).
   * Includes a 1-tick drain to let any late recorder promises settle.
   */
  public async killInstance(): Promise<void> {
    try {
      // allow any microtasks to flush
      await new Promise<void>((r) => setImmediate(r));
    } finally {
      this.processedKeys.clear();
      this.users.clear();
      this.eventDefinitions.clear();
      this.eventHandlerManager.clearEventHandlers();
      JustInLiteWrapper.instance = null;
    }
  }

  /**
   * Static teardown helper for tests/tools.
   * If an instance exists, delegate to it; otherwise do a best-effort drain+clear.
   * Safe to call multiple times.
   */
  public static async killInstance(): Promise<void> {
    if (JustInLiteWrapper.instance) {
      await JustInLiteWrapper.instance.killInstance();
      return;
    }
    // No instance — still clear any registered handlers to avoid leaks across tests.
    await new Promise<void>((resolve) => setImmediate(resolve));
    EventHandlerManager.getInstance().clearEventHandlers();
  }


  // ────────────────────────────────────────────────────────────────────────────
  // Users (in-memory)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Loads users for the current invocation (serverless-safe).
   * Accepts either `JUser[]` or `NewUserRecord[]`.
   * Replaces the in-memory set each call (atomic), requires `uniqueIdentifier`,
   * and throws on duplicates. Returns the normalized `JUser[]`.
   */
  public async loadUsers(users: JUser[] | NewUserRecord[]): Promise<JUser[]> {
    if (!Array.isArray(users)) {
      throw new Error('loadUsers expects an array.');
    }

    const next = new Map<string, JUser>();
    const normalized: JUser[] = [];

    users.forEach((item, i) => {
      const anyItem = item as any;

      const uniqueIdentifier =
        typeof anyItem?.uniqueIdentifier === 'string' ? anyItem.uniqueIdentifier.trim() : '';
      const idHint = typeof anyItem?.id === 'string' ? anyItem.id : undefined;

      if (!uniqueIdentifier) {
        const msg =
          `loadUsers: item at index ${i} is missing required 'uniqueIdentifier'` +
          (idHint ? ` (id=${idHint})` : '');
        Log.error(msg);
        throw new Error(msg);
      }

      if (next.has(uniqueIdentifier)) {
        const msg = `loadUsers: duplicate uniqueIdentifier "${uniqueIdentifier}" (again at index ${i}).`;
        Log.error(msg);
        throw new Error(msg);
      }

      const attrs =
        'attributes' in anyItem ? (anyItem.attributes ?? {}) :
          'initialAttributes' in anyItem ? (anyItem.initialAttributes ?? {}) :
            {};

      const ju: JUser = {
        id: idHint ?? uniqueIdentifier,
        uniqueIdentifier,
        attributes: { ...attrs },
      };

      next.set(uniqueIdentifier, ju);
      normalized.push(ju);
    });

    this.users = next;
    Log.info(`JustInLite: loaded ${next.size} users (in-memory, replacing previous set).`);
    return normalized;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Registration (match JustInWrapper vocabulary)
  // ────────────────────────────────────────────────────────────────────────────

  /** Register a Task. */
  public registerTask(task: TaskRegistration): void {
    coreRegisterTask(task);
  }

  /** Register a Decision Rule. */
  public registerDecisionRule(decisionRule: DecisionRuleRegistration): void {
    coreRegisterDecisionRule(decisionRule);
  }

  // TODO: Look at using EventHandlerManager instead and not from the Full Justin
  /**
   * Registers a new event type with ordered handler names.
   * Also caches the definition locally for introspection.
   * @param eventType - The type of the event.
   * @param handlers - Ordered task/decision-rule names for the event.
   */
  public async registerEventHandlers(
    eventType: string,
    handlers: string[],
  ): Promise<void> {
    if (this.eventDefinitions.has(eventType)) {
      throw new Error(`Event "${eventType}" already registered.`);
    }
    this.eventDefinitions.set(eventType, handlers.slice());
    await this.eventHandlerManager.registerEventHandlers(eventType, handlers, false);
  }

  /** Unregister handlers for an event type. */
  public unregisterEventHandlers(eventType: string): void {
    this.eventDefinitions.delete(eventType);
    this.eventHandlerManager.unregisterEventHandlers(eventType);
  }

  /** Returns an object view of current event definitions. */
  public getRegisteredEvents(): Record<string, string[]> {
    return Object.fromEntries(this.eventDefinitions);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Execution
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Publish (execute) a registered event for the **currently loaded** users.
   * Signature matches full JustIn; `idempotencyKey` is optional (in-memory only).
   *
   * @param eventType          Registered event type.
   * @param generatedTimestamp Event timestamp.
   * @param eventDetails       Optional event details payload.
   * @param idempotencyKey     Optional in-memory dedupe key (skips if seen).
   */
  public async publishEvent(
    eventType: string,
    generatedTimestamp: Date,
    eventDetails?: object,
    idempotencyKey?: string
  ): Promise<void> {
    // Optional in-memory idempotency for cloud runs
    if (idempotencyKey) {
      if (this.processedKeys.has(idempotencyKey)) {
        Log.warn(`[JustInLite] duplicate execution skipped for key: ${idempotencyKey}`);
        return;
      }
      this.processedKeys.add(idempotencyKey);
    }

    if (!this.eventHandlerManager.hasHandlersForEventType(eventType)) {
      throw new Error(`No handlers registered for event type "${eventType}".`);
    }

    // Ensure users are loaded
    const users = Array.from(this.users.values());
    if (users.length === 0) {
      throw new Error('JustInLite.publishEvent called with no users loaded.');
    }

    const event: JEvent = {
      eventType,
      generatedTimestamp,
      eventDetails: eventDetails ?? {},
    };

    await executeEventForUsers(event, users, this.eventHandlerManager);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Logger & Writers (same names as full JustIn)
  // ────────────────────────────────────────────────────────────────────────────

  public configureLogger(logger: Logger): void {
    setLogger(logger);
  }

  public configureTaskResultWriter(taskWriter: RecordResultFunction): void {
    setTaskResultRecorder(taskWriter);
  }

  public configureDecisionRuleResultWriter(decisionRuleWriter: RecordResultFunction): void {
    setDecisionRuleResultRecorder(decisionRuleWriter);
  }

  public setLoggingLevels(levels: Partial<typeof logLevels>): void {
    setLogLevels(levels);
  }
}

export const JustInLite = () => JustInLiteWrapper.getInstance();
