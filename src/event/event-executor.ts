import { Log } from '../logger/logger-manager';
import type { JEvent } from './event.type';
import type { JUser } from '../user-manager/user.type';
import { EventHandlerManager } from './event-handler-manager';
import { getTaskByName, executeTask } from '../handlers/task.manager';
import { getDecisionRuleByName, executeDecisionRule } from '../handlers/decision-rule.manager';

/**
 * Executes a registered event against a set of users:
 * - calls beforeExecution once per handler
 * - runs the handler per user
 * - calls afterExecution once per handler
 *
 * No DB, no queue — pure in-memory execution.
 */
export async function executeEventForUsers(
  event: JEvent,
  users: JUser[],
  handlerManager: EventHandlerManager
): Promise<void> {
  const handlerNames = handlerManager.getHandlersForEventType(event.eventType);
  if (!handlerNames.length) {
    Log.warn(`No handlers registered for event type "${event.eventType}".`);
    return;
  }

  const beforeRan = new Set<string>();
  const afterRan = new Set<string>();

  for (const handlerName of handlerNames) {
    const task = getTaskByName(handlerName);
    const rule = getDecisionRuleByName(handlerName);

    // BEFORE (once per handler)
    if (!beforeRan.has(handlerName)) {
      try {
        if (task?.beforeExecution) await task.beforeExecution(event);
        if (rule?.beforeExecution) await rule.beforeExecution(event);
      } catch (err) {
        Log.error(`beforeExecution error for "${handlerName}" on event "${event.eventType}": ${err}`);
      } finally {
        beforeRan.add(handlerName);
      }
    }

    // PER-USER
    for (const user of users) {
      const uid = user.uniqueIdentifier ?? user.id;
      try {
        if (task) {
          await executeTask(task, event, user);
        } else if (rule) {
          await executeDecisionRule(rule, event, user);
        } else {
          Log.warn(`Handler "${handlerName}" not found; skipping.`);
        }
      } catch (err) {
        Log.error(`Execution error for "${handlerName}" on user "${uid}" (event "${event.eventType}"): ${err}`);
      }
    }

    // AFTER (once per handler)
    if (!afterRan.has(handlerName)) {
      try {
        if (task?.afterExecution) await task.afterExecution(event);
        if (rule?.afterExecution) await rule.afterExecution(event);
      } catch (err) {
        Log.error(`afterExecution error for "${handlerName}" on event "${event.eventType}": ${err}`);
      } finally {
        afterRan.add(handlerName);
      }
    }
  }
}
