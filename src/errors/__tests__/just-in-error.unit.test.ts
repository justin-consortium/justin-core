import { JustInError } from '../just-in-error';
import { JustinErrorCode } from '../types';

/**
 * JustInError unit tests
 *
 * JustInError is a thin extension of the native Error class. These tests
 * verify that the extra fields behave as documented and that the class
 * plays well with standard error-handling patterns (instanceof, stack traces,
 * structured data accumulation).
 */

describe('JustInError', () => {
  // ---------------------------------------------------------------------------
  // Construction — defaults
  // ---------------------------------------------------------------------------

  describe('construction with defaults', () => {
    it('sets message and code from the first two arguments', () => {
      const err = new JustInError('something went wrong', JustinErrorCode.DB_ERROR);

      expect(err.message).toBe('something went wrong');
      expect(err.code).toBe(JustinErrorCode.DB_ERROR);
    });

    it('defaults name to "JustInError"', () => {
      const err = new JustInError('oops', JustinErrorCode.DB_ERROR);

      expect(err.name).toBe('JustInError');
    });

    it('defaults isLogged to false', () => {
      const err = new JustInError('oops', JustinErrorCode.DB_ERROR);

      expect(err.isLogged).toBe(false);
    });

    it('defaults data to an empty object', () => {
      const err = new JustInError('oops', JustinErrorCode.DB_ERROR);

      expect(err.data).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // Construction — overrides
  // ---------------------------------------------------------------------------

  describe('construction with overrides', () => {
    it('accepts a custom name', () => {
      const err = new JustInError('oops', JustinErrorCode.DB_ERROR, {
        name: 'JustInCoreError',
      });

      expect(err.name).toBe('JustInCoreError');
    });

    it('accepts isLogged: true', () => {
      const err = new JustInError('oops', JustinErrorCode.DB_ERROR, {
        isLogged: true,
      });

      expect(err.isLogged).toBe(true);
    });

    it('stores the provided data object', () => {
      const err = new JustInError('oops', JustinErrorCode.DB_ERROR, {
        data: { function: 'doThing', collection: 'users' },
      });

      expect(err.data).toEqual({ function: 'doThing', collection: 'users' });
    });

    it('accepts all override options together', () => {
      const err = new JustInError('full override', JustinErrorCode.VALIDATION_ERROR, {
        name: 'CustomError',
        isLogged: true,
        data: { key: 'value' },
      });

      expect(err.name).toBe('CustomError');
      expect(err.isLogged).toBe(true);
      expect(err.data).toEqual({ key: 'value' });
    });
  });

  // ---------------------------------------------------------------------------
  // All error codes
  // ---------------------------------------------------------------------------

  describe('error codes', () => {
    it('accepts DB_ERROR', () => {
      const err = new JustInError('db failed', JustinErrorCode.DB_ERROR);
      expect(err.code).toBe('DB_ERROR');
    });

    it('accepts VALIDATION_ERROR', () => {
      const err = new JustInError('bad input', JustinErrorCode.VALIDATION_ERROR);
      expect(err.code).toBe('VALIDATION_ERROR');
    });

    it('accepts NOT_INITIALIZED', () => {
      const err = new JustInError('not ready', JustinErrorCode.NOT_INITIALIZED);
      expect(err.code).toBe('NOT_INITIALIZED');
    });

    it('accepts NOT_FOUND', () => {
      const err = new JustInError('missing', JustinErrorCode.NOT_FOUND);
      expect(err.code).toBe('NOT_FOUND');
    });

    it('accepts PARTIAL_SUCCESS', () => {
      const err = new JustInError('partial', JustinErrorCode.PARTIAL_SUCCESS);
      expect(err.code).toBe('PARTIAL_SUCCESS');
    });

    it('accepts arbitrary string codes for extensibility', () => {
      const err = new JustInError('custom', 'MY_CUSTOM_CODE');
      expect(err.code).toBe('MY_CUSTOM_CODE');
    });
  });

  // ---------------------------------------------------------------------------
  // instanceof and prototype chain
  // ---------------------------------------------------------------------------

  describe('instanceof behaviour', () => {
    it('is an instance of JustInError', () => {
      const err = new JustInError('oops', JustinErrorCode.DB_ERROR);
      expect(err).toBeInstanceOf(JustInError);
    });

    it('is an instance of the native Error class', () => {
      const err = new JustInError('oops', JustinErrorCode.DB_ERROR);
      expect(err).toBeInstanceOf(Error);
    });

    it('is caught by a catch block that checks instanceof Error', () => {
      let caught: unknown;

      try {
        throw new JustInError('thrown', JustinErrorCode.DB_ERROR);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).toBeInstanceOf(JustInError);
    });
  });

  // ---------------------------------------------------------------------------
  // Stack trace
  // ---------------------------------------------------------------------------

  describe('stack trace', () => {
    it('has a stack property', () => {
      const err = new JustInError('oops', JustinErrorCode.DB_ERROR);
      expect(typeof err.stack).toBe('string');
    });

    it('stack includes the error message', () => {
      const err = new JustInError('unique message for stack test', JustinErrorCode.DB_ERROR);
      expect(err.stack).toContain('unique message for stack test');
    });
  });

  // ---------------------------------------------------------------------------
  // data field mutation
  // ---------------------------------------------------------------------------

  describe('data field mutation', () => {
    it('data can be replaced after construction — supports context accumulation across layers', () => {
      const err = new JustInError('oops', JustinErrorCode.DB_ERROR, {
        data: { layer: 'mongo' },
      });

      err.data = { ...err.data, layer2: 'data-manager' };

      expect(err.data).toEqual({ layer: 'mongo', layer2: 'data-manager' });
    });

    it('replacing data does not affect message or code', () => {
      const err = new JustInError('original message', JustinErrorCode.NOT_FOUND, {
        data: { original: true },
      });

      err.data = { replaced: true };

      expect(err.message).toBe('original message');
      expect(err.code).toBe('NOT_FOUND');
    });
  });
});
