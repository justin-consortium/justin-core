import { loggerSpies, resetGlobalLoggerState } from '../../testing/testkit';
import { expectLog } from '../../testing/helpers';
import { JustInError, JustinErrorCode } from '../../errors';
import { handleError, checkInitialized } from '../error.helpers';

import type { LoggerSpies } from '../../testing/testkit';

describe('error helpers unit tests', () => {
  let lg: LoggerSpies;

  beforeEach(() => {
    lg = loggerSpies();
  });

  afterEach(() => {
    lg.restore();
    resetGlobalLoggerState();
  });

  describe('handleError', () => {
    it('always throws', () => {
      expect(() => handleError('something failed', 'myFn')).toThrow();
    });

    it('throws a JustInError', () => {
      expect(() => handleError('something failed', 'myFn')).toThrow(JustInError);
    });

    it('thrown error carries the provided message', () => {
      let caught: unknown;
      try {
        handleError('something failed', 'myFn');
      } catch (e) {
        caught = e;
      }
      expect((caught as JustInError).message).toBe('something failed');
    });

    it('defaults code to DB_ERROR when no code is provided', () => {
      let caught: unknown;
      try {
        handleError('something failed', 'myFn');
      } catch (e) {
        caught = e;
      }
      expect((caught as JustInError).code).toBe(JustinErrorCode.DB_ERROR);
    });

    it('uses the provided code when given', () => {
      let caught: unknown;
      try {
        handleError('bad input', 'myFn', { code: JustinErrorCode.VALIDATION_ERROR });
      } catch (e) {
        caught = e;
      }
      expect((caught as JustInError).code).toBe(JustinErrorCode.VALIDATION_ERROR);
    });

    it('sets isLogged: true on the thrown error', () => {
      let caught: unknown;
      try {
        handleError('something failed', 'myFn');
      } catch (e) {
        caught = e;
      }
      expect((caught as JustInError).isLogged).toBe(true);
    });

    it('sets name to JustInCoreError on the thrown error', () => {
      let caught: unknown;
      try {
        handleError('something failed', 'myFn');
      } catch (e) {
        caught = e;
      }
      expect((caught as JustInError).name).toBe('JustInCoreError');
    });

    it('attaches the funcName to the error data', () => {
      let caught: unknown;
      try {
        handleError('something failed', 'doTheThing');
      } catch (e) {
        caught = e;
      }
      expect((caught as JustInError).data.function).toBe('doTheThing');
    });

    it('merges extra data into the error data', () => {
      let caught: unknown;
      try {
        handleError('something failed', 'myFn', { data: { collection: 'users' } });
      } catch (e) {
        caught = e;
      }
      expect((caught as JustInError).data.collection).toBe('users');
    });

    it('attaches the original cause to the error data when provided', () => {
      const original = new Error('original cause');
      let caught: unknown;
      try {
        handleError('wrapped', 'myFn', { error: original });
      } catch (e) {
        caught = e;
      }
      expect((caught as JustInError).data.cause).toBe(original);
    });

    it('emits an ERROR log', () => {
      try {
        handleError('something failed', 'myFn');
      } catch {}
      expectLog(lg.last(), { severity: 'ERROR', messageSubstr: 'something failed' });
    });

    it('does not log again when rethrowing an already-logged JustInError', () => {
      const alreadyLogged = new JustInError('original', JustinErrorCode.DB_ERROR, {
        isLogged: true,
      });

      try {
        handleError('wrapper message', 'outerFn', { error: alreadyLogged });
      } catch {}

      expect(lg.captured).toHaveLength(0);
    });

    it('rethrows the same JustInError instance when it is already logged', () => {
      const alreadyLogged = new JustInError('original', JustinErrorCode.DB_ERROR, {
        isLogged: true,
      });

      let caught: unknown;
      try {
        handleError('wrapper', 'outerFn', { error: alreadyLogged });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(alreadyLogged);
    });

    it('merges the outer context into the already-logged error data when rethrowing', () => {
      const alreadyLogged = new JustInError('original', JustinErrorCode.DB_ERROR, {
        isLogged: true,
        data: { layer: 'mongo' },
      });

      try {
        handleError('wrapper', 'dataManagerFn', { error: alreadyLogged });
      } catch {}

      expect(alreadyLogged.data.function).toBe('dataManagerFn');
      expect(alreadyLogged.data.layer).toBe('mongo');
    });

    it('logs once for a fresh Error wrapping a plain Error', () => {
      const plain = new Error('plain error');
      try {
        handleError('wrapping plain', 'myFn', { error: plain });
      } catch {}

      expect(lg.captured).toHaveLength(1);
      expectLog(lg.last(), { severity: 'ERROR' });
    });
  });

  describe('checkInitialized', () => {
    it('does not throw when isInitialized is true', () => {
      expect(() => checkInitialized(true, 'UserManager')).not.toThrow();
    });

    it('throws when isInitialized is false', () => {
      expect(() => checkInitialized(false, 'UserManager')).toThrow();
    });

    it('throws a JustInError when not initialized', () => {
      expect(() => checkInitialized(false, 'UserManager')).toThrow(JustInError);
    });

    it('thrown error carries NOT_INITIALIZED code', () => {
      let caught: unknown;
      try {
        checkInitialized(false, 'UserManager');
      } catch (e) {
        caught = e;
      }
      expect((caught as JustInError).code).toBe(JustinErrorCode.NOT_INITIALIZED);
    });

    it('thrown error message includes the manager label', () => {
      let caught: unknown;
      try {
        checkInitialized(false, 'UserManager');
      } catch (e) {
        caught = e;
      }
      expect((caught as JustInError).message).toContain('UserManager');
    });
  });
});
