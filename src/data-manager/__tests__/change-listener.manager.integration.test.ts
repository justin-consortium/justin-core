
import { Readable } from 'stream';
import { ChangeListenerManager } from '../change-listener.manager';
import { CollectionChangeType } from '../../data-manager/data-manager.type';
import DataManager from '../../data-manager/data-manager';
import { Log } from '../../logger/logger-manager';

jest.mock('../../data-manager/data-manager', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(),
  },
}));

describe('ChangeListenerManager (integration)', () => {
  let manager: ChangeListenerManager;
  let dmGetInstance: jest.Mock;
  let devSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  // two separate streams to simulate two collections
  let userStream: Readable;
  let taskStream: Readable;

  beforeEach(() => {
    (ChangeListenerManager as any).killInstance?.();
    manager = ChangeListenerManager.getInstance();

    dmGetInstance = (DataManager as any).getInstance as jest.Mock;

    userStream = new Readable({
      objectMode: true,
      read() {},
    });
    taskStream = new Readable({
      objectMode: true,
      read() {},
    });

    // we need DataManager.getInstance().getChangeStream to return different streams
    dmGetInstance.mockReturnValue({
      getChangeStream: (collectionName: string, changeType: CollectionChangeType) => {
        if (collectionName === 'users') return userStream;
        if (collectionName === 'tasks') return taskStream;

        return new Readable({
          objectMode: true,
          read() {},
        });
      },
    });

    devSpy = jest.spyOn(Log, 'dev').mockImplementation(() => {});
    infoSpy = jest.spyOn(Log, 'info').mockImplementation(() => {});
    warnSpy = jest.spyOn(Log, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(Log, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('re-emits data events on its own event bus', (done) => {
    const payload = { id: '1', name: 'Alice' };

    manager.on('users-INSERT', (data) => {
      expect(data).toEqual(payload);
      done();
    });

    manager.addChangeListener('users', CollectionChangeType.INSERT, () => {
    });

    userStream.emit('data', payload);
  });

  it('can manage multiple listeners at once', () => {
    const userCb = jest.fn();
    const taskCb = jest.fn();

    manager.addChangeListener('users', CollectionChangeType.INSERT, userCb);
    manager.addChangeListener('tasks', CollectionChangeType.UPDATE, taskCb);

    userStream.emit('data', { id: 'u1' });
    taskStream.emit('data', { id: 't1' });

    expect(userCb).toHaveBeenCalledWith({ id: 'u1' });
    expect(taskCb).toHaveBeenCalledWith({ id: 't1' });

    expect(
      manager.hasChangeListener('users', CollectionChangeType.INSERT)
    ).toBe(true);
    expect(
      manager.hasChangeListener('tasks', CollectionChangeType.UPDATE)
    ).toBe(true);
  });

  it('clearChangeListeners tears down all streams', () => {
    const userDestroy = jest.spyOn(userStream, 'destroy');
    const taskDestroy = jest.spyOn(taskStream, 'destroy');

    manager.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());
    manager.addChangeListener('tasks', CollectionChangeType.UPDATE, jest.fn());

    manager.clearChangeListeners();

    expect(userDestroy).toHaveBeenCalled();
    expect(taskDestroy).toHaveBeenCalled();
    expect(
      manager.hasChangeListener('users', CollectionChangeType.INSERT)
    ).toBe(false);
    expect(
      manager.hasChangeListener('tasks', CollectionChangeType.UPDATE)
    ).toBe(false);
    expect(infoSpy).toHaveBeenCalledWith('All custom change listeners removed.');
  });

  it('logs stream errors from any of the streams', () => {
    manager.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());

    const err = new Error('stream blew up');
    userStream.emit('error', err);

    expect(errorSpy).toHaveBeenCalledWith('Change stream error', err);
  });
});
