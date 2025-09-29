import { RecordResult, RecordResultFunction } from './handler.type';
import { Log } from '../logger/logger-manager';
import DataManager from '../data-manager/data-manager';
import { DECISION_RULE_RESULTS, TASK_RESULTS } from '../data-manager/data-manager.constants';

let recordDecisionRuleResultFn: RecordResultFunction | null = null;
let recordTaskResultFn: RecordResultFunction | null = null;
let _persistenceEnabled = true;

/**
 * Enable/disable persistence attempts inside the result recorder.
 * When disabled, the recorder will NEVER call DataManager and will console-log instead.
 */
export function setResultRecorderPersistenceEnabled(enabled: boolean): void {
  _persistenceEnabled = enabled;
  _dm = null;
}

// Lazy cache; do NOT call DataManager.getInstance() unless persistence is enabled.
let _dm: ReturnType<typeof DataManager.getInstance> | null = null;

function getDataManagerSafe() {
  if (!_persistenceEnabled) return null;
  if (_dm) return _dm;
  try {
    _dm = DataManager.getInstance();
  } catch {
    _dm = null; // fallback: treat as unavailable
  }
  return _dm;
}

/**
 * Registers the function to handle results from decision rules.
 */
export function setDecisionRuleResultRecorder(fn: RecordResultFunction): void {
  recordDecisionRuleResultFn = fn;
}

/**
 * Registers the function to handle results from tasks.
 */
export function setTaskResultRecorder(fn: RecordResultFunction): void {
  recordTaskResultFn = fn;
}

/**
 * Persist via DataManager if available; otherwise dev-log full record.
 * Never throws.
 */
async function persistOrLog(
  collection: string,
  record: RecordResult,
  kind: 'task' | 'decision'
): Promise<void> {
  try {
    const dm = getDataManagerSafe();
    if (dm) {
      await dm.addItemToCollection(collection, record);
      return;
    }
  } catch (e) {
    Log.warn('Result recorder DataManager path failed; falling back to Log.dev.', e);
  }
  Log.dev(`[ResultRecorder:${kind}]`, record);
}

/**
 * Handles a decision rule result (or default fallback).
 */
export async function handleDecisionRuleResult(record: RecordResult): Promise<void> {
  if (!hasResultRecord(record)) return;

  if (recordDecisionRuleResultFn) {
    try {
      await recordDecisionRuleResultFn(record);
      return;
    } catch (e) {
      Log.warn('Decision rule result recorder failed; falling back to default.', e);
    }
  }

  await persistOrLog(DECISION_RULE_RESULTS, record, 'decision');
}

/**
 * Handles a task result (delegates to decision rule writer if set), else default.
 */
export async function handleTaskResult(record: RecordResult): Promise<void> {
  if (!hasResultRecord(record)) return;

  if (recordTaskResultFn) {
    try {
      await recordTaskResultFn(record);
      return;
    } catch (e) {
      Log.warn('Task result recorder failed; falling back to default.', e);
    }
  } else if (recordDecisionRuleResultFn) {
    try {
      await recordDecisionRuleResultFn(record);
      return; // success → skip fallback
    } catch (e) {
      Log.warn('Delegated decision rule recorder failed; falling back to default.', e);
    }
  }

  await persistOrLog(TASK_RESULTS, record, 'task');
}

/** True if there are any steps in the result object. */
export function hasResultRecord(record: RecordResult): boolean {
  return record.steps.length > 0;
}


export function __resetResultRecorderForTests(): void {
  recordDecisionRuleResultFn = null;
  recordTaskResultFn = null;
  _dm = null;
  _persistenceEnabled = true;
}
