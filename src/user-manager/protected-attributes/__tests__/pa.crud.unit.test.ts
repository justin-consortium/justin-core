import {
  makeCoreManagersSandbox,
  loggerSpies,
  resetGlobalLoggerState,
  expectOk,
  expectFailedWithCode,
} from '../../../testing';
import type { CoreManagersSandbox, LoggerSpies } from '../../../testing';
import { JustinErrorCode } from '../../../errors';
import type { ProtectedAttributesRecord } from '../../types';
import {
  clearProtectedAttributesCache,
  upsertProtectedAttributesInCache,
} from '../../protected-attributes/cache';
import {
  getProtectedAttributesByUniqueIdentifier,
  getAllProtectedAttributesByUniqueIdentifier,
  setProtectedAttributesByUniqueIdentifier,
  updateProtectedAttributeByUniqueIdentifier,
  updateProtectedAttributesByUniqueIdentifier,
  deleteProtectedAttributesByUniqueIdentifier,
  deleteAllProtectedAttributesByUniqueIdentifier,
  deleteProtectedAttributeByUniqueIdentifier,
  deleteProtectedAttributesFromNamespaceByUniqueIdentifier,
} from '../../protected-attributes/crud';

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

  function stubRemoveItem(count = 1) {
    (t.dm as any).removeItemFromCollection.resolves({
      ok: true,
      successes: Array(count).fill({ id: 'pa1' }),
    });
  }

  function stubRemoveItems(count = 1) {
    (t.dm as any).removeItemsFromCollection.resolves({
      ok: true,
      successes: Array(count).fill({ id: 'pa1' }),
    });
  }

  describe('getProtectedAttributesByUniqueIdentifier', () => {
    it('returns matching cached records for the given namespaces', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa2', namespace: 'fitness' }));

      const result = getProtectedAttributesByUniqueIdentifier('alice', ['health']);

      expect(result).toHaveLength(1);
      expect(result[0].namespace).toBe('health');
    });

    it('returns empty array for unknown uniqueIdentifier', () => {
      expect(getProtectedAttributesByUniqueIdentifier('nobody', ['health'])).toHaveLength(0);
    });

    it('returns empty array for empty namespaces array', () => {
      upsertProtectedAttributesInCache(makePA());
      expect(getProtectedAttributesByUniqueIdentifier('alice', [])).toHaveLength(0);
    });

    it('returns empty array for empty uniqueIdentifier', () => {
      expect(getProtectedAttributesByUniqueIdentifier('', ['health'])).toHaveLength(0);
    });
  });

  describe('getAllProtectedAttributesByUniqueIdentifier', () => {
    it('returns all cached records for the given user', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa2', namespace: 'fitness' }));

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(2);
    });

    it('returns empty array for unknown uniqueIdentifier', () => {
      expect(getAllProtectedAttributesByUniqueIdentifier('nobody')).toHaveLength(0);
    });

    it('returns empty array for empty uniqueIdentifier', () => {
      expect(getAllProtectedAttributesByUniqueIdentifier('')).toHaveLength(0);
    });
  });

  describe('setProtectedAttributesByUniqueIdentifier', () => {
    it('creates a new record when none exists for the namespace', async () => {
      const created = makePA();
      stubFindItems(null);
      stubAddItem(created);

      const result = await setProtectedAttributesByUniqueIdentifier('alice', {
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

      const result = await setProtectedAttributesByUniqueIdentifier('alice', {
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

      const result = await setProtectedAttributesByUniqueIdentifier('alice', [
        { namespace: 'health', protectedAttributes: { steps: 1000 } },
        { namespace: 'fitness', protectedAttributes: { calories: 500 } },
      ]);

      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(2);
    });

    it('returns ok:true with empty successes for empty input', async () => {
      const result = await setProtectedAttributesByUniqueIdentifier('alice', []);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });

    it('returns VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await setProtectedAttributesByUniqueIdentifier('', {
          namespace: 'health',
          protectedAttributes: {},
        }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR for empty namespace', async () => {
      const result = await setProtectedAttributesByUniqueIdentifier('alice', {
        namespace: '',
        protectedAttributes: {},
      });
      expectFailedWithCode(result, JustinErrorCode.VALIDATION_ERROR);
    });

    it('returns VALIDATION_ERROR when protectedAttributes is not a plain object', async () => {
      const result = await setProtectedAttributesByUniqueIdentifier('alice', {
        namespace: 'health',
        protectedAttributes: null as any,
      });
      expectFailedWithCode(result, JustinErrorCode.VALIDATION_ERROR);
    });

    it('returns VALIDATION_ERROR when protectedAttributes contains reserved key', async () => {
      const result = await setProtectedAttributesByUniqueIdentifier('alice', {
        namespace: 'health',
        protectedAttributes: { id: 'hack' },
      });
      expectFailedWithCode(result, JustinErrorCode.VALIDATION_ERROR);
    });

    it('returns partial successes when some namespaces fail', async () => {
      const health = makePA({ id: 'pa1', namespace: 'health' });
      stubFindItems(null);
      (t.dm as any).addItemToCollection.resolves({ ok: true, successes: [health] });

      const result = await setProtectedAttributesByUniqueIdentifier('alice', [
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

      await setProtectedAttributesByUniqueIdentifier('alice', {
        namespace: 'health',
        protectedAttributes: { steps: 1000 },
      });

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(1);
    });
  });

  describe('updateProtectedAttributeByUniqueIdentifier', () => {
    it('returns ok:true with the updated record', async () => {
      const existing = makePA({ protectedAttributes: { steps: 100 } });
      const updated = makePA({ protectedAttributes: { steps: 999 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await updateProtectedAttributeByUniqueIdentifier(
        'alice',
        'health',
        'steps',
        999,
      );

      expectOk(result);
      expect(result.successes[0].protectedAttributes.steps).toBe(999);
    });

    it('supports dot-notation key paths', async () => {
      const existing = makePA({ protectedAttributes: { daily: { steps: 0 } } });
      const updated = makePA({ protectedAttributes: { daily: { steps: 500 } } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await updateProtectedAttributeByUniqueIdentifier(
        'alice',
        'health',
        'daily.steps',
        500,
      );

      expectOk(result);
    });

    it('returns VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await updateProtectedAttributeByUniqueIdentifier('', 'health', 'steps', 1),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR for empty namespace', async () => {
      expectFailedWithCode(
        await updateProtectedAttributeByUniqueIdentifier('alice', '', 'steps', 1),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR for a reserved keyPath', async () => {
      expectFailedWithCode(
        await updateProtectedAttributeByUniqueIdentifier('alice', 'health', 'id', 'hack'),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns NOT_FOUND when no record exists for the namespace', async () => {
      stubFindItems(null);

      expectFailedWithCode(
        await updateProtectedAttributeByUniqueIdentifier('alice', 'health', 'steps', 1),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('upserts the updated record into cache', async () => {
      const existing = makePA({ protectedAttributes: { steps: 0 } });
      const updated = makePA({ protectedAttributes: { steps: 42 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      await updateProtectedAttributeByUniqueIdentifier('alice', 'health', 'steps', 42);

      expect(
        getAllProtectedAttributesByUniqueIdentifier('alice')[0].protectedAttributes.steps,
      ).toBe(42);
    });
  });

  describe('updateProtectedAttributesByUniqueIdentifier', () => {
    it('returns ok:true updating multiple key paths', async () => {
      const existing = makePA({ protectedAttributes: { a: 1, b: 2 } });
      const updated = makePA({ protectedAttributes: { a: 10, b: 20 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await updateProtectedAttributesByUniqueIdentifier('alice', 'health', {
        a: 10,
        b: 20,
      });

      expectOk(result);
    });

    it('returns VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await updateProtectedAttributesByUniqueIdentifier('', 'health', { a: 1 }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR for empty namespace', async () => {
      expectFailedWithCode(
        await updateProtectedAttributesByUniqueIdentifier('alice', '', { a: 1 }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR when updates is not a plain object', async () => {
      expectFailedWithCode(
        await updateProtectedAttributesByUniqueIdentifier('alice', 'health', null as any),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns NOT_FOUND when no record exists for the namespace', async () => {
      stubFindItems(null);

      expectFailedWithCode(
        await updateProtectedAttributesByUniqueIdentifier('alice', 'health', { a: 1 }),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('skips reserved keyPaths and returns partial failures', async () => {
      const existing = makePA({ protectedAttributes: { safe: 0 } });
      const updated = makePA({ protectedAttributes: { safe: 99 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await updateProtectedAttributesByUniqueIdentifier('alice', 'health', {
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
  });

  describe('deleteProtectedAttributesByUniqueIdentifier', () => {
    it('returns ok:true when the namespace record is found and deleted', async () => {
      const existing = makePA();
      stubFindItems(existing);
      stubRemoveItems();

      const result = await deleteProtectedAttributesByUniqueIdentifier('alice', 'health');

      expectOk(result);
    });

    it('returns NOT_FOUND when no records match the namespaces', async () => {
      stubFindItems(null);

      expectFailedWithCode(
        await deleteProtectedAttributesByUniqueIdentifier('alice', 'health'),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('returns VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await deleteProtectedAttributesByUniqueIdentifier('', 'health'),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('accepts an array of namespaces', async () => {
      stubFindItems(makePA());
      (t.dm as any).findItemsInCollection
        .onFirstCall()
        .resolves([makePA({ id: 'pa1', namespace: 'health' })])
        .onSecondCall()
        .resolves([makePA({ id: 'pa2', namespace: 'fitness' })]);
      stubRemoveItems(2);

      const result = await deleteProtectedAttributesByUniqueIdentifier('alice', [
        'health',
        'fitness',
      ]);

      expectOk(result);
    });

    it('clears and reloads cache after deletion', async () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));
      stubFindItems(makePA());
      (t.dm as any).removeItemsFromCollection.resolves({ ok: true, successes: [{ id: 'pa1' }] });
      (t.dm as any).findItemsInCollection
        .onFirstCall()
        .resolves([makePA()])
        .onSecondCall()
        .resolves([]);

      await deleteProtectedAttributesByUniqueIdentifier('alice', 'health');

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(0);
    });
  });

  describe('deleteAllProtectedAttributesByUniqueIdentifier', () => {
    it('deletes all records for the user', async () => {
      (t.dm as any).findItemsInCollection.resolves([
        makePA({ id: 'pa1', namespace: 'health' }),
        makePA({ id: 'pa2', namespace: 'fitness' }),
      ]);
      stubRemoveItems(2);

      await deleteAllProtectedAttributesByUniqueIdentifier('alice');

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(0);
    });

    it('is a no-op for a user with no records', async () => {
      (t.dm as any).findItemsInCollection.resolves([]);

      await expect(deleteAllProtectedAttributesByUniqueIdentifier('alice')).resolves.not.toThrow();
    });

    it('returns early for an empty uniqueIdentifier without hitting the DB', async () => {
      await deleteAllProtectedAttributesByUniqueIdentifier('');

      expect((t.dm as any).findItemsInCollection.called).toBe(false);
    });
  });

  describe('deleteProtectedAttributeByUniqueIdentifier', () => {
    it('returns ok:true after deleting a top-level key', async () => {
      const existing = makePA({ protectedAttributes: { steps: 100, weight: 70 } });
      const updated = makePA({ protectedAttributes: { weight: 70 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await deleteProtectedAttributeByUniqueIdentifier('alice', 'health', 'steps');

      expectOk(result);
      expect(result.successes[0].protectedAttributes).not.toHaveProperty('steps');
    });

    it('supports dot-notation key paths', async () => {
      const existing = makePA({ protectedAttributes: { daily: { steps: 100, calories: 200 } } });
      const updated = makePA({ protectedAttributes: { daily: { calories: 200 } } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await deleteProtectedAttributeByUniqueIdentifier(
        'alice',
        'health',
        'daily.steps',
      );

      expectOk(result);
    });

    it('returns VALIDATION_ERROR for a reserved keyPath', async () => {
      expectFailedWithCode(
        await deleteProtectedAttributeByUniqueIdentifier('alice', 'health', 'id'),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns NOT_FOUND when no record exists for the namespace', async () => {
      stubFindItems(null);

      expectFailedWithCode(
        await deleteProtectedAttributeByUniqueIdentifier('alice', 'health', 'steps'),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('returns VALIDATION_ERROR for empty namespace', async () => {
      expectFailedWithCode(
        await deleteProtectedAttributeByUniqueIdentifier('alice', '', 'steps'),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });
  });

  describe('deleteProtectedAttributesFromNamespaceByUniqueIdentifier', () => {
    it('returns ok:true after deleting multiple key paths', async () => {
      const existing = makePA({ protectedAttributes: { a: 1, b: 2, c: 3 } });
      const updated = makePA({ protectedAttributes: { c: 3 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await deleteProtectedAttributesFromNamespaceByUniqueIdentifier(
        'alice',
        'health',
        ['a', 'b'],
      );

      expectOk(result);
      expect(result.successes[0].protectedAttributes).not.toHaveProperty('a');
      expect(result.successes[0].protectedAttributes).not.toHaveProperty('b');
      expect(result.successes[0].protectedAttributes.c).toBe(3);
    });

    it('accepts a single string path', async () => {
      const existing = makePA({ protectedAttributes: { x: 1, y: 2 } });
      const updated = makePA({ protectedAttributes: { y: 2 } });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await deleteProtectedAttributesFromNamespaceByUniqueIdentifier(
        'alice',
        'health',
        'x',
      );

      expectOk(result);
    });

    it('returns VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await deleteProtectedAttributesFromNamespaceByUniqueIdentifier('', 'health', ['x']),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns VALIDATION_ERROR for empty namespace', async () => {
      expectFailedWithCode(
        await deleteProtectedAttributesFromNamespaceByUniqueIdentifier('alice', '', ['x']),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });

    it('returns NOT_FOUND when no record exists', async () => {
      stubFindItems(null);

      expectFailedWithCode(
        await deleteProtectedAttributesFromNamespaceByUniqueIdentifier('alice', 'health', ['x']),
        JustinErrorCode.NOT_FOUND,
      );
    });

    it('skips reserved keyPaths and returns partial failures', async () => {
      const existing = makePA({ protectedAttributes: { safe: 1 } });
      const updated = makePA({ protectedAttributes: {} });
      stubFindItems(existing);
      stubUpdateItem(updated);

      const result = await deleteProtectedAttributesFromNamespaceByUniqueIdentifier(
        'alice',
        'health',
        ['id', 'safe'],
      );

      expect(result.ok).toBe(false);
      expect(result.successes).toHaveLength(1);
      if (!result.ok) {
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe(JustinErrorCode.VALIDATION_ERROR);
      }
    });
  });
});
