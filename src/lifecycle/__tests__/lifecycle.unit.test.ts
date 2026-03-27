import sinon from 'sinon';
import {
  makeCoreManagersSandbox,
  loggerSpies,
  resetGlobalLoggerState,
} from '../../testing/testkit';
import type { CoreManagersSandbox, LoggerSpies } from '../../testing/testkit';
import { registerManager, clearManagerRegistry, shutdownCore } from '../index';

describe('lifecycle unit tests', () => {
  let t: CoreManagersSandbox;
  let lg: LoggerSpies;

  beforeEach(() => {
    t?.restore();
    lg?.restore();
    t = makeCoreManagersSandbox();
    lg = loggerSpies();
    // close is not stubbed by makeCoreManagersSandbox — add it here so
    // shutdownCore can call dm.close without hitting the real implementation
    t.sb.stub(t.dm, 'close').resolves();
    clearManagerRegistry();
  });

  afterEach(() => {
    t?.restore();
    lg?.restore();
    resetGlobalLoggerState();
    clearManagerRegistry();
  });

  describe('registerManager / clearManagerRegistry', () => {
    it('registered managers are called during shutdownCore', async () => {
      const manager = { shutdown: sinon.stub().resolves() };
      registerManager(manager);

      await shutdownCore();

      expect(manager.shutdown.calledOnce).toBe(true);
    });

    it('ignores duplicate registrations of the same object reference', async () => {
      const manager = { shutdown: sinon.stub().resolves() };
      registerManager(manager);
      registerManager(manager);

      await shutdownCore();

      expect(manager.shutdown.calledOnce).toBe(true);
    });

    it('clearManagerRegistry prevents registered managers from being called', async () => {
      const manager = { shutdown: sinon.stub().resolves() };
      registerManager(manager);
      clearManagerRegistry();

      await shutdownCore();

      expect(manager.shutdown.called).toBe(false);
    });
  });

  describe('shutdownCore', () => {
    it('shuts down all registered managers', async () => {
      const m1 = { shutdown: sinon.stub().resolves() };
      const m2 = { shutdown: sinon.stub().resolves() };
      registerManager(m1);
      registerManager(m2);

      await shutdownCore();

      expect(m1.shutdown.calledOnce).toBe(true);
      expect(m2.shutdown.calledOnce).toBe(true);
    });

    it('calls clearChangeListeners after manager shutdown', async () => {
      await shutdownCore();

      expect((t.clm as any).clearChangeListeners.calledOnce).toBe(true);
    });

    it('calls dm.close when DataManager is initialised', async () => {
      (t.dm as any).getInitializationStatus.returns(true);

      await shutdownCore();

      expect((t.dm as any).close.calledOnce).toBe(true);
    });

    it('does not call dm.close when DataManager is not initialised', async () => {
      (t.dm as any).getInitializationStatus.returns(false);

      await shutdownCore();

      expect((t.dm as any).close.called).toBe(false);
    });

    it('clears the manager registry on completion so re-init is clean', async () => {
      const manager = { shutdown: sinon.stub().resolves() };
      registerManager(manager);

      await shutdownCore();

      // Second call should not invoke the manager again
      await shutdownCore();
      expect(manager.shutdown.calledOnce).toBe(true);
    });

    it('continues shutting down remaining systems when a manager throws — continueOnError: true by default', async () => {
      const failing = { shutdown: sinon.stub().rejects(new Error('manager down')) };
      const passing = { shutdown: sinon.stub().resolves() };
      registerManager(failing);
      registerManager(passing);

      await expect(shutdownCore()).resolves.not.toThrow();
      expect(passing.shutdown.calledOnce).toBe(true);
    });

    it('logs an error when a manager shutdown fails', async () => {
      const failing = { shutdown: sinon.stub().rejects(new Error('manager down')) };
      registerManager(failing);
      // Prevent dm.close from also logging — only the manager failure should appear
      (t.dm as any).getInitializationStatus.returns(false);

      await shutdownCore();

      expect(lg.findByMessage('shutdownCore: manager.shutdown failed')).toHaveLength(1);
    });

    it('throws when continueOnError is false and a manager fails', async () => {
      const failing = { shutdown: sinon.stub().rejects(new Error('manager down')) };
      registerManager(failing);

      await expect(shutdownCore({ continueOnError: false })).rejects.toThrow('manager down');
    });

    it('shuts down managers in parallel — all are called even if one is slow', async () => {
      const order: string[] = [];
      const slow = {
        shutdown: sinon.stub().callsFake(async () => {
          await new Promise((r) => setTimeout(r, 10));
          order.push('slow');
        }),
      };
      const fast = {
        shutdown: sinon.stub().callsFake(async () => {
          order.push('fast');
        }),
      };
      registerManager(slow);
      registerManager(fast);

      await shutdownCore();

      // Both ran — order may vary since they run in parallel
      expect(order).toContain('slow');
      expect(order).toContain('fast');
    });
  });
});
