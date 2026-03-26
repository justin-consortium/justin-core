import sinon from 'sinon';
import { createLogger } from '../logger';
import { setGlobalLogCallback, setGlobalSeverityRanking } from '../global';
import { loggerSpies, resetGlobalLoggerState } from '../../testing/testkit';
import { expectLog } from '../../testing/helpers';
import type { LoggerSpies } from '../../testing/testkit';

describe('createLogger unit tests', () => {
  let lg: LoggerSpies;

  beforeEach(() => {
    lg = loggerSpies();
  });

  afterEach(() => {
    lg.restore();
    resetGlobalLoggerState();
  });

  describe('convenience methods', () => {
    it('debug() emits at DEBUG severity', () => {
      const Log = createLogger();
      Log.debug('debug message');

      expectLog(lg.last(), { severity: 'DEBUG', messageSubstr: 'debug message' });
    });

    it('info() emits at INFO severity', () => {
      const Log = createLogger();
      Log.info('info message');

      expectLog(lg.last(), { severity: 'INFO', messageSubstr: 'info message' });
    });

    it('warn() emits at WARNING severity', () => {
      const Log = createLogger();
      Log.warn('warn message');

      expectLog(lg.last(), { severity: 'WARNING', messageSubstr: 'warn message' });
    });

    it('error() emits at ERROR severity', () => {
      const Log = createLogger();
      Log.error('error message');

      expectLog(lg.last(), { severity: 'ERROR', messageSubstr: 'error message' });
    });

    it('emit() accepts an explicit severity string', () => {
      const Log = createLogger();
      Log.emit('WARNING', 'explicit severity');

      expectLog(lg.last(), { severity: 'WARNING', messageSubstr: 'explicit severity' });
    });

    it('severity is normalised to uppercase', () => {
      const Log = createLogger();
      Log.emit('debug' as any, 'lowercase severity');

      expectLog(lg.last(), { severity: 'DEBUG' });
    });
  });

  describe('severity filtering', () => {
    it('emits entries at or above the global min level', () => {
      lg.restore();
      lg = loggerSpies({ minLevel: 'WARNING' });

      const Log = createLogger();
      Log.warn('should emit');
      Log.error('should also emit');

      expect(lg.captured).toHaveLength(2);
    });

    it('suppresses entries below the global min level', () => {
      lg.restore();
      lg = loggerSpies({ minLevel: 'WARNING' });

      const Log = createLogger();
      Log.debug('suppressed');
      Log.info('also suppressed');

      expect(lg.captured).toHaveLength(0);
    });

    it('instance emitLevel overrides the global min level', () => {
      lg.restore();
      lg = loggerSpies({ minLevel: 'DEBUG' });

      const Log = createLogger({ emitLevel: 'ERROR' });
      Log.debug('suppressed');
      Log.warn('suppressed');
      Log.error('emitted');

      expect(lg.captured).toHaveLength(1);
      expectLog(lg.last(), { severity: 'ERROR' });
    });

    it('instance emitLevel accepts a numeric rank', () => {
      lg.restore();
      lg = loggerSpies({ minLevel: 'DEBUG' });

      const Log = createLogger({ emitLevel: 70 }); // ERROR rank
      Log.warn('suppressed');
      Log.error('emitted');

      expect(lg.captured).toHaveLength(1);
      expectLog(lg.last(), { severity: 'ERROR' });
    });

    it('instance emitLevel accepts a lowercase severity string', () => {
      lg.restore();
      lg = loggerSpies({ minLevel: 'DEBUG' });

      const Log = createLogger({ emitLevel: 'error' });
      Log.warn('suppressed');
      Log.error('emitted');

      expect(lg.captured).toHaveLength(1);
      expectLog(lg.last(), { severity: 'ERROR' });
    });
  });

  describe('instance context', () => {
    it('instance context is merged into every emitted entry', () => {
      const Log = createLogger({ context: { source: 'my-module' } });
      Log.info('test');

      expect(lg.last()?.ctx?.source).toBe('my-module');
    });

    it('instance context merges on top of global context', () => {
      lg.restore();
      lg = loggerSpies({ ctx: { app: 'justin' } });

      const Log = createLogger({ context: { source: 'my-module' } });
      Log.info('test');

      expect(lg.last()?.ctx?.app).toBe('justin');
      expect(lg.last()?.ctx?.source).toBe('my-module');
    });

    it('instance context wins over global context on key collision', () => {
      lg.restore();
      lg = loggerSpies({ ctx: { source: 'global' } });

      const Log = createLogger({ context: { source: 'instance' } });
      Log.info('test');

      expect(lg.last()?.ctx?.source).toBe('instance');
    });

    it('extras are merged on top of both global and instance context', () => {
      const Log = createLogger({ context: { source: 'my-module' } });
      Log.info('test', { requestId: 'abc' });

      expect(lg.last()?.ctx?.source).toBe('my-module');
      expect(lg.last()?.ctx?.requestId).toBe('abc');
    });
  });

  describe('setContext', () => {
    it('merges new fields into the instance context', () => {
      const Log = createLogger({ context: { source: 'mod' } });
      Log.setContext({ requestId: 'abc' });
      Log.info('test');

      expect(lg.last()?.ctx?.source).toBe('mod');
      expect(lg.last()?.ctx?.requestId).toBe('abc');
    });

    it('new context wins over old context on key collision', () => {
      const Log = createLogger({ context: { source: 'old' } });
      Log.setContext({ source: 'new' });
      Log.info('test');

      expect(lg.last()?.ctx?.source).toBe('new');
    });

    it('does not affect other logger instances', () => {
      const LogA = createLogger({ context: { source: 'a' } });
      const LogB = createLogger({ context: { source: 'b' } });

      LogA.setContext({ extra: 'only-a' });
      LogB.info('from b');

      expect(lg.last()?.ctx?.source).toBe('b');
      expect(lg.last()?.ctx?.extra).toBeUndefined();
    });
  });

  describe('setLevel', () => {
    it('updates the min level and suppresses entries below the new level', () => {
      const Log = createLogger();
      Log.setLevel('ERROR');
      Log.warn('suppressed');
      Log.error('emitted');

      expect(lg.captured).toHaveLength(1);
      expectLog(lg.last(), { severity: 'ERROR' });
    });

    it('accepts a numeric rank', () => {
      const Log = createLogger();
      Log.setLevel(70); // ERROR rank
      Log.warn('suppressed');
      Log.error('emitted');

      expect(lg.captured).toHaveLength(1);
    });

    it('accepts a lowercase severity string', () => {
      const Log = createLogger();
      Log.setLevel('error');
      Log.warn('suppressed');
      Log.error('emitted');

      expect(lg.captured).toHaveLength(1);
      expectLog(lg.last(), { severity: 'ERROR' });
    });

    it('lowering the level re-enables suppressed severities', () => {
      const Log = createLogger({ emitLevel: 'ERROR' });
      Log.setLevel('DEBUG');
      Log.debug('now emitted');

      expect(lg.captured).toHaveLength(1);
      expectLog(lg.last(), { severity: 'DEBUG' });
    });
  });

  describe('instance emitFn', () => {
    it('instance emitFn is called instead of the global emitFn', () => {
      const instanceEmit = sinon.stub();
      const Log = createLogger({ emitFn: instanceEmit });
      Log.info('test');

      expect(instanceEmit.calledOnce).toBe(true);
      expect(lg.captured).toHaveLength(0);
    });

    it('instance emitFn receives the entry and merged context', () => {
      const instanceEmit = sinon.stub();
      const Log = createLogger({ emitFn: instanceEmit, context: { source: 'mod' } });
      Log.info('hello');

      const [entry, ctx] = instanceEmit.firstCall.args;
      expect(entry.severity).toBe('INFO');
      expect(entry.message).toBe('hello');
      expect(ctx.source).toBe('mod');
    });

    it('setEmitFn overrides the emit function after creation', () => {
      const newEmit = sinon.stub();
      const Log = createLogger();
      Log.setEmitFn(newEmit);
      Log.info('test');

      expect(newEmit.calledOnce).toBe(true);
      expect(lg.captured).toHaveLength(0);
    });
  });

  describe('instance callback', () => {
    it('instance callback is called after the emit function', () => {
      const cb = sinon.stub();
      const Log = createLogger({ callback: cb });
      Log.info('test');

      expect(cb.calledOnce).toBe(true);
      expect(lg.captured).toHaveLength(1);
    });

    it('instance callback receives the log entry', () => {
      const cb = sinon.stub();
      const Log = createLogger({ callback: cb });
      Log.error('something broke');

      const entry = cb.firstCall.args[0];
      expect(entry.severity).toBe('ERROR');
      expect(entry.message).toBe('something broke');
    });

    it('instance callback overrides the global callback', () => {
      const globalCb = sinon.stub();
      const instanceCb = sinon.stub();

      lg.restore();
      setGlobalLogCallback(globalCb);
      lg = loggerSpies();

      const Log = createLogger({ callback: instanceCb });
      Log.info('test');

      expect(instanceCb.calledOnce).toBe(true);
      expect(globalCb.called).toBe(false);
    });

    it('a throwing callback is swallowed — does not affect the emit', () => {
      const Log = createLogger({
        callback: () => {
          throw new Error('callback blew up');
        },
      });

      expect(() => Log.info('test')).not.toThrow();
      expect(lg.captured).toHaveLength(1);
    });

    it('setCallback clears the callback when called with undefined', () => {
      const cb = sinon.stub();
      const Log = createLogger({ callback: cb });
      Log.setCallback(undefined);
      Log.info('test');

      expect(cb.called).toBe(false);
    });
  });

  // Note: global emitFn and context are read at emit time — this is implicitly
  // proven by every test in this suite that uses the loggerSpies sandbox. The
  // sandbox stubs those globals and the logger picks them up without any
  // special setup, which is the contract. The min level behaves differently —
  // it is captured at creation time. Use setLevel() to change it afterwards,
  // which is covered in the setLevel describe block above.

  describe('custom severity rankings', () => {
    it('custom severity levels are emitted when they meet the min rank', () => {
      type AppSeverity = 'TRACE' | 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

      lg.restore();
      resetGlobalLoggerState();
      setGlobalSeverityRanking({ TRACE: 5 });
      lg = loggerSpies({ minLevel: 'DEBUG' });

      const Log = createLogger<AppSeverity>({ emitLevel: 'TRACE' as AppSeverity });
      Log.emit('TRACE', 'trace message');

      expect(lg.captured).toHaveLength(1);
      expectLog(lg.last(), { severity: 'TRACE', messageSubstr: 'trace message' });
    });

    it('custom severity levels below the min rank are suppressed', () => {
      type AppSeverity = 'TRACE' | 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

      lg.restore();
      resetGlobalLoggerState();
      setGlobalSeverityRanking({ TRACE: 5 });
      lg = loggerSpies({ minLevel: 'DEBUG' });

      const Log = createLogger<AppSeverity>();
      Log.emit('TRACE', 'suppressed trace');

      expect(lg.captured).toHaveLength(0);
    });
  });
});
