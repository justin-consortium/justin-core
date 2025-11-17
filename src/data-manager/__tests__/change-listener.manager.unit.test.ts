import { ChangeListenerManager } from '../change-listener.manager';
import { CollectionChangeType } from '../data-manager.type';
import { USERS } from '../data-manager.constants';
import { mockDataManager, loggerSpies } from '../../__tests__/mocks';

describe('ChangeListenerManager (unit)', () => {
  let manager: ChangeListenerManager;

  beforeEach(() => {
    (ChangeListenerManager as any).killInstance?.();
    manager = ChangeListenerManager.getInstance();

    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('registers a listener and marks it as present', () => {
    const dm = mockDataManager();

    const cb = jest.fn();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    expect(manager.hasChangeListener(USERS, CollectionChangeType.INSERT)).toBe(true);

    const payload = { id: 'u1' };
    const stream = dm.getStream(USERS, CollectionChangeType.INSERT);
    stream.emit('data', payload);

    expect(cb).toHaveBeenCalledWith(payload);

    dm.restore();
  });

  it('prevents duplicate registration and warns', () => {
    const dm = mockDataManager();
    const logs = loggerSpies();

    const cb = jest.fn();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    logs.expectLast('already registered', 'WARNING');

    const payload = { id: 'u2' };
    const stream = dm.getStream(USERS, CollectionChangeType.INSERT);
    stream.emit('data', payload);

    expect(cb).toHaveBeenCalledTimes(1);

    logs.restore();
    dm.restore();
  });

  it('removes a listener and stops receiving events', () => {
    const dm = mockDataManager();

    const cb = jest.fn();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    expect(manager.hasChangeListener(USERS, CollectionChangeType.INSERT)).toBe(true);

    manager.removeChangeListener(USERS, CollectionChangeType.INSERT);
    expect(manager.hasChangeListener(USERS, CollectionChangeType.INSERT)).toBe(false);

    const stream = dm.getStream(USERS, CollectionChangeType.INSERT);
    stream.emit('data', { id: 'u3' });
    expect(cb).not.toHaveBeenCalled();

    dm.restore();
  });

  it('clears all listeners and destroys streams', () => {
    const dm = mockDataManager();

    const cb1 = jest.fn();
    const cb2 = jest.fn();

    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb1);
    manager.addChangeListener(USERS, CollectionChangeType.UPDATE, cb2);

    const s1 = dm.getStream(USERS, CollectionChangeType.INSERT);
    const s2 = dm.getStream(USERS, CollectionChangeType.UPDATE);

    manager.clearChangeListeners();

    expect((s1 as any).destroyed ?? false).toBe(true);
    expect((s2 as any).destroyed ?? false).toBe(true);

    s1.emit('data', { id: 'nope-1' });
    s2.emit('data', { id: 'nope-2' });
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();

    dm.restore();
  });

  it('emits the manager-level event alongside the callback', () => {
    const dm = mockDataManager();

    const cb = jest.fn();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    const emitted: any[] = [];
    const eventName = `${USERS}-${CollectionChangeType.INSERT}`;
    manager.on(eventName, (payload) => emitted.push(payload));

    const payload = { id: 'u5' };
    const stream = dm.getStream(USERS, CollectionChangeType.INSERT);
    stream.emit('data', payload);

    expect(cb).toHaveBeenCalledWith(payload);
    expect(emitted).toEqual([payload]);

    dm.restore();
  });

  it('handles stream error by logging and not crashing', () => {
    const dm = mockDataManager();
    const logs = loggerSpies();

    const cb = jest.fn();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    const boom = new Error('stream-bad');
    const stream = dm.getStream(USERS, CollectionChangeType.INSERT);
    stream.emit('error', boom);

    logs.expectLast('Change stream error', 'ERROR');
    expect(cb).not.toHaveBeenCalled();

    logs.restore();
    dm.restore();
  });

  it('warns when removing a non-existent listener', () => {
    mockDataManager();
    const logs = loggerSpies();

    manager.removeChangeListener(USERS, CollectionChangeType.DELETE);

    logs.expectLast('No change listener registered', 'WARNING');
    logs.restore();
  });
});
