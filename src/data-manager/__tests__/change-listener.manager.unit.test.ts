import sinon, { SinonSandbox } from 'sinon';
import { ChangeListenerManager } from '../change-listener.manager';
import { CollectionChangeType } from '../data-manager.type';
import { USERS } from '../data-manager.constants';
import { resetSingleton, expectLog } from '../../__tests__/helpers';
import { mockDataManager, loggerSpies } from '../../__tests__/testkit';

/**
 * ChangeListenerManager calls `stream.cleanup?.()` asynchronously (best-effort)
 * before destroying the stream.
 *
 * These helpers let tests wait for that microtask chain to finish.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

describe('ChangeListenerManager (unit)', () => {
  let sb: SinonSandbox;
  let manager: ChangeListenerManager;

  beforeEach(() => {
    sb = sinon.createSandbox();

    resetSingleton(ChangeListenerManager);
    manager = ChangeListenerManager.getInstance();
  });

  afterEach(() => {
    sb.restore();
  });

  it('registers a listener and marks it as present', () => {
    const dm = mockDataManager();

    const cb = sb.stub();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    expect(manager.hasChangeListener(USERS, CollectionChangeType.INSERT)).toBe(true);

    const payload = { id: 'u1' };
    const stream = dm.getStream(USERS, CollectionChangeType.INSERT);
    stream.emit('data', payload);

    sinon.assert.calledOnce(cb);
    sinon.assert.calledWith(cb, payload);

    dm.restore();
  });

  it('prevents duplicate registration and warns', () => {
    const dm = mockDataManager();
    const logs = loggerSpies();

    const cb = sb.stub();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    expectLog(logs.last(), { severity: 'WARNING', messageSubstr: 'already registered' });

    const payload = { id: 'u2' };
    const stream = dm.getStream(USERS, CollectionChangeType.INSERT);
    stream.emit('data', payload);

    sinon.assert.calledOnce(cb);

    logs.restore();
    dm.restore();
  });

  it('removes a listener and stops receiving events', () => {
    const dm = mockDataManager();

    const cb = sb.stub();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    expect(manager.hasChangeListener(USERS, CollectionChangeType.INSERT)).toBe(true);

    manager.removeChangeListener(USERS, CollectionChangeType.INSERT);
    expect(manager.hasChangeListener(USERS, CollectionChangeType.INSERT)).toBe(false);

    const stream = dm.getStream(USERS, CollectionChangeType.INSERT);
    stream.emit('data', { id: 'u3' });

    sinon.assert.notCalled(cb);

    dm.restore();
  });

  it('clears all listeners and destroys streams', () => {
    const dm = mockDataManager();

    const cb1 = sb.stub();
    const cb2 = sb.stub();

    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb1);
    manager.addChangeListener(USERS, CollectionChangeType.UPDATE, cb2);

    const s1 = dm.getStream(USERS, CollectionChangeType.INSERT);
    const s2 = dm.getStream(USERS, CollectionChangeType.UPDATE);

    manager.clearChangeListeners();

    expect((s1 as any).destroyed ?? false).toBe(true);
    expect((s2 as any).destroyed ?? false).toBe(true);

    s1.emit('data', { id: 'nope-1' });
    s2.emit('data', { id: 'nope-2' });

    sinon.assert.notCalled(cb1);
    sinon.assert.notCalled(cb2);

    dm.restore();
  });

  it('emits the manager-level event alongside the callback', () => {
    const dm = mockDataManager();

    const cb = sb.stub();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    const emitted: any[] = [];
    const eventName = `${USERS}-${CollectionChangeType.INSERT}`;
    manager.on(eventName, (payload: any) => emitted.push(payload));

    const payload = { id: 'u5' };
    const stream = dm.getStream(USERS, CollectionChangeType.INSERT);
    stream.emit('data', payload);

    sinon.assert.calledOnce(cb);
    sinon.assert.calledWith(cb, payload);
    expect(emitted).toEqual([payload]);

    dm.restore();
  });

  it('handles stream error by logging and not crashing', () => {
    const dm = mockDataManager();
    const logs = loggerSpies();

    const cb = sb.stub();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    const boom = new Error('stream-bad');
    const stream = dm.getStream(USERS, CollectionChangeType.INSERT);
    stream.emit('error', boom);

    expectLog(logs.last(), { severity: 'ERROR', messageSubstr: 'Change stream error' });
    sinon.assert.notCalled(cb);

    logs.restore();
    dm.restore();
  });

  it('warns when removing a non-existent listener', () => {
    const dm = mockDataManager();
    const logs = loggerSpies();

    manager.removeChangeListener(USERS, CollectionChangeType.DELETE);

    expectLog(logs.last(), { severity: 'WARNING', messageSubstr: 'No change listener registered' });

    logs.restore();
    dm.restore();
  });

  it('calls stream.cleanup() (if present) when removing a listener, then destroys the stream', async () => {
    const dm = mockDataManager();

    const cb = sb.stub();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    const stream = dm.getStream(USERS, CollectionChangeType.INSERT) as any;

    const cleanupStub = sb.stub().resolves();
    stream.cleanup = cleanupStub;

    manager.removeChangeListener(USERS, CollectionChangeType.INSERT);

    await flushMicrotasks();

    sinon.assert.calledOnce(cleanupStub);
    expect(stream.destroyed ?? false).toBe(true);

    dm.restore();
  });

  it('still destroys the stream even if stream.cleanup() rejects', async () => {
    const dm = mockDataManager();

    const cb = sb.stub();
    manager.addChangeListener(USERS, CollectionChangeType.INSERT, cb);

    const stream = dm.getStream(USERS, CollectionChangeType.INSERT) as any;

    const cleanupStub = sb.stub().rejects(new Error('cleanup-failed'));
    stream.cleanup = cleanupStub;

    manager.removeChangeListener(USERS, CollectionChangeType.INSERT);

    await flushMicrotasks();

    sinon.assert.calledOnce(cleanupStub);
    expect(stream.destroyed ?? false).toBe(true);

    dm.restore();
  });
});
