import { InMemoryLedgerStore } from '../../testing/testkit/ledger.store.mock';
import type { LedgerEntry } from '../types';

const T0 = new Date('2024-01-01T00:00:00.000Z');
const T1 = new Date('2024-01-01T00:01:00.000Z');
const T2 = new Date('2024-01-01T00:02:00.000Z');

const makeEntry = (
  overrides: Partial<LedgerEntry> & Pick<LedgerEntry, 'entity' | 'recordId'>,
): LedgerEntry => ({
  validFrom: T0,
  validTo: null,
  operation: 'ADD',
  snapshot: { id: overrides.recordId },
  diff: { added: {}, changed: {}, removed: {} },
  commitId: `commit-${overrides.recordId}`,
  committedAt: overrides.validFrom ?? T0,
  ...overrides,
});

describe('ledger/store unit tests', () => {
  let ledgerStore: InMemoryLedgerStore;

  beforeEach(() => {
    ledgerStore = new InMemoryLedgerStore();
  });

  afterEach(() => {
    ledgerStore.clear();
  });

  describe('append', () => {
    it('stores the entry and makes it visible via _all', async () => {
      const entry = makeEntry({ entity: 'users', recordId: 'u1' });
      await ledgerStore.append(entry);

      expect(ledgerStore._all).toHaveLength(1);
      expect(ledgerStore._all[0]).toMatchObject({ entity: 'users', recordId: 'u1' });
    });

    it('stores a shallow copy — external mutations do not affect the stored entry', async () => {
      const entry = makeEntry({ entity: 'users', recordId: 'u1' });
      await ledgerStore.append(entry);

      (entry as any).recordId = 'mutated';

      expect(ledgerStore._all[0].recordId).toBe('u1');
    });

    it('stores multiple entries independently', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1' }));
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u2' }));

      expect(ledgerStore._all).toHaveLength(2);
    });
  });

  describe('closeOpenVersions', () => {
    it('sets validTo on the open entry for the given record', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0 }));

      await ledgerStore.closeOpenVersions('users', 'u1', T1);

      expect(ledgerStore._all[0].validTo).toEqual(T1);
    });

    it('does not close entries for other records', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0 }));
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u2', validFrom: T0 }));

      await ledgerStore.closeOpenVersions('users', 'u1', T1);

      expect(ledgerStore._all[0].validTo).toEqual(T1);
      expect(ledgerStore._all[1].validTo).toBeNull();
    });

    it('does not close entries for other entities', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0 }));
      await ledgerStore.append(makeEntry({ entity: 'profiles', recordId: 'u1', validFrom: T0 }));

      await ledgerStore.closeOpenVersions('users', 'u1', T1);

      expect(ledgerStore._all[0].validTo).toEqual(T1);
      expect(ledgerStore._all[1].validTo).toBeNull();
    });

    it('is a no-op when no open entry exists for the record', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: T1 }),
      );

      await ledgerStore.closeOpenVersions('users', 'u1', T2);

      expect(ledgerStore._all[0].validTo).toEqual(T1);
    });
  });

  describe('findOpenVersion', () => {
    it('returns the open entry for a record', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0 }));

      const result = await ledgerStore.findOpenVersion('users', 'u1');

      expect(result).not.toBeNull();
      expect(result?.recordId).toBe('u1');
      expect(result?.validTo).toBeNull();
    });

    it('returns null when no open entry exists', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: T1 }),
      );

      const result = await ledgerStore.findOpenVersion('users', 'u1');

      expect(result).toBeNull();
    });

    it('returns null for an unknown record', async () => {
      const result = await ledgerStore.findOpenVersion('users', 'nonexistent');

      expect(result).toBeNull();
    });

    it('returns the most recently appended open entry when multiple exist', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, snapshot: { v: 1 } }),
      );
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T1, snapshot: { v: 2 } }),
      );

      const result = await ledgerStore.findOpenVersion('users', 'u1');

      expect(result?.snapshot).toMatchObject({ v: 2 });
    });
  });

  describe('findVersionAsOf', () => {
    it('returns the entry whose interval contains asOf', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: null }),
      );

      const result = await ledgerStore.findVersionAsOf('users', 'u1', T1);

      expect(result).not.toBeNull();
      expect(result?.recordId).toBe('u1');
    });

    it('returns null when asOf is before validFrom', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T1, validTo: null }),
      );

      const result = await ledgerStore.findVersionAsOf('users', 'u1', T0);

      expect(result).toBeNull();
    });

    it('returns null when asOf is exactly at validTo (exclusive upper bound)', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: T1 }),
      );

      const result = await ledgerStore.findVersionAsOf('users', 'u1', T1);

      expect(result).toBeNull();
    });

    it('returns the entry when asOf is exactly at validFrom (inclusive lower bound)', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: T2 }),
      );

      const result = await ledgerStore.findVersionAsOf('users', 'u1', T0);

      expect(result).not.toBeNull();
    });

    it('returns the correct version when multiple versions exist for a record', async () => {
      await ledgerStore.append(
        makeEntry({
          entity: 'users',
          recordId: 'u1',
          validFrom: T0,
          validTo: T1,
          snapshot: { v: 1 },
        }),
      );
      await ledgerStore.append(
        makeEntry({
          entity: 'users',
          recordId: 'u1',
          validFrom: T1,
          validTo: null,
          snapshot: { v: 2 },
        }),
      );

      const atT0 = await ledgerStore.findVersionAsOf('users', 'u1', T0);
      const atT2 = await ledgerStore.findVersionAsOf('users', 'u1', T2);

      expect(atT0?.snapshot).toMatchObject({ v: 1 });
      expect(atT2?.snapshot).toMatchObject({ v: 2 });
    });

    it('returns null for an unknown record', async () => {
      const result = await ledgerStore.findVersionAsOf('users', 'nonexistent', T0);

      expect(result).toBeNull();
    });
  });

  describe('findAllVersionsAsOf', () => {
    it('returns all records live at asOf', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0 }));
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u2', validFrom: T0 }));

      const results = await ledgerStore.findAllVersionsAsOf('users', T1);

      expect(results).toHaveLength(2);
    });

    it('returns at most one entry per recordId', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, validTo: T1 }),
      );
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T1, validTo: null }),
      );

      const results = await ledgerStore.findAllVersionsAsOf('users', T2);

      expect(results).toHaveLength(1);
    });

    it('excludes records not yet created at asOf', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T2 }));

      const results = await ledgerStore.findAllVersionsAsOf('users', T0);

      expect(results).toHaveLength(0);
    });

    it('includes DELETE tombstones — filtering is the callers responsibility', async () => {
      await ledgerStore.append(
        makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0, operation: 'DELETE' }),
      );

      const results = await ledgerStore.findAllVersionsAsOf('users', T1);

      expect(results).toHaveLength(1);
      expect(results[0].operation).toBe('DELETE');
    });

    it('only returns entries for the requested entity', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1', validFrom: T0 }));
      await ledgerStore.append(makeEntry({ entity: 'profiles', recordId: 'p1', validFrom: T0 }));

      const results = await ledgerStore.findAllVersionsAsOf('users', T1);

      expect(results).toHaveLength(1);
      expect(results[0].entity).toBe('users');
    });
  });

  describe('listEntities', () => {
    it('returns all distinct entity names', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1' }));
      await ledgerStore.append(makeEntry({ entity: 'profiles', recordId: 'p1' }));
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u2' }));

      const entities = await ledgerStore.listEntities();

      expect(entities).toHaveLength(2);
      expect(entities).toContain('users');
      expect(entities).toContain('profiles');
    });

    it('returns empty array when the store has no entries', async () => {
      const entities = await ledgerStore.listEntities();

      expect(entities).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1' }));
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u2' }));

      ledgerStore.clear();

      expect(ledgerStore._all).toHaveLength(0);
    });

    it('listEntities returns empty after clear', async () => {
      await ledgerStore.append(makeEntry({ entity: 'users', recordId: 'u1' }));
      ledgerStore.clear();

      const entities = await ledgerStore.listEntities();
      expect(entities).toHaveLength(0);
    });
  });
});
