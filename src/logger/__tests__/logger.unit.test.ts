import sinon, { SinonSandbox, SinonStub } from 'sinon';
import { createLogger } from '../logger';
import * as utils from '../utils';
import * as globalFns from '../global';

describe('createLogger', () => {
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
      .stub(utils, 'normalizeExtraArg')
      .callsFake((extras: unknown) => ({ normalized: extras }));

    getGlobalEmitFnStub = sb.stub(globalFns, 'getGlobalEmitFn');
    getGlobalLogCallbackStub = sb.stub(globalFns, 'getGlobalLogCallback');
    getGlobalLogContextStub = sb
      .stub(globalFns, 'getGlobalLogContext')
      .returns({ globalKey: 'globalVal' });
    getGlobalMinLogLevelStub = sb
      .stub(globalFns, 'getGlobalMinLogLevel')
      .returns('DEBUG');
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

  it('emits using the effective emit (instance → global → default)', () => {
    const instanceEmit = jest.fn();
    const logger = createLogger({
      emitFn: instanceEmit,
      context: { service: 'test' },
    });

    logger.emit('INFO', 'hello', { extra: 1 });

    expect(normalizeExtraArgStub.calledWith({ extra: 1 })).toBe(true);

    expect(instanceEmit).toHaveBeenCalledTimes(1);
    const [entry, mergedCtx] = instanceEmit.mock.calls[0];

    expect(entry).toMatchObject({
      severity: 'INFO',
      message: 'hello',
    });

    expect(mergedCtx).toEqual({
      globalKey: 'globalVal',
      service: 'test',
      normalized: { extra: 1 },
    });

    expect(defaultEmitStub.called).toBe(false);
  });

  it('falls back to global emit when no instance emit is provided', () => {
    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger();
    logger.info('hey');

    expect(globalEmit).toHaveBeenCalledTimes(1);
    const [entry, ctx] = globalEmit.mock.calls[0];
    expect(entry.severity).toBe('INFO');
    expect(entry.message).toBe('hey');
    expect(ctx).toEqual({ globalKey: 'globalVal' });
  });

  it('falls back to default emit when neither instance nor global emit are provided', () => {
    getGlobalEmitFnStub.returns(undefined as any);

    const logger = createLogger();
    logger.warn('careful');

    expect(defaultEmitStub.calledOnce).toBe(true);
    const [entry, ctx] = defaultEmitStub.getCall(0).args;
    expect(entry.severity).toBe('WARNING');
    expect(entry.message).toBe('careful');
    expect(ctx).toEqual({ globalKey: 'globalVal' });
  });

  it('respects the minimum log level from globals', () => {
    getGlobalMinLogLevelStub.returns('WARNING');

    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger();

    logger.debug('nope');
    logger.info('still nope');
    logger.warn('yes');
    logger.error('also yes');

    expect(globalEmit).toHaveBeenCalledTimes(2);
    expect(globalEmit.mock.calls[0][0].severity).toBe('WARNING');
    expect(globalEmit.mock.calls[1][0].severity).toBe('ERROR');
  });

  it('can override minimum log level per logger via options', () => {
    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger({ emitLevel: 'DEBUG' });

    logger.debug('should emit');

    expect(globalEmit).toHaveBeenCalledTimes(1);
    expect(globalEmit.mock.calls[0][0].message).toBe('should emit');
  });

  it('setLevel updates min level at runtime', () => {
    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger();

    logger.debug('first');
    expect(globalEmit).toHaveBeenCalledTimes(1);

    logger.setLevel('ERROR');

    logger.info('second');
    logger.warn('third');
    expect(globalEmit).toHaveBeenCalledTimes(1);

    logger.error('fourth');
    expect(globalEmit).toHaveBeenCalledTimes(2);
    expect(globalEmit.mock.calls[1][0].message).toBe('fourth');
  });

  it('setContext merges instance context for later emits', () => {
    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger({ context: { service: 'svc' } });

    logger.info('before');
    logger.setContext({ requestId: 'req-1' });
    logger.info('after');

    const [, ctx2] = globalEmit.mock.calls[1];
    expect(ctx2).toEqual({
      globalKey: 'globalVal',
      service: 'svc',
      requestId: 'req-1',
    });
  });

  it('uppercases severity passed to emit', () => {
    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger();

    logger.emit('info' as any, 'message');

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

    logger.info('hi');

    expect(instanceCb).toHaveBeenCalledTimes(1);
    expect(globalCb).not.toHaveBeenCalled();
  });

  it('calls global callback when no instance callback is provided', () => {
    const globalCb = jest.fn();
    getGlobalLogCallbackStub.returns(globalCb);

    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger();
    logger.info('hey');

    expect(globalCb).toHaveBeenCalledTimes(1);
    const [entry] = globalCb.mock.calls[0];
    expect(entry.message).toBe('hey');
  });

  it('passes normalized extras in the merged context', () => {
    const globalEmit = jest.fn();
    getGlobalEmitFnStub.returns(globalEmit);

    const logger = createLogger();

    logger.info('has extras', { user: { id: 'u1' } });

    expect(
      normalizeExtraArgStub.calledWith({ user: { id: 'u1' } }),
    ).toBe(true);

    const [entry, ctx] = globalEmit.mock.calls[0];
    expect(entry).toEqual({
      severity: 'INFO',
      message: 'has extras',
    });
    expect(ctx).toEqual({
      globalKey: 'globalVal',
      normalized: { user: { id: 'u1' } },
    });
  });
});
