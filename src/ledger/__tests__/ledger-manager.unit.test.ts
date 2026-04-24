import sinon from 'sinon';

import { LedgerManager } from '../ledger-manager';
import { InMemoryLedgerStore } from '../../testing/testkit/ledger.store.mock';
import { beginLedgerCommit } from '../commit';
import type { LedgerWriteEvent } from '../types';

const T0 = new Date('2024-01-01T00:00:00.000Z');
const T1 = new Date('2024-01-01T00:01:00.000Z');
const T2 = new Date('2024-01-01T00:02:00.000Z');

const makeAddEvent = (
  entity: string,
  recordId: string,
  snapshot: Record<string, unknown>,
  at: Date,
  metadata?: Record<string, unknown>,
): LedgerWriteEvent => ({
  entity,
  recordId,
  operation: 'ADD',
  snapshot,
  commit: { commitId: `commit-add-${recordId}`, committedAt: at, metadata },
});

const makeUpdateEvent = (
  entity: string,
  recordId: string,
  snapshot: Record<string, unknown>,
  at: Date,
): LedgerWriteEvent => ({
  entity,
  recordId,
  operation: 'UPDATE',
  snapshot,
  commit: { commitId: `commit-upd-${recordId}`, committedAt: at },
});

const makeDeleteEvent = (entity: string, recordId: string, at: Date): LedgerWriteEvent => ({
  entity,
  recordId,
  operation: 'DELETE',
  commit: { commitId: `commit-del-${recordId}`, committedAt: at },
});

