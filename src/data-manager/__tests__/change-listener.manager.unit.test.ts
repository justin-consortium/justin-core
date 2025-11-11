import { Readable } from 'stream';
import { ChangeListenerManager } from '../change-listener.manager';
import { CollectionChangeType } from '../../data-manager/data-manager.type';
import DataManager from '../../data-manager/data-manager';
import { Log } from '../../logger/logger-manager';

// mock DataManager so addChangeListener doesn't try to talk to real DB
jest.mock('../../data-manager/data-manager', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(),
  },
}));

describe('ChangeListenerManager (unit)', () => {
  let manager: ChangeListenerManager;
  let mockStream: Readable;
  let getInstanceMock: jest.Mock;
  let devSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    (ChangeListenerManager as any).killInstance?.();

    manager = ChangeListenerManager.getInstance();

    mockStream = new Readable({
      objectMode: true,
      read() {
        /* no-op */
      },
    });

    getInstanceMock = (DataManager as any).getInstance as jest.Mock;
    getInstanceMock.mockReturnValue({
      getChangeStream: jest.fn(() => mockStream),
    });

    devSpy = jest.spyOn(Log, 'dev').mockImplementation(() => {});
    warnSpy = jest.spyOn(Log, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(Log, 'error').mockImplementation(() => {});
    infoSpy = jest.spyOn(Log, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a singleton', () => {
    const again = ChangeListenerManager.getInstance();
    expect(again).toBe(manager);
  });

  it('registers a change listener and wires the stream to the callback', () => {
    const cb = jest.fn();

    manager.addChangeListener('users', CollectionChangeType.INSERT, cb);

    // push data through stream
    const payload = { id: '1' };
    mockStream.emit('data', payload);

    expect(cb).toHaveBeenCalledWith(payload);
    // it also re-emits on the manager
    const eventKey = 'users-INSERT';
    // we didn't subscribe in this test, but we can check that cb was called at least
    expect(devSpy).toHaveBeenCalledWith('Change listener added for users-INSERT.');
  });

  it('logs and skips if listener already exists', () => {
    const cb = jest.fn();

    manager.addChangeListener('users', CollectionChangeType.INSERT, cb);
    manager.addChangeListener('users', CollectionChangeType.INSERT, cb);

    // DataManager.getInstance().getChangeStream should only be called once
    const dm = getInstanceMock.mock.results[0].value;
    expect(dm.getChangeStream).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Change listener for users-INSERT is already registered.'
    );
  });

  it('logs error when stream emits error', () => {
    const cb = jest.fn();

    manager.addChangeListener('users', CollectionChangeType.UPDATE, cb);

    const err = new Error('boom');
    mockStream.emit('error', err);

    expect(errorSpy).toHaveBeenCalledWith('Change stream error', err);
  });

  it('removes a change listener and destroys its stream', () => {
    const cb = jest.fn();
    const destroySpy = jest.spyOn(mockStream, 'destroy');

    manager.addChangeListener('users', CollectionChangeType.DELETE, cb);

    manager.removeChangeListener('users', CollectionChangeType.DELETE);

    expect(destroySpy).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('Change listener removed for users-DELETE.');
    expect(
      manager.hasChangeListener('users', CollectionChangeType.DELETE)
    ).toBe(false);
  });

  it('warns when removing a listener that does not exist', () => {
    manager.removeChangeListener('users', CollectionChangeType.DELETE);

    expect(warnSpy).toHaveBeenCalledWith(
      'No change listener registered for users-DELETE.'
    );
  });

  it('clears all listeners', () => {
    const destroySpy = jest.spyOn(mockStream, 'destroy');

    manager.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());
    manager.addChangeListener('events', CollectionChangeType.UPDATE, jest.fn());

    manager.clearChangeListeners();

    expect(destroySpy).toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      'All custom change listeners removed.'
    );
    expect(
      manager.hasChangeListener('users', CollectionChangeType.INSERT)
    ).toBe(false);
  });

  it('hasChangeListener returns true when listener is present', () => {
    manager.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());

    expect(
      manager.hasChangeListener('users', CollectionChangeType.INSERT)
    ).toBe(true);
  });

  it('hasChangeListener returns false when listener is not present', () => {
    expect(
      manager.hasChangeListener('users', CollectionChangeType.INSERT)
    ).toBe(false);
  });
});
