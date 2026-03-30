import { loggerSpies, resetGlobalLoggerState } from '../../testing/testkit';
import { expectLog } from '../../testing/helpers';
import { JustInError, JustinErrorCode } from '../../errors';
import {
  coreSuccess,
  coreFailure,
  coreFailureResult,
  failureEntryFromError,
  unwrapSuccess,
  makeLoopFailureCollector,
} from '../result.helpers';

import type { LoggerSpies } from '../../testing/testkit';

describe('result helpers unit tests', () => {
  let lg: LoggerSpies;

  beforeEach(() => {
    lg = loggerSpies();
  });

  afterEach(() => {
    lg.restore();
    resetGlobalLoggerState();
  });

  describe('coreSuccess', () => {
    it('returns ok: true', () => {
      const result = coreSuccess(['item']);
      expect(result.ok).toBe(true);
    });

    it('returns the provided successes array', () => {
      const result = coreSuccess(['a', 'b', 'c']);
      expect(result.successes).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty successes array when called with []', () => {
      const result = coreSuccess([]);
      expect(result.successes).toEqual([]);
    });

    it('works with object items', () => {
      const item = { id: 'abc', name: 'Alice' };
      const result = coreSuccess([item]);
      expect(result.successes[0]).toEqual(item);
    });

    it('does not include a failures field', () => {
      const result = coreSuccess(['item']);
      expect(result).not.toHaveProperty('failures');
    });
  });

  describe('coreFailure', () => {
    it('returns ok: false', () => {
      const result = coreFailure([{ code: 'DB_ERROR', reason: 'oops' }]);
      expect(result.ok).toBe(false);
    });

    it('returns the provided failures array', () => {
      const failures = [{ code: 'NOT_FOUND', reason: 'missing' }];
      const result = coreFailure(failures);
      if (!result.ok) expect(result.failures).toEqual(failures);
    });

    it('defaults successes to an empty array when not provided', () => {
      const result = coreFailure([{ code: 'DB_ERROR', reason: 'oops' }]);
      expect(result.successes).toEqual([]);
    });

    it('includes partial successes when provided', () => {
      const result = coreFailure([{ code: 'DB_ERROR', reason: 'one failed' }], ['partial-success']);
      expect(result.successes).toEqual(['partial-success']);
    });

    it('carries both failures and partial successes together', () => {
      const result = coreFailure([{ code: 'VALIDATION_ERROR', reason: 'bad input' }], ['ok-item']);
      expect(result.ok).toBe(false);
      expect(result.successes).toHaveLength(1);
      if (!result.ok) expect(result.failures).toHaveLength(1);
    });
  });

  describe('coreFailureResult', () => {
    it('returns ok: false', () => {
      const result = coreFailureResult('myFn', 'NOT_FOUND', 'thing not found');
      expect(result.ok).toBe(false);
    });

    it('returns a single failure entry with the provided code and reason', () => {
      const result = coreFailureResult('myFn', 'NOT_FOUND', 'thing not found');
      if (!result.ok) {
        expect(result.failures[0].code).toBe('NOT_FOUND');
        expect(result.failures[0].reason).toBe('thing not found');
      }
    });

    it('includes id in the failure entry when provided', () => {
      const result = coreFailureResult('myFn', 'NOT_FOUND', 'not found', { id: 'abc' });
      if (!result.ok) expect(result.failures[0].id).toBe('abc');
    });

    it('includes uniqueIdentifier in the failure entry when provided', () => {
      const result = coreFailureResult('myFn', 'NOT_FOUND', 'not found', {
        uniqueIdentifier: 'alice',
      });
      if (!result.ok) expect(result.failures[0].uniqueIdentifier).toBe('alice');
    });

    it('includes details in the failure entry when provided', () => {
      const result = coreFailureResult('myFn', 'VALIDATION_ERROR', 'bad', {}, { namespace: 'pii' });
      if (!result.ok) expect(result.failures[0].details).toEqual({ namespace: 'pii' });
    });

    it('emits a WARNING log with the code as the message', () => {
      coreFailureResult('myFn', 'NOT_FOUND', 'thing not found');
      expectLog(lg.last(), { severity: 'WARNING', messageSubstr: 'NOT_FOUND' });
    });

    it('includes the label and reason in the log context', () => {
      coreFailureResult('updateUserById', 'NOT_FOUND', 'user (abc) not found', { id: 'abc' });
      expect(lg.last()?.ctx?.label).toBe('updateUserById');
      expect(lg.last()?.ctx?.reason).toBe('user (abc) not found');
    });

    it('returns an empty successes array', () => {
      const result = coreFailureResult('myFn', 'DB_ERROR', 'failed');
      expect(result.successes).toEqual([]);
    });

    it('omits details from the failure entry when not provided', () => {
      const result = coreFailureResult('myFn', 'NOT_FOUND', 'not found');
      if (!result.ok) expect(result.failures[0]).not.toHaveProperty('details');
    });
  });

  describe('failureEntryFromError', () => {
    it('extracts code and message from a JustInError', () => {
      const err = new JustInError('user not found', JustinErrorCode.NOT_FOUND);
      const entry = failureEntryFromError(err);

      expect(entry.code).toBe('NOT_FOUND');
      expect(entry.reason).toBe('user not found');
    });

    it('falls back to DB_ERROR for a plain Error', () => {
      const entry = failureEntryFromError(new Error('connection refused'));

      expect(entry.code).toBe('DB_ERROR');
      expect(entry.reason).toBe('connection refused');
    });

    it('falls back to DB_ERROR for an unknown thrown value', () => {
      const entry = failureEntryFromError('something weird');

      expect(entry.code).toBe('DB_ERROR');
    });

    it('includes id when provided in identity', () => {
      const entry = failureEntryFromError(new Error('oops'), { id: 'abc' });

      expect(entry.id).toBe('abc');
    });

    it('includes uniqueIdentifier when provided in identity', () => {
      const entry = failureEntryFromError(new Error('oops'), { uniqueIdentifier: 'alice' });

      expect(entry.uniqueIdentifier).toBe('alice');
    });

    it('includes details when provided', () => {
      const entry = failureEntryFromError(new Error('oops'), {}, { namespace: 'health' });

      expect(entry.details).toEqual({ namespace: 'health' });
    });

    it('omits details when not provided', () => {
      const entry = failureEntryFromError(new Error('oops'));

      expect(entry).not.toHaveProperty('details');
    });

    it('omits id and uniqueIdentifier when identity is empty', () => {
      const entry = failureEntryFromError(new Error('oops'));

      expect(entry).not.toHaveProperty('id');
      expect(entry).not.toHaveProperty('uniqueIdentifier');
    });
  });

  describe('unwrapSuccess', () => {
    it('passes a successful result through unchanged', () => {
      const input = coreSuccess([{ id: 'abc' }]);
      const result = unwrapSuccess(input, 'myFn');

      expect(result.ok).toBe(true);
      expect(result.successes).toEqual([{ id: 'abc' }]);
    });

    it('returns a failed result when the input failed', () => {
      const input = coreFailure([{ code: 'DB_ERROR', reason: 'insert failed' }]);
      const result = unwrapSuccess(input, 'myFn');

      expect(result.ok).toBe(false);
    });

    it('enriches the failure with the calling label — label appears in the logged message', () => {
      const input = coreFailure([{ code: 'DB_ERROR', reason: 'insert failed' }]);
      unwrapSuccess(input, 'createUserRecord', { uniqueIdentifier: 'alice' });

      expectLog(lg.last(), { severity: 'WARNING', messageSubstr: 'DB_ERROR' });
    });

    it('attaches identity fields to the failure entry', () => {
      const input = coreFailure([{ code: 'DB_ERROR', reason: 'failed' }]);
      const result = unwrapSuccess(input, 'myFn', { id: 'abc', uniqueIdentifier: 'alice' });

      if (!result.ok) {
        expect(result.failures[0].id).toBe('abc');
        expect(result.failures[0].uniqueIdentifier).toBe('alice');
      }
    });

    it('uses DB_ERROR as fallback when the input failure has no code', () => {
      // ?? only falls back for null/undefined — omit code entirely to trigger the fallback
      const input = coreFailure([{ code: undefined as any, reason: 'unknown' }]);
      const result = unwrapSuccess(input, 'myFn');

      if (!result.ok) expect(result.failures[0].code).toBe('DB_ERROR');
    });

    it('does not emit a log on success', () => {
      unwrapSuccess(coreSuccess(['item']), 'myFn');
      expect(lg.captured).toHaveLength(0);
    });
  });

  describe('makeLoopFailureCollector', () => {
    it('starts with no failures', () => {
      const collector = makeLoopFailureCollector('myLoop', { uniqueIdentifier: 'alice' });

      expect(collector.failures).toHaveLength(0);
      expect(collector.hasFailures).toBe(false);
    });

    it('accumulates failures after each push', () => {
      const collector = makeLoopFailureCollector('myLoop', { uniqueIdentifier: 'alice' });
      collector.push('VALIDATION_ERROR', 'bad input');
      collector.push('VALIDATION_ERROR', 'another bad input');

      expect(collector.failures).toHaveLength(2);
      expect(collector.hasFailures).toBe(true);
    });

    it('each pushed failure carries the base identity', () => {
      const collector = makeLoopFailureCollector('myLoop', { uniqueIdentifier: 'alice' });
      collector.push('VALIDATION_ERROR', 'bad input');

      expect(collector.failures[0].uniqueIdentifier).toBe('alice');
    });

    it('includes details in the failure entry when provided', () => {
      const collector = makeLoopFailureCollector('myLoop', { uniqueIdentifier: 'alice' });
      collector.push('VALIDATION_ERROR', 'bad namespace', { namespace: 'pii' });

      expect(collector.failures[0].details).toEqual({ namespace: 'pii' });
    });

    it('emits a WARNING log for each push', () => {
      const collector = makeLoopFailureCollector('myLoop', { uniqueIdentifier: 'alice' });
      collector.push('VALIDATION_ERROR', 'first failure');
      collector.push('VALIDATION_ERROR', 'second failure');

      expect(lg.captured.filter((c) => c.entry.severity === 'WARNING')).toHaveLength(2);
    });

    it('failures array is independent between separate collector instances', () => {
      const c1 = makeLoopFailureCollector('loop1', { uniqueIdentifier: 'alice' });
      const c2 = makeLoopFailureCollector('loop2', { uniqueIdentifier: 'bob' });

      c1.push('VALIDATION_ERROR', 'alice error');

      expect(c1.failures).toHaveLength(1);
      expect(c2.failures).toHaveLength(0);
    });
  });
});
