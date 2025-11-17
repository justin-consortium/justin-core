import sinon, { SinonSandbox, SinonStub } from 'sinon';
import { createLogger } from '../logger';
import * as globalFns from '../global';
import * as utilFns from '../utils';

describe('logger integration', () => {
  let sb: SinonSandbox;

  let normalizeExtraArgStub: SinonStub;

  let getGlobalEmitFnStub: SinonStub;
  let getGlobalLogCallbackStub: SinonStub;
  let getGlobalLogContextStub: SinonStub;
  let getGlobalMinLogLevelStub: SinonStub;
  let getGlobalSeverityRankingStub: SinonStub;
  let defaultEmitStub: SinonStub;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    sb = sinon.createSandbox();

    normalizeExtraArgStub = sb
      .stub(utilFns, 'normalizeExtraArg')
      .callsFake((extras: unknown) => ({ normalized: extras }));

    getGlobalEmitFnStub = sb.stub(globalFns, 'getGlobalEmitFn');
    getGlobalLogCallbackStub = sb.stub(globalFns, 'getGlobalLogCallback');
    getGlobalLogContextStub = sb
      .stub(globalFns, 'getGlobalLogContext')
      .returns({ app: 'demo' });
    getGlobalMinLogLevelStub = sb
      .stub(globalFns, 'getGlobalMinLogLevel')
      .returns('INFO');
    getGlobalSeverityRankingStub = sb
      .stub(globalFns, 'getGlobalSeverityRanking')
      .returns(undefined);
    defaultEmitStub = sb.stub(globalFns, 'defaultEmit');
  });

  afterEach(() => {
    sb.restore();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('emits with entry {severity,message} and flattened context (global + instance + extras)', () => {
    const instanceEmit = jest.fn();

    const logger = createLogger({
      emitFn: instanceEmit,
      context: { service: 'users' },
    });

    logger.info('user created', { userId: 'u-1' });

    expect(normalizeExtraArgStub.calledWith({ userId: 'u-1' })).toBe(true);
    expect(instanceEmit).toHaveBeenCalledTimes(1);

    const [entry, ctx] = instanceEmit.mock.calls[0];

    expect(entry).toEqual({
      severity: 'INFO',
      message: 'user created',
    });
    expect(ctx).toEqual({
      app: 'demo', // from global
      service: 'users', // from instance
      normalized: { userId: 'u-1' }, // from extras
    });
  });

  it('falls back to global emit when instance emit is not provided', () => {
    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger();
    logger.warn('pay attention');

    expect(globalEmit).toHaveBeenCalledTimes(1);
    const [entry, ctx] = globalEmit.mock.calls[0];
    expect(entry).toEqual({
      severity: 'WARNING',
      message: 'pay attention',
    });
    expect(ctx).toEqual({ app: 'demo' });
  });

  it('falls back to defaultEmit when neither instance nor global emit is available', () => {
    // Explicitly say "no global emit"
    getGlobalEmitFnStub.returns(undefined as any);

    const logger = createLogger();
    logger.error('oh no', { err: 'boom' });

    expect(defaultEmitStub.calledOnce).toBe(true);
    const [entry, ctx] = defaultEmitStub.getCall(0).args;

    expect(entry).toEqual({
      severity: 'ERROR',
      message: 'oh no',
    });
    expect(ctx).toEqual({
      app: 'demo',
      normalized: { err: 'boom' },
    });
  });

  it('respects global min log level when instance does not override', () => {
    getGlobalMinLogLevelStub.returns('WARNING');

    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger();

    logger.debug('no'); // < WARNING → filtered
    logger.info('still no');
    logger.warn('yes');
    logger.error('also yes');

    expect(globalEmit).toHaveBeenCalledTimes(2);
    expect(globalEmit.mock.calls[0][0].severity).toBe('WARNING');
    expect(globalEmit.mock.calls[1][0].severity).toBe('ERROR');
  });

  it('instance emitLevel overrides global min log level', () => {
    getGlobalMinLogLevelStub.returns('WARNING');

    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger({ emitLevel: 'DEBUG' });

    logger.debug('should log');
    expect(globalEmit).toHaveBeenCalledTimes(1);
    expect(globalEmit.mock.calls[0][0].message).toBe('should log');
  });

  it('setLevel changes the threshold at runtime', () => {
    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger(); // global INFO

    logger.info('1'); // logs
    logger.debug('2'); // filtered (INFO)
    expect(globalEmit).toHaveBeenCalledTimes(1);

    logger.setLevel('ERROR'); // now only ERROR+

    logger.warn('3'); // filtered
    logger.error('4'); // logged
    expect(globalEmit).toHaveBeenCalledTimes(2);
    expect(globalEmit.mock.calls[1][0].message).toBe('4');
  });

  it('setContext merges additional instance context', () => {
    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger({ context: { service: 'svc' } });

    logger.info('before');
    logger.setContext({ requestId: 'req-123' });
    logger.info('after');

    const [, ctx2] = globalEmit.mock.calls[1];
    expect(ctx2).toEqual({
      app: 'demo',
      service: 'svc',
      requestId: 'req-123',
    });
  });

  it('uppercases severity passed to emit', () => {
    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger();
    logger.emit('info' as any, 'lowercase');

    expect(globalEmit).toHaveBeenCalledTimes(1);
    const [entry] = globalEmit.mock.calls[0];
    expect(entry.severity).toBe('INFO');
  });

  it('calls instance callback first, otherwise global callback', () => {
    const globalCb = jest.fn();
    getGlobalLogCallbackStub.returns(globalCb);

    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const instanceCb = jest.fn();
    const logger = createLogger({ cb: instanceCb });

    logger.info('hello');

    expect(instanceCb).toHaveBeenCalledTimes(1);
    expect(instanceCb.mock.calls[0][0]).toEqual({
      severity: 'INFO',
      message: 'hello',
    });
    expect(globalCb).not.toHaveBeenCalled();
  });

  it('falls back to global callback when no instance callback is provided', () => {
    const globalCb = jest.fn();
    getGlobalLogCallbackStub.returns(globalCb);

    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger();
    logger.info('hi');

    expect(globalCb).toHaveBeenCalledTimes(1);
    expect(globalCb.mock.calls[0][0]).toEqual({
      severity: 'INFO',
      message: 'hi',
    });
  });

  it('honors global severity ranking when present', () => {
    getGlobalSeverityRankingStub.returns({
      DEBUG: 5,
      INFO: 10,
      WARNING: 50,
      ERROR: 100,
    });
    getGlobalMinLogLevelStub.returns('INFO');

    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger();

    logger.debug('too low');
    logger.info('ok');
    logger.error('also ok');

    expect(globalEmit).toHaveBeenCalledTimes(2);
    expect(globalEmit.mock.calls[0][0].message).toBe('ok');
    expect(globalEmit.mock.calls[1][0].message).toBe('also ok');
  });
});
