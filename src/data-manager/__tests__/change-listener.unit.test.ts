import { ChangeListenerManager } from '../change-listener.manager';
import { CollectionChangeType } from '../types';
import { mockDataManager } from '../../testing/testkit';
import { makeStream, push, resetSingleton } from '../../testing/helpers';
import { loggerSpies, resetGlobalLoggerState } from '../../testing/testkit';
import type { LoggerSpies } from '../../testing/testkit';

describe('ChangeListenerManager unit tests', () => {
  let dmMock: ReturnType<typeof mockDataManager>;
  let lg: LoggerSpies;

  beforeEach(() => {
    dmMock?.restore();
    lg?.restore();
    resetSingleton(ChangeListenerManager);
    dmMock = mockDataManager();
    lg = loggerSpies();
  });

  afterEach(async () => {
    try {
      await ChangeListenerManager.getInstance().clearChangeListeners();
    } catch {}
    dmMock?.restore();
    lg?.restore();
    resetGlobalLoggerState();
    resetSingleton(ChangeListenerManager);
  });

  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      const a = ChangeListenerManager.getInstance();
      const b = ChangeListenerManager.getInstance();
      expect(a).toBe(b);
    });

    it('returns a new instance after killInstance', () => {
      const a = ChangeListenerManager.getInstance();
      resetSingleton(ChangeListenerManager);
      const b = ChangeListenerManager.getInstance();
      expect(a).not.toBe(b);
    });
  });

  describe('addChangeListener', () => {
    it('invokes the callback when data is pushed to the stream', () => {
      const clm = ChangeListenerManager.getInstance();
      const callback = jest.fn();

      clm.addChangeListener('users', CollectionChangeType.INSERT, callback);
      const stream = dmMock.getStream('users', CollectionChangeType.INSERT);
      push(stream, { id: 'abc' });

      expect(callback).toHaveBeenCalledWith({ id: 'abc' });
    });

    it('does not register a duplicate listener for the same key', () => {
      const clm = ChangeListenerManager.getInstance();

      clm.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());
      clm.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());

      expect(lg.findByMessage('already registered')).toHaveLength(1);
      expect(clm.hasChangeListener('users', CollectionChangeType.INSERT)).toBe(true);
    });

    it('allows separate listeners for different change types on the same collection', () => {
      const clm = ChangeListenerManager.getInstance();
      const insertCb = jest.fn();
      const updateCb = jest.fn();

      clm.addChangeListener('users', CollectionChangeType.INSERT, insertCb);
      clm.addChangeListener('users', CollectionChangeType.UPDATE, updateCb);

      push(dmMock.getStream('users', CollectionChangeType.INSERT), { type: 'insert' });
      push(dmMock.getStream('users', CollectionChangeType.UPDATE), { type: 'update' });

      expect(insertCb).toHaveBeenCalledWith({ type: 'insert' });
      expect(updateCb).toHaveBeenCalledWith({ type: 'update' });
    });

    it('allows separate listeners for different collections', () => {
      const clm = ChangeListenerManager.getInstance();
      const usersCb = jest.fn();
      const paCb = jest.fn();

      clm.addChangeListener('users', CollectionChangeType.INSERT, usersCb);
      clm.addChangeListener('protected_attributes', CollectionChangeType.INSERT, paCb);

      push(dmMock.getStream('users', CollectionChangeType.INSERT), { a: 1 });
      push(dmMock.getStream('protected_attributes', CollectionChangeType.INSERT), { b: 2 });

      expect(usersCb).toHaveBeenCalledWith({ a: 1 });
      expect(paCb).toHaveBeenCalledWith({ b: 2 });
    });

    it('emits the change event on the ChangeListenerManager itself', () => {
      const clm = ChangeListenerManager.getInstance();
      const emitSpy = jest.fn();
      clm.on('users-insert', emitSpy);

      clm.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());
      push(dmMock.getStream('users', CollectionChangeType.INSERT), { id: 'abc' });

      expect(emitSpy).toHaveBeenCalledWith({ id: 'abc' });
    });
  });

  describe('hasChangeListener', () => {
    it('returns false when no listener is registered', () => {
      const clm = ChangeListenerManager.getInstance();
      expect(clm.hasChangeListener('users', CollectionChangeType.INSERT)).toBe(false);
    });

    it('returns true after a listener is registered', () => {
      const clm = ChangeListenerManager.getInstance();
      clm.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());
      expect(clm.hasChangeListener('users', CollectionChangeType.INSERT)).toBe(true);
    });

    it('returns false after the listener is removed', async () => {
      const clm = ChangeListenerManager.getInstance();
      clm.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());
      await clm.removeChangeListener('users', CollectionChangeType.INSERT);
      expect(clm.hasChangeListener('users', CollectionChangeType.INSERT)).toBe(false);
    });
  });

  describe('removeChangeListener', () => {
    it('stops the callback from firing after removal', async () => {
      const clm = ChangeListenerManager.getInstance();
      const callback = jest.fn();

      clm.addChangeListener('users', CollectionChangeType.INSERT, callback);
      await clm.removeChangeListener('users', CollectionChangeType.INSERT);

      push(dmMock.getStream('users', CollectionChangeType.INSERT), { id: 'abc' });

      expect(callback).not.toHaveBeenCalled();
    });

    it('logs a warning when no listener is registered for the key', async () => {
      const clm = ChangeListenerManager.getInstance();
      await clm.removeChangeListener('users', CollectionChangeType.INSERT);
      expect(lg.findByMessage('No change listener registered')).toHaveLength(1);
    });

    it('is safe to call twice for the same key', async () => {
      const clm = ChangeListenerManager.getInstance();
      clm.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());
      await clm.removeChangeListener('users', CollectionChangeType.INSERT);
      await expect(
        clm.removeChangeListener('users', CollectionChangeType.INSERT),
      ).resolves.not.toThrow();
    });

    it('does not affect other registered listeners', async () => {
      const clm = ChangeListenerManager.getInstance();
      const updateCb = jest.fn();

      clm.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());
      clm.addChangeListener('users', CollectionChangeType.UPDATE, updateCb);

      await clm.removeChangeListener('users', CollectionChangeType.INSERT);

      push(dmMock.getStream('users', CollectionChangeType.UPDATE), { id: 'abc' });
      expect(updateCb).toHaveBeenCalled();
    });
  });

  describe('clearChangeListeners', () => {
    it('removes all registered listeners', async () => {
      const clm = ChangeListenerManager.getInstance();
      clm.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());
      clm.addChangeListener('users', CollectionChangeType.UPDATE, jest.fn());
      clm.addChangeListener('protected_attributes', CollectionChangeType.INSERT, jest.fn());

      await clm.clearChangeListeners();

      expect(clm.hasChangeListener('users', CollectionChangeType.INSERT)).toBe(false);
      expect(clm.hasChangeListener('users', CollectionChangeType.UPDATE)).toBe(false);
      expect(clm.hasChangeListener('protected_attributes', CollectionChangeType.INSERT)).toBe(
        false,
      );
    });

    it('stops all callbacks from firing after clear', async () => {
      const clm = ChangeListenerManager.getInstance();
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      clm.addChangeListener('users', CollectionChangeType.INSERT, cb1);
      clm.addChangeListener('users', CollectionChangeType.UPDATE, cb2);

      await clm.clearChangeListeners();

      push(dmMock.getStream('users', CollectionChangeType.INSERT), { id: 'a' });
      push(dmMock.getStream('users', CollectionChangeType.UPDATE), { id: 'b' });

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();
    });

    it('is safe to call when no listeners are registered', async () => {
      const clm = ChangeListenerManager.getInstance();
      await expect(clm.clearChangeListeners()).resolves.not.toThrow();
    });
  });

  describe('stream error handling', () => {
    it('logs an error when the stream emits an error event', () => {
      const clm = ChangeListenerManager.getInstance();
      clm.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());

      const stream = dmMock.getStream('users', CollectionChangeType.INSERT);
      stream.emit('error', new Error('stream broke'));

      expect(lg.findByMessage('Change stream errors')).toHaveLength(1);
    });

    it('calls the cleanup hook when removing a stream that has one', async () => {
      const clm = ChangeListenerManager.getInstance();
      const stream = makeStream();
      const cleanup = jest.fn().mockResolvedValue(undefined);
      (stream as any).cleanup = cleanup;

      dmMock.instance.getChangeStream.returns(stream);

      clm.addChangeListener('users', CollectionChangeType.INSERT, jest.fn());
      await expect(
        clm.removeChangeListener('users', CollectionChangeType.INSERT),
      ).resolves.not.toThrow();

      expect(cleanup).toHaveBeenCalled();
    });
  });
});
