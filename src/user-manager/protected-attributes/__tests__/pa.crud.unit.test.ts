import {
  makeCoreManagersSandbox,
  loggerSpies,
  resetGlobalLoggerState,
  expectOk,
  expectFailed,
  expectFailedWithCode,
} from '../../../testing';
import type { CoreManagersSandbox, LoggerSpies } from '../../../testing';
import { JustinErrorCode } from '../../../errors';
import type { ProtectedAttributesRecord } from '../../types';
import { clearProtectedAttributesCache, upsertProtectedAttributesInCache } from '../cache';
import {
  getProtectedAttributes,
  getAllProtectedAttributes,
  setProtectedAttributes,
  setProtectedAttributeKeysByNamespace,
  deleteProtectedAttributeNamespaces,
  deleteAllProtectedAttributes,
  deleteProtectedAttributeKeysByNamespace,
} from '../crud';

describe('protected attributes crud unit tests', () => {
  let t: CoreManagersSandbox;
  let lg: LoggerSpies;

  beforeEach(() => {
    t?.restore();
    lg?.restore();
    t = makeCoreManagersSandbox();
    lg = loggerSpies();
    clearProtectedAttributesCache();
  });

  afterEach(() => {
    t?.restore();
    lg?.restore();
    resetGlobalLoggerState();
    clearProtectedAttributesCache();
  });

  function makePA(overrides: Partial<ProtectedAttributesRecord> = {}): ProtectedAttributesRecord {
    return {
      id: overrides.id ?? 'pa1',
      uniqueIdentifier: overrides.uniqueIdentifier ?? 'alice',
      namespace: overrides.namespace ?? 'health',
      protectedAttributes: overrides.protectedAttributes ?? { steps: 1000 },
    };
  }

  function stubFindItems(result: ProtectedAttributesRecord | null) {
    (t.dm as any).findItemsInCollection.resolves(result ? [result] : []);
  }

  function stubAddItem(result: ProtectedAttributesRecord) {
    (t.dm as any).addItemToCollection.resolves({ ok: true, successes: [result] });
  }

  function stubUpdateItem(result: ProtectedAttributesRecord) {
    (t.dm as any).updateItemByIdInCollection.resolves({ ok: true, successes: [result] });
  }

  function stubRemoveItems(count = 1) {
    (t.dm as any).removeItemsFromCollection.resolves({
      ok: true,
      successes: Array(count).fill({ id: 'pa1' }),
    });
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  describe('getProtectedAttributes', () => {
    it('returns matching cached records for the given namespaces', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa2', namespace: 'fitness' }));

      const result = getProtectedAttributes('alice', ['health']);

      expect(result).toHaveLength(1);
      expect(result[0].namespace).toBe('health');
    });

    it('returns empty array for unknown uniqueIdentifier', () => {
      expect(getProtectedAttributes('nobody', ['health'])).toHaveLength(0);
    });

    it('returns empty array for empty namespaces array', () => {
      upsertProtectedAttributesInCache(makePA());
      expect(getProtectedAttributes('alice', [])).toHaveLength(0);
    });

    it('returns empty array for empty uniqueIdentifier', () => {
      expect(getProtectedAttributes('', ['health'])).toHaveLength(0);
    });
  });

  describe('getAllProtectedAttributes', () => {
    it('returns all cached records for the given user', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa2', namespace: 'fitness' }));

      expect(getAllProtectedAttributes('alice')).toHaveLength(2);
    });

    it('returns empty array for unknown uniqueIdentifier', () => {
      expect(getAllProtectedAttributes('nobody')).toHaveLength(0);
    });

    it('returns empty array for empty uniqueIdentifier', () => {
      expect(getAllProtectedAttributes('')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Upsert
  // ---------------------------------------------------------------------------

  describe('setProtectedAttributes', () => {
    it('creates a new record when none exists for the namespace', async () => {
      const created = makePA();
      stubFindItems(null);
      stubAddItem(created);

      const result = await setProtectedAttributes('alice', {
        namespace: 'health',
        protectedAttributes: { steps: 1000 },
      });

      expectOk(result);
      expect(result.successes[0].namespace).toBe('health');
    });

    it('shallow-merges into an existing record', async () => {
      const existing = makePA({ protectedAttributes: { steps: 100, weight: 70 } });
      const updated = makePA({ protectedAttributes: { steps: 200, weight: 70 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await setProtectedAttributes('alice', {
        namespace: 'health',
        protectedAttributes: { steps: 200 },
      });

      expectOk(result);
      expect(result.successes[0].protectedAttributes.steps).toBe(200);
      expect(result.successes[0].protectedAttributes.weight).toBe(70);
    });

    it('accepts an array of namespaced attributes', async () => {
      const health = makePA({ id: 'pa1', namespace: 'health' });
      const fitness = makePA({ id: 'pa2', namespace: 'fitness' });
      stubFindItems(null);
      (t.dm as any).addItemToCollection
        .onFirstCall()
        .resolves({ ok: true, successes: [health] })
        .onSecondCall()
        .resolves({ ok: true, successes: [fitness] });

      const result = await setProtectedAttributes('alice', [
        { namespace: 'health', protectedAttributes: { steps: 1000 } },
        { namespace: 'fitness', protectedAttributes: { calories: 500 } },
      ]);

      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(2);
    });

    it('returns ok:true with empty successes for empty input', async () => {
      const result = await setProtectedAttributes('alice', []);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });

    it('returns VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await setProtectedAttributes('', { namespace: 'health', protectedAttributes: {} }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR for empty namespace', async () => {
      expectFailedWithCode(
        await setProtectedAttributes('alice', { namespace: '', protectedAttributes: {} }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR when protectedAttributes is not a plain object', async () => {
      expectFailedWithCode(
        await setProtectedAttributes('alice', {
          namespace: 'health',
          protectedAttributes: null as any,
        }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR when protectedAttributes contains reserved key', async () => {
      expectFailedWithCode(
        await setProtectedAttributes('alice', {
          namespace: 'health',
          protectedAttributes: { id: 'hack' },
        }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns partial successes when some namespaces fail', async () => {
      const health = makePA({ id: 'pa1', namespace: 'health' });
      stubFindItems(null);
      (t.dm as any).addItemToCollection.resolves({ ok: true, successes: [health] });

      const result = await setProtectedAttributes('alice', [
        { namespace: 'health', protectedAttributes: {} },
        { namespace: '', protectedAttributes: {} },
      ]);

      expect(result.ok).toBe(false);
      expect(result.successes).toHaveLength(1);
      if (!result.ok) expect(result.failures).toHaveLength(1);
    });

    it('upserts the record into cache on success', async () => {
      const created = makePA();
      stubFindItems(null);
      stubAddItem(created);

      await setProtectedAttributes('alice', {
        namespace: 'health',
        protectedAttributes: { steps: 1000 },
      });

      expect(getAllProtectedAttributes('alice')).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Key-level patch
  // ---------------------------------------------------------------------------

  describe('setProtectedAttributeKeysByNamespace', () => {
    it('returns ok:true updating a single key', async () => {
      const existing = makePA({ protectedAttributes: { steps: 100 } });
      const updated = makePA({ protectedAttributes: { steps: 999 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await setProtectedAttributeKeysByNamespace('alice', 'health', { steps: 999 });

      expectOk(result);
      expect(result.successes[0].protectedAttributes.steps).toBe(999);
    });

    it('returns ok:true updating multiple keys', async () => {
      const existing = makePA({ protectedAttributes: { a: 1, b: 2 } });
      const updated = makePA({ protectedAttributes: { a: 10, b: 20 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await setProtectedAttributeKeysByNamespace('alice', 'health', {
        a: 10,
        b: 20,
      });

      expectOk(result);
    });

    it('supports dot-notation key paths', async () => {
      const existing = makePA({ protectedAttributes: { daily: { steps: 0 } } });
      const updated = makePA({ protectedAttributes: { daily: { steps: 500 } } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await setProtectedAttributeKeysByNamespace('alice', 'health', {
        'daily.steps': 500,
      });

      expectOk(result);
    });

    it('returns VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await setProtectedAttributeKeysByNamespace('', 'health', { steps: 1 }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR for empty namespace', async () => {
      expectFailedWithCode(
        await setProtectedAttributeKeysByNamespace('alice', '', { steps: 1 }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR when updates is not a plain object', async () => {
      expectFailedWithCode(
        await setProtectedAttributeKeysByNamespace('alice', 'health', null as any),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('creates the namespace when it does not exist', async () => {
      stubFindItems(null);
      stubAddItem(makePA({ protectedAttributes: { steps: 1 } }));

      const result = await setProtectedAttributeKeysByNamespace('alice', 'health', { steps: 1 });

      expectOk(result);
      expect(result.successes[0].protectedAttributes.steps).toBe(1);
    });

    it('skips reserved keyPaths and propagates partial failures with valid successes', async () => {
      const existing = makePA({ protectedAttributes: { safe: 0 } });
      const updated = makePA({ protectedAttributes: { safe: 99 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await setProtectedAttributeKeysByNamespace('alice', 'health', {
        id: 'hack',
        safe: 99,
      });

      expect(result.ok).toBe(false);
      expect(result.successes).toHaveLength(1);
      if (!result.ok) {
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe(JustinErrorCode.VALIDATION_ERROR);
      }
    });

    it('upserts the updated record into cache', async () => {
      const existing = makePA({ protectedAttributes: { steps: 0 } });
      const updated = makePA({ protectedAttributes: { steps: 42 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      await setProtectedAttributeKeysByNamespace('alice', 'health', { steps: 42 });

      expect(getAllProtectedAttributes('alice')[0].protectedAttributes.steps).toBe(42);
    });
  });

  // ---------------------------------------------------------------------------
  // Namespace-level delete
  // ---------------------------------------------------------------------------

  describe('deleteProtectedAttributeNamespaces', () => {
    it('returns ok:true when the namespace record is found and deleted', async () => {
      stubFindItems(makePA());
      stubRemoveItems();

      const result = await deleteProtectedAttributeNamespaces('alice', 'health');

      expectOk(result);
    });

    it('returns NOT_FOUND when no records match the namespaces', async () => {
      stubFindItems(null);

      expectFailedWithCode(
        await deleteProtectedAttributeNamespaces('alice', 'health'),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('returns VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await deleteProtectedAttributeNamespaces('', 'health'),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('accepts an array of namespaces', async () => {
      (t.dm as any).findItemsInCollection
        .onFirstCall()
        .resolves([makePA({ id: 'pa1', namespace: 'health' })])
        .onSecondCall()
        .resolves([makePA({ id: 'pa2', namespace: 'fitness' })]);
      stubRemoveItems(2);

      const result = await deleteProtectedAttributeNamespaces('alice', ['health', 'fitness']);

      expectOk(result);
    });

    it('clears and reloads cache after deletion', async () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));
      (t.dm as any).removeItemsFromCollection.resolves({ ok: true, successes: [{ id: 'pa1' }] });
      (t.dm as any).findItemsInCollection
        .onFirstCall()
        .resolves([makePA()])
        .onSecondCall()
        .resolves([]);

      await deleteProtectedAttributeNamespaces('alice', 'health');

      expect(getAllProtectedAttributes('alice')).toHaveLength(0);
    });
  });

  describe('deleteAllProtectedAttributes', () => {
    it('returns ok:true and clears all records for the user', async () => {
      (t.dm as any).findItemsInCollection.resolves([
        makePA({ id: 'pa1', namespace: 'health' }),
        makePA({ id: 'pa2', namespace: 'fitness' }),
      ]);
      stubRemoveItems(2);

      const result = await deleteAllProtectedAttributes('alice');

      expectOk(result);
      expect(getAllProtectedAttributes('alice')).toHaveLength(0);
    });

    it('returns ok:true when the user has no records', async () => {
      (t.dm as any).findItemsInCollection.resolves([]);

      const result = await deleteAllProtectedAttributes('alice');

      expectOk(result);
    });

    it('returns VALIDATION_ERROR for an empty uniqueIdentifier without hitting the DB', async () => {
      const result = await deleteAllProtectedAttributes('');

      expectFailedWithCode(result, JustinErrorCode.VALIDATION_ERROR);
      expect((t.dm as any).findItemsInCollection.called).toBe(false);
    });

    it('returns ok:false when the DB removal fails', async () => {
      (t.dm as any).findItemsInCollection.resolves([makePA({ id: 'pa1' })]);
      (t.dm as any).removeItemsFromCollection.resolves({
        ok: false,
        successes: [],
        failures: [{ code: JustinErrorCode.DB_ERROR, reason: 'write failed' }],
      });

      const result = await deleteAllProtectedAttributes('alice');

      expectFailed(result);
    });
  });

  // ---------------------------------------------------------------------------
  // Key-level delete
  // ---------------------------------------------------------------------------

  describe('deleteProtectedAttributeKeysByNamespace', () => {
    it('returns ok:true after deleting a single key', async () => {
      const existing = makePA({ protectedAttributes: { steps: 100, weight: 70 } });
      const updated = makePA({ protectedAttributes: { weight: 70 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await deleteProtectedAttributeKeysByNamespace('alice', 'health', 'steps');

      expectOk(result);
      expect(result.successes[0].protectedAttributes).not.toHaveProperty('steps');
    });

    it('returns ok:true after deleting multiple key paths', async () => {
      const existing = makePA({ protectedAttributes: { a: 1, b: 2, c: 3 } });
      const updated = makePA({ protectedAttributes: { c: 3 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await deleteProtectedAttributeKeysByNamespace('alice', 'health', ['a', 'b']);

      expectOk(result);
      expect(result.successes[0].protectedAttributes).not.toHaveProperty('a');
      expect(result.successes[0].protectedAttributes).not.toHaveProperty('b');
      expect(result.successes[0].protectedAttributes.c).toBe(3);
    });

    it('supports dot-notation key paths', async () => {
      const existing = makePA({ protectedAttributes: { daily: { steps: 100, calories: 200 } } });
      const updated = makePA({ protectedAttributes: { daily: { calories: 200 } } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await deleteProtectedAttributeKeysByNamespace(
        'alice',
        'health',
        'daily.steps',
      );

      expectOk(result);
    });

    it('returns VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await deleteProtectedAttributeKeysByNamespace('', 'health', ['x']),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR for empty namespace', async () => {
      expectFailedWithCode(
        await deleteProtectedAttributeKeysByNamespace('alice', '', ['x']),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR for a reserved keyPath', async () => {
      stubFindItems(makePA());
      stubUpdateItem(makePA());
      expectFailedWithCode(
        await deleteProtectedAttributeKeysByNamespace('alice', 'health', 'id'),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns NOT_FOUND when no record exists for the namespace', async () => {
      stubFindItems(null);

      expectFailedWithCode(
        await deleteProtectedAttributeKeysByNamespace('alice', 'health', ['x']),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('skips skips reserved keyPaths and returns partial failures', async () => {
      const existing = makePA({ protectedAttributes: { safe: 1 } });
      const updated = makePA({ protectedAttributes: {} });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await deleteProtectedAttributeKeysByNamespace('alice', 'health', [
        'id',
        'safe',
      ]);

      expect(result.ok).toBe(false);
      expect(result.successes).toHaveLength(1);
      if (!result.ok) {
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe(JustinErrorCode.VALIDATION_ERROR);
      }
    });
  });
});