describe('ledger/manager unit tests', () => {
  let ledgerStore: InMemoryLedgerStore;
  let ledger: LedgerManager;

  beforeEach(() => {
    ledgerStore = new InMemoryLedgerStore();
    ledger = new LedgerManager(ledgerStore);
  });

  afterEach(() => {
    ledgerStore.clear();
    sinon.restore();
  });

  describe('ADD', () => {
    it('appends one entry with validTo=null and operation=ADD', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));

      expect(ledgerStore._all).toHaveLength(1);

      const [e] = ledgerStore._all;
      expect(e.operation).toBe('ADD');
      expect(e.entity).toBe('users');
      expect(e.recordId).toBe('u1');
      expect(e.validFrom).toEqual(T0);
      expect(e.validTo).toBeNull();
    });

    it('stores the snapshot exactly', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));

      expect(ledgerStore._all[0].snapshot).toEqual({ id: 'u1', name: 'Alice' });
    });

    it('produces an all-added diff', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));

      const { diff } = ledgerStore._all[0];
      expect(diff.added).toEqual({ id: 'u1', name: 'Alice' });
      expect(diff.changed).toEqual({});
      expect(diff.removed).toEqual({});
    });

    it('stores commitId and committedAt from the event context', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1' }, T0));

      const [e] = ledgerStore._all;
      expect(e.commitId).toBe('commit-add-u1');
      expect(e.committedAt).toEqual(T0);
    });

    it('stores metadata when provided', async () => {
      await ledger._handleWriteEvent(
        makeAddEvent('users', 'u1', { id: 'u1' }, T0, { initiatedBy: 'test-suite' }),
      );

      expect(ledgerStore._all[0].metadata).toEqual({ initiatedBy: 'test-suite' });
    });
  });

  describe('UPDATE', () => {
    it('closes the previous open entry and appends a new UPDATE entry', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));
      await ledger._handleWriteEvent(
        makeUpdateEvent('users', 'u1', { id: 'u1', name: 'Alicia' }, T1),
      );

      expect(ledgerStore._all).toHaveLength(2);

      const [original, updated] = ledgerStore._all;
      expect(original.validTo).toEqual(T1);
      expect(updated.operation).toBe('UPDATE');
      expect(updated.validFrom).toEqual(T1);
      expect(updated.validTo).toBeNull();
    });

    it('stores the post-image snapshot on the UPDATE entry', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));
      await ledger._handleWriteEvent(
        makeUpdateEvent('users', 'u1', { id: 'u1', name: 'Alicia' }, T1),
      );

      expect(ledgerStore._all[1].snapshot).toEqual({ id: 'u1', name: 'Alicia' });
    });

    it('computes a correct deep diff against the previous snapshot', async () => {
      await ledger._handleWriteEvent(
        makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice', role: 'admin' }, T0),
      );
      await ledger._handleWriteEvent(
        makeUpdateEvent('users', 'u1', { id: 'u1', name: 'Alicia', score: 10 }, T1),
      );

      const { diff } = ledgerStore._all[1];
      expect(diff.changed).toMatchObject({ name: { from: 'Alice', to: 'Alicia' } });
      expect(diff.added).toHaveProperty('score', 10);
      expect(diff.removed).toHaveProperty('role', 'admin');
    });

    it('handles multiple sequential updates — each closes the previous', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));
      await ledger._handleWriteEvent(
        makeUpdateEvent('users', 'u1', { id: 'u1', name: 'Alicia' }, T1),
      );
      await ledger._handleWriteEvent(makeUpdateEvent('users', 'u1', { id: 'u1', name: 'Ali' }, T2));

      expect(ledgerStore._all).toHaveLength(3);
      expect(ledgerStore._all[0].validTo).toEqual(T1);
      expect(ledgerStore._all[1].validTo).toEqual(T2);
      expect(ledgerStore._all[2].validTo).toBeNull();
    });
  });

  describe('DELETE', () => {
    it('closes the previous open entry and appends a DELETE tombstone', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));
      await ledger._handleWriteEvent(makeDeleteEvent('users', 'u1', T1));

      expect(ledgerStore._all).toHaveLength(2);

      const [original, tombstone] = ledgerStore._all;
      expect(original.validTo).toEqual(T1);
      expect(tombstone.operation).toBe('DELETE');
      expect(tombstone.validTo).toBeNull();
    });

    it('sources the tombstone snapshot from the open ledger entry — no DB call', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));
      await ledger._handleWriteEvent(makeDeleteEvent('users', 'u1', T1));

      expect(ledgerStore._all[1].snapshot).toEqual({ id: 'u1', name: 'Alice' });
    });

    it('produces an all-removed diff', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));
      await ledger._handleWriteEvent(makeDeleteEvent('users', 'u1', T1));

      const { diff } = ledgerStore._all[1];
      expect(diff.removed).toEqual({ id: 'u1', name: 'Alice' });
      expect(diff.added).toEqual({});
      expect(diff.changed).toEqual({});
    });

    it('produces an empty diff when no prior ledger entry exists', async () => {
      await ledger._handleWriteEvent(makeDeleteEvent('users', 'ghost', T0));

      const [e] = ledgerStore._all;
      expect(e.operation).toBe('DELETE');
      expect(e.diff).toEqual({ added: {}, changed: {}, removed: {} });
    });
  });

  describe('commit grouping', () => {
    it('entries sharing a commit context have identical commitId and committedAt', async () => {
      const ctx = beginLedgerCommit({ initiatedBy: 'test-suite' });

      const event1: LedgerWriteEvent = {
        entity: 'users',
        recordId: 'u1',
        operation: 'ADD',
        snapshot: { id: 'u1' },
        commit: ctx,
      };
      const event2: LedgerWriteEvent = {
        entity: 'profiles',
        recordId: 'p1',
        operation: 'ADD',
        snapshot: { id: 'p1' },
        commit: ctx,
      };

      await ledger._handleWriteEvent(event1);
      await ledger._handleWriteEvent(event2);

      const [e1, e2] = ledgerStore._all;
      expect(e1.commitId).toBe(ctx.commitId);
      expect(e2.commitId).toBe(ctx.commitId);
      expect(e1.committedAt).toEqual(ctx.committedAt);
      expect(e2.committedAt).toEqual(ctx.committedAt);
    });

    it('independent writes each receive distinct commitIds', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1' }, T0));
      await ledger._handleWriteEvent(makeAddEvent('users', 'u2', { id: 'u2' }, T1));

      expect(ledgerStore._all[0].commitId).not.toBe(ledgerStore._all[1].commitId);
    });
  });

  describe('getRecordAsOf', () => {
    it('returns the snapshot active at the requested time', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));
      await ledger._handleWriteEvent(
        makeUpdateEvent('users', 'u1', { id: 'u1', name: 'Alicia' }, T2),
      );

      const snap = await ledger.getRecordAsOf('users', 'u1', T1);
      expect(snap).toEqual({ id: 'u1', name: 'Alice' });
    });

    it('returns the updated snapshot after the update time', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));
      await ledger._handleWriteEvent(
        makeUpdateEvent('users', 'u1', { id: 'u1', name: 'Alicia' }, T1),
      );

      const snap = await ledger.getRecordAsOf('users', 'u1', T2);
      expect(snap).toEqual({ id: 'u1', name: 'Alicia' });
    });

    it('returns null before the record was created', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1' }, T2));

      const snap = await ledger.getRecordAsOf('users', 'u1', T0);
      expect(snap).toBeNull();
    });

    it('returns null after the record has been deleted', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1' }, T0));
      await ledger._handleWriteEvent(makeDeleteEvent('users', 'u1', T1));

      const snap = await ledger.getRecordAsOf('users', 'u1', T2);
      expect(snap).toBeNull();
    });

    it('returns the snapshot at a time just before deletion', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1', name: 'Alice' }, T0));
      await ledger._handleWriteEvent(makeDeleteEvent('users', 'u1', T2));

      const snap = await ledger.getRecordAsOf('users', 'u1', T1);
      expect(snap).toEqual({ id: 'u1', name: 'Alice' });
    });
  });

  describe('queryAsOf', () => {
    it('returns all live records at the requested time', async () => {
      await ledger._handleWriteEvent(
        makeAddEvent('users', 'u1', { id: 'u1', status: 'active' }, T0),
      );
      await ledger._handleWriteEvent(
        makeAddEvent('users', 'u2', { id: 'u2', status: 'inactive' }, T0),
      );

      const results = await ledger.queryAsOf('users', T1);
      expect(results).toHaveLength(2);
    });

    it('applies filterFn to the snapshots', async () => {
      await ledger._handleWriteEvent(
        makeAddEvent('users', 'u1', { id: 'u1', status: 'active' }, T0),
      );
      await ledger._handleWriteEvent(
        makeAddEvent('users', 'u2', { id: 'u2', status: 'inactive' }, T0),
      );

      const results = await ledger.queryAsOf('users', T1, (s) => s.status === 'active');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: 'u1' });
    });

    it('excludes records deleted before asOf', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1' }, T0));
      await ledger._handleWriteEvent(makeAddEvent('users', 'u2', { id: 'u2' }, T0));
      await ledger._handleWriteEvent(makeDeleteEvent('users', 'u1', T1));

      const results = await ledger.queryAsOf('users', T2);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: 'u2' });
    });

    it('includes a record deleted after asOf', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1' }, T0));
      await ledger._handleWriteEvent(makeDeleteEvent('users', 'u1', T2));

      const results = await ledger.queryAsOf('users', T1);
      expect(results).toHaveLength(1);
    });

    it('returns empty array when no records existed at asOf', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1' }, T2));

      const results = await ledger.queryAsOf('users', T0);
      expect(results).toHaveLength(0);
    });
  });

  describe('getDatabaseAsOf', () => {
    it('reconstructs all entities at the requested time', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1' }, T0));
      await ledger._handleWriteEvent(makeAddEvent('profiles', 'p1', { id: 'p1' }, T0));

      const db = await ledger.getDatabaseAsOf(T1);
      expect(db.users).toHaveLength(1);
      expect(db.profiles).toHaveLength(1);
    });

    it('excludes records added after asOf', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1' }, T0));
      await ledger._handleWriteEvent(makeAddEvent('users', 'u2', { id: 'u2' }, T2));

      const db = await ledger.getDatabaseAsOf(T1);
      expect(db.users).toHaveLength(1);
      expect(db.users[0]).toMatchObject({ id: 'u1' });
    });

    it('includes entities with no live records as empty arrays', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1' }, T0));
      await ledger._handleWriteEvent(makeDeleteEvent('users', 'u1', T1));

      const db = await ledger.getDatabaseAsOf(T2);
      expect(db).toHaveProperty('users');
      expect(db.users).toHaveLength(0);
    });

    it('returns an empty object when the store has no entries', async () => {
      const db = await ledger.getDatabaseAsOf(T0);
      expect(db).toEqual({});
    });

    it('reconstructs multiple entities with correct isolation', async () => {
      await ledger._handleWriteEvent(makeAddEvent('users', 'u1', { id: 'u1' }, T0));
      await ledger._handleWriteEvent(makeAddEvent('users', 'u2', { id: 'u2' }, T0));
      await ledger._handleWriteEvent(makeAddEvent('orders', 'o1', { id: 'o1' }, T0));
      await ledger._handleWriteEvent(makeDeleteEvent('users', 'u2', T1));

      const db = await ledger.getDatabaseAsOf(T2);
      expect(db.users).toHaveLength(1);
      expect(db.orders).toHaveLength(1);
    });
  });

  describe('asWriteHook', () => {
    it('resolves without throwing even when the store throws', async () => {
      sinon.stub(ledgerStore, 'append').rejects(new Error('store unavailable'));

      const hook = ledger.asWriteHook();

      await expect(hook(makeAddEvent('users', 'u1', { id: 'u1' }, T0))).resolves.toBeUndefined();
    });
  });
});
