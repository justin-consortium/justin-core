import { makeCoreManagersSandbox, loggerSpies, resetGlobalLoggerState } from '../../../testing';
import type { CoreManagersSandbox, LoggerSpies } from '../../../testing';
import type { ProtectedAttributesRecord } from '../../types';
import {
  refreshProtectedAttributesCache,
  clearProtectedAttributesCache,
  upsertProtectedAttributesInCache,
  deleteProtectedAttributesByIdFromCache,
  deleteProtectedAttributesByUniqueIdentifierFromCache,
  getAllProtectedAttributesByUniqueIdentifier,
  getProtectedAttributesByUniqueIdentifier,
  __testing__protectedAttributesCache,
} from '../../protected-attributes/cache';

describe('protected attributes cache unit tests', () => {
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

  describe('refreshProtectedAttributesCache', () => {
    it('loads all records from the DB into the cache', async () => {
      const pa = makePA();
      (t.dm as any).getAllInCollection.resolves([pa]);

      await refreshProtectedAttributesCache();

      expect(__testing__protectedAttributesCache._cache.getById('pa1')).not.toBeNull();
    });

    it('replaces existing cache contents', async () => {
      upsertProtectedAttributesInCache(makePA({ id: 'old', uniqueIdentifier: 'alice' }));
      (t.dm as any).getAllInCollection.resolves([makePA({ id: 'new', uniqueIdentifier: 'alice' })]);

      await refreshProtectedAttributesCache();

      expect(__testing__protectedAttributesCache._cache.getById('old')).toBeNull();
      expect(__testing__protectedAttributesCache._cache.getById('new')).not.toBeNull();
    });

    it('clears the _byUniqueIdentifier map before reloading', async () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', uniqueIdentifier: 'alice' }));
      (t.dm as any).getAllInCollection.resolves([]);

      await refreshProtectedAttributesCache();

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(0);
    });

    it('skips malformed records missing id and logs an error', async () => {
      (t.dm as any).getAllInCollection.resolves([
        { uniqueIdentifier: 'alice', namespace: 'health' } as any,
      ]);

      await refreshProtectedAttributesCache();

      expect(__testing__protectedAttributesCache._cache.size()).toBe(0);
      expect(lg.findByMessage('skipping malformed record')).toHaveLength(1);
    });

    it('registers each loaded record in the _byUniqueIdentifier map', async () => {
      (t.dm as any).getAllInCollection.resolves([
        makePA({ id: 'pa1', uniqueIdentifier: 'alice', namespace: 'health' }),
        makePA({ id: 'pa2', uniqueIdentifier: 'alice', namespace: 'fitness' }),
      ]);

      await refreshProtectedAttributesCache();

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(2);
    });
  });

  describe('clearProtectedAttributesCache', () => {
    it('removes all records from the cache', () => {
      upsertProtectedAttributesInCache(makePA());
      clearProtectedAttributesCache();

      expect(__testing__protectedAttributesCache._cache.size()).toBe(0);
    });

    it('clears the _byUniqueIdentifier map', () => {
      upsertProtectedAttributesInCache(makePA());
      clearProtectedAttributesCache();

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(0);
    });

    it('is safe to call on an empty cache', () => {
      expect(() => clearProtectedAttributesCache()).not.toThrow();
    });
  });

  describe('upsertProtectedAttributesInCache', () => {
    it('inserts a new record into the cache', () => {
      upsertProtectedAttributesInCache(makePA());

      expect(__testing__protectedAttributesCache._cache.getById('pa1')).not.toBeNull();
    });

    it('registers the record in the _byUniqueIdentifier map', () => {
      upsertProtectedAttributesInCache(makePA());

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(1);
    });

    it('replaces an existing record with the same id', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', protectedAttributes: { steps: 100 } }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', protectedAttributes: { steps: 999 } }));

      const record = __testing__protectedAttributesCache._cache.getById('pa1');
      expect(record?.protectedAttributes?.steps).toBe(999);
      expect(__testing__protectedAttributesCache._cache.size()).toBe(1);
    });

    it('deregisters the old uniqueIdentifier when a record is replaced with a different one', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', uniqueIdentifier: 'alice' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', uniqueIdentifier: 'bob' }));

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(0);
      expect(getAllProtectedAttributesByUniqueIdentifier('bob')).toHaveLength(1);
    });

    it('supports multiple records for the same uniqueIdentifier', () => {
      upsertProtectedAttributesInCache(
        makePA({ id: 'pa1', uniqueIdentifier: 'alice', namespace: 'health' }),
      );
      upsertProtectedAttributesInCache(
        makePA({ id: 'pa2', uniqueIdentifier: 'alice', namespace: 'fitness' }),
      );

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(2);
    });

    it('skips and logs an error for a record missing id', () => {
      upsertProtectedAttributesInCache({
        uniqueIdentifier: 'alice',
        namespace: 'health',
        protectedAttributes: {},
      } as any);

      expect(__testing__protectedAttributesCache._cache.size()).toBe(0);
      expect(lg.findByMessage('skipping malformed record')).toHaveLength(1);
    });
  });

  describe('deleteProtectedAttributesByIdFromCache', () => {
    it('removes the record from the cache', () => {
      upsertProtectedAttributesInCache(makePA());
      deleteProtectedAttributesByIdFromCache('pa1');

      expect(__testing__protectedAttributesCache._cache.getById('pa1')).toBeNull();
    });

    it('removes the record from the _byUniqueIdentifier map', () => {
      upsertProtectedAttributesInCache(makePA());
      deleteProtectedAttributesByIdFromCache('pa1');

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(0);
    });

    it('removes the uniqueIdentifier entry when last record for that user is deleted', () => {
      upsertProtectedAttributesInCache(makePA());
      deleteProtectedAttributesByIdFromCache('pa1');

      expect(__testing__protectedAttributesCache._byUniqueIdentifier.has('alice')).toBe(false);
    });

    it('does not remove the uniqueIdentifier entry when other records still exist for that user', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa2', namespace: 'fitness' }));
      deleteProtectedAttributesByIdFromCache('pa1');

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(1);
    });

    it('is a no-op for an unknown id', () => {
      expect(() => deleteProtectedAttributesByIdFromCache('nonexistent')).not.toThrow();
    });
  });

  describe('deleteProtectedAttributesByUniqueIdentifierFromCache', () => {
    it('removes all records for the given user', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa2', namespace: 'fitness' }));

      deleteProtectedAttributesByUniqueIdentifierFromCache('alice');

      expect(__testing__protectedAttributesCache._cache.getById('pa1')).toBeNull();
      expect(__testing__protectedAttributesCache._cache.getById('pa2')).toBeNull();
      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(0);
    });

    it('does not affect records for other users', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', uniqueIdentifier: 'alice' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa2', uniqueIdentifier: 'bob' }));

      deleteProtectedAttributesByUniqueIdentifierFromCache('alice');

      expect(getAllProtectedAttributesByUniqueIdentifier('bob')).toHaveLength(1);
    });

    it('is a no-op for a user with no records', () => {
      expect(() => deleteProtectedAttributesByUniqueIdentifierFromCache('nobody')).not.toThrow();
    });
  });

  describe('getAllProtectedAttributesByUniqueIdentifier', () => {
    it('returns all records for the given user', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa2', namespace: 'fitness' }));

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(2);
    });

    it('returns an empty array for a user with no records', () => {
      expect(getAllProtectedAttributesByUniqueIdentifier('nobody')).toHaveLength(0);
    });

    it('does not include records for other users', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', uniqueIdentifier: 'alice' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa2', uniqueIdentifier: 'bob' }));

      expect(getAllProtectedAttributesByUniqueIdentifier('alice')).toHaveLength(1);
    });
  });

  describe('getProtectedAttributesByUniqueIdentifier', () => {
    it('returns only records matching the requested namespaces', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa2', namespace: 'fitness' }));
      upsertProtectedAttributesInCache(makePA({ id: 'pa3', namespace: 'pii' }));

      const result = getProtectedAttributesByUniqueIdentifier('alice', ['health', 'pii']);

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.namespace).sort()).toEqual(['health', 'pii']);
    });

    it('returns an empty array for a user with no records', () => {
      expect(getProtectedAttributesByUniqueIdentifier('nobody', ['health'])).toHaveLength(0);
    });

    it('silently skips namespaces that do not exist', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));

      const result = getProtectedAttributesByUniqueIdentifier('alice', ['health', 'nonexistent']);

      expect(result).toHaveLength(1);
    });

    it('filters out empty string namespaces', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1', namespace: 'health' }));

      const result = getProtectedAttributesByUniqueIdentifier('alice', ['health', '']);

      expect(result).toHaveLength(1);
    });
  });
});
