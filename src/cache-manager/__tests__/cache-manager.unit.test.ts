import { createCacheManager } from '../cache-manager';

describe('CacheManager unit tests', () => {
  /**
   * CacheManager unit tests
   *
   * CacheManager is a pure in-memory data structure with no external
   * dependencies. Every case here runs synchronously and exercises the
   * contract that managers across core rely on: O(1) lookups, consistent
   * index state after every mutation, and safe handling of bad inputs.
   */

  type TestRecord = {
    id: string;
    slug: string;
    category?: string;
  };

  /** Convenience factory for test records. */
  function makeRecord(id: string, slug: string, category?: string): TestRecord {
    return { id, slug, ...(category ? { category } : {}) };
  }


  describe('createCacheManager', () => {
    it('starts empty', () => {
      const cache = createCacheManager<TestRecord>();

      expect(cache.size()).toBe(0);
      expect(cache.getAll()).toEqual([]);
    });

    it('returns the same instance from addIndex for chaining', () => {
      const cache = createCacheManager<TestRecord>();
      const returned = cache.addIndex('slug');

      expect(returned).toBe(cache);
    });

    it('supports chaining multiple addIndex calls', () => {
      const cache = createCacheManager<TestRecord>()
        .addIndex('slug')
        .addIndex('category');

      cache.upsert(makeRecord('1', 'alpha', 'gif'));

      expect(cache.getByIndex('slug', 'alpha')).not.toBeNull();
      expect(cache.getByIndex('category', 'gif')).not.toBeNull();
    });
  });


  describe('upsert', () => {
    it('stores a record retrievable by id', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'my-slug'));

      expect(cache.getById('abc')).toMatchObject({ id: 'abc', slug: 'my-slug' });
    });

    it('stores a record retrievable by indexed field', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'my-slug'));

      expect(cache.getByIndex('slug', 'my-slug')).toMatchObject({ id: 'abc' });
    });

    it('increments size after each insert', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('1', 'a'));
      cache.upsert(makeRecord('2', 'b'));

      expect(cache.size()).toBe(2);
    });

    it('replaces an existing record with the same id', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'old-slug'));
      cache.upsert(makeRecord('abc', 'new-slug'));

      expect(cache.getById('abc')?.slug).toBe('new-slug');
      expect(cache.size()).toBe(1);
    });

    it('removes the old index entry when a record is updated with a changed slug', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'old-slug'));
      cache.upsert(makeRecord('abc', 'new-slug'));

      expect(cache.getByIndex('slug', 'old-slug')).toBeNull();
      expect(cache.getByIndex('slug', 'new-slug')).not.toBeNull();
    });

    it('does nothing for a record with a missing id', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert({ id: '', slug: 'orphan' });

      expect(cache.size()).toBe(0);
    });

    it('does nothing for a null record', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(null as any);

      expect(cache.size()).toBe(0);
    });
  });


  describe('getById', () => {
    it('returns the record for a known id', () => {
      const cache = createCacheManager<TestRecord>();
      cache.upsert(makeRecord('abc', 'slug'));

      expect(cache.getById('abc')).toMatchObject({ id: 'abc' });
    });

    it('returns null for an unknown id', () => {
      const cache = createCacheManager<TestRecord>();

      expect(cache.getById('nonexistent')).toBeNull();
    });

    it('returns null for an empty string id', () => {
      const cache = createCacheManager<TestRecord>();

      expect(cache.getById('')).toBeNull();
    });
  });


  describe('getByIndex', () => {
    it('returns the record for a known indexed value', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'my-slug'));

      const result = cache.getByIndex('slug', 'my-slug');
      expect(result).toMatchObject({ id: 'abc', slug: 'my-slug' });
    });

    it('returns null for an unknown indexed value', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'my-slug'));

      expect(cache.getByIndex('slug', 'nonexistent')).toBeNull();
    });

    it('returns null when the field was not registered as an index', () => {
      const cache = createCacheManager<TestRecord>();
      cache.upsert(makeRecord('abc', 'my-slug'));

      expect(cache.getByIndex('slug', 'my-slug')).toBeNull();
    });

    it('returns null for an empty string value', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'my-slug'));

      expect(cache.getByIndex('slug', '')).toBeNull();
    });
  });


  describe('delete', () => {
    it('returns the deleted record', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'my-slug'));

      const deleted = cache.delete('abc');
      expect(deleted).toMatchObject({ id: 'abc', slug: 'my-slug' });
    });

    it('removes the record from the primary store', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'my-slug'));
      cache.delete('abc');

      expect(cache.getById('abc')).toBeNull();
    });

    it('removes the record from all indexes', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'my-slug'));
      cache.delete('abc');

      expect(cache.getByIndex('slug', 'my-slug')).toBeNull();
    });

    it('decrements size', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'my-slug'));
      cache.delete('abc');

      expect(cache.size()).toBe(0);
    });

    it('returns null for an unknown id', () => {
      const cache = createCacheManager<TestRecord>();

      expect(cache.delete('nonexistent')).toBeNull();
    });

    it('only removes the target record — siblings are unaffected', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('1', 'alpha'));
      cache.upsert(makeRecord('2', 'beta'));
      cache.delete('1');

      expect(cache.getById('2')).not.toBeNull();
      expect(cache.getByIndex('slug', 'beta')).not.toBeNull();
    });
  });


  describe('refresh', () => {
    it('loads all provided records into the cache', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.refresh([makeRecord('1', 'a'), makeRecord('2', 'b'), makeRecord('3', 'c')]);

      expect(cache.size()).toBe(3);
    });

    it('all loaded records are retrievable by id', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.refresh([makeRecord('1', 'alpha'), makeRecord('2', 'beta')]);

      expect(cache.getById('1')).not.toBeNull();
      expect(cache.getById('2')).not.toBeNull();
    });

    it('all loaded records are retrievable via index', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.refresh([makeRecord('1', 'alpha'), makeRecord('2', 'beta')]);

      expect(cache.getByIndex('slug', 'alpha')).not.toBeNull();
      expect(cache.getByIndex('slug', 'beta')).not.toBeNull();
    });

    it('wipes existing records before loading', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('old', 'old-slug'));
      cache.refresh([makeRecord('new', 'new-slug')]);

      expect(cache.getById('old')).toBeNull();
      expect(cache.getByIndex('slug', 'old-slug')).toBeNull();
      expect(cache.size()).toBe(1);
    });

    it('clears the cache when called with an empty array', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('abc', 'slug'));
      cache.refresh([]);

      expect(cache.size()).toBe(0);
    });

    it('skips records with missing ids and does not crash', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.refresh([
        makeRecord('valid', 'good'),
        { id: '', slug: 'bad' },
      ]);

      expect(cache.size()).toBe(1);
      expect(cache.getById('valid')).not.toBeNull();
    });
  });


  describe('clear', () => {
    it('removes all records', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('1', 'a'));
      cache.upsert(makeRecord('2', 'b'));
      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.getAll()).toEqual([]);
    });

    it('removes all index entries', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('1', 'alpha'));
      cache.clear();

      expect(cache.getByIndex('slug', 'alpha')).toBeNull();
    });

    it('is safe to call on an already-empty cache', () => {
      const cache = createCacheManager<TestRecord>();

      expect(() => cache.clear()).not.toThrow();
      expect(cache.size()).toBe(0);
    });

    it('the cache is functional after being cleared', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('1', 'a'));
      cache.clear();
      cache.upsert(makeRecord('2', 'b'));

      expect(cache.size()).toBe(1);
      expect(cache.getById('2')).not.toBeNull();
    });
  });


  describe('getAll', () => {
    it('returns all records as an array', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('1', 'a'));
      cache.upsert(makeRecord('2', 'b'));

      const all = cache.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.id).sort()).toEqual(['1', '2']);
    });

    it('returns an empty array when the cache is empty', () => {
      const cache = createCacheManager<TestRecord>();

      expect(cache.getAll()).toEqual([]);
    });
  });


  describe('size', () => {
    it('returns 0 for a new cache', () => {
      expect(createCacheManager<TestRecord>().size()).toBe(0);
    });

    it('returns the correct count after multiple inserts', () => {
      const cache = createCacheManager<TestRecord>();
      cache.upsert(makeRecord('1', 'a'));
      cache.upsert(makeRecord('2', 'b'));
      cache.upsert(makeRecord('3', 'c'));

      expect(cache.size()).toBe(3);
    });

    it('does not double-count an upsert of the same id', () => {
      const cache = createCacheManager<TestRecord>();
      cache.upsert(makeRecord('1', 'a'));
      cache.upsert(makeRecord('1', 'b'));

      expect(cache.size()).toBe(1);
    });
  });


  describe('index consistency', () => {
    it('a record replaced via upsert does not leave stale index entries', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug').addIndex('category');
      cache.upsert(makeRecord('1', 'alpha', 'gif'));
      cache.upsert(makeRecord('1', 'beta', 'message'));

      expect(cache.getByIndex('slug', 'alpha')).toBeNull();
      expect(cache.getByIndex('category', 'gif')).toBeNull();
      expect(cache.getByIndex('slug', 'beta')).not.toBeNull();
      expect(cache.getByIndex('category', 'message')).not.toBeNull();
    });

    it('multiple records can share the same category value across different ids', () => {
      const cache = createCacheManager<TestRecord>().addIndex('category');
      cache.upsert(makeRecord('1', 'a', 'gif'));
      cache.upsert(makeRecord('2', 'b', 'gif'));

      // Index is 1:1 — the second upsert overwrites the first in the category index
      // This is expected behaviour: the index always points to the last writer
      const found = cache.getByIndex('category', 'gif');
      expect(found).not.toBeNull();
    });

    it('deleting one record does not break lookups for remaining records', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('1', 'alpha'));
      cache.upsert(makeRecord('2', 'beta'));
      cache.delete('1');

      expect(cache.getByIndex('slug', 'beta')).toMatchObject({ id: '2' });
    });

    it('a refreshed cache has clean indexes with no stale entries from before', () => {
      const cache = createCacheManager<TestRecord>().addIndex('slug');
      cache.upsert(makeRecord('old', 'stale-slug'));
      cache.refresh([makeRecord('new', 'fresh-slug')]);

      expect(cache.getByIndex('slug', 'stale-slug')).toBeNull();
      expect(cache.getByIndex('slug', 'fresh-slug')).not.toBeNull();
    });
  });
});
