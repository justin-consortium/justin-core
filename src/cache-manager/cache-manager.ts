/**
 * Generic in-memory cache for domain records.
 *
 * Every record must have a string `id` field — that is the primary key.
 * Additional lookup indexes are registered via the fluent {@link addIndex}
 * method before the cache is used. Each index maps one field's string value
 * to the record's `id`, enabling O(1) lookups by any indexed field.
 *
 * Designed to be instantiated once per manager and reused across the
 * lifetime of that manager.
 *
 * @typeParam T - The record type. Must include an `id: string` field.
 *
 * @example
 * ```ts
 * // UserManager cache — primary key is id, secondary index on uniqueIdentifier
 * const cache = createCacheManager<JUser>().addIndex('uniqueIdentifier');
 *
 * cache.refresh(users);
 * cache.upsert(newUser);
 * cache.getById(id);
 * cache.getByIndex('uniqueIdentifier', 'alice');
 * cache.delete(id);
 * cache.clear();
 * ```
 */
type CacheManager<T extends { id: string }> = {
  /**
   * Registers a secondary index on the given field, enabling lookups via
   * {@link getByIndex}. The index maps the field's string value to the
   * record's `id`.
   *
   * Must be called before any records are inserted. Returns the same
   * `CacheManager` instance for chaining.
   *
   * @param field - Key of `T` whose value will be indexed (must be a string field).
   */
  addIndex<K extends keyof T>(field: K): CacheManager<T>;

  /**
   * Replaces the entire cache contents with the provided records.
   * Clears existing data and all index entries first.
   *
   * @param records - Records to load into the cache.
   */
  refresh(records: T[]): void;

  /**
   * Inserts or replaces a single record in the cache, updating all indexes.
   *
   * @param record - Record to upsert.
   */
  upsert(record: T): void;

  /**
   * Removes a record from the cache and all indexes by `id`.
   *
   * Returns the deleted record, or `null` if it was not found.
   *
   * @param id - Primary key of the record to remove.
   */
  delete(id: string): T | null;

  /**
   * Clears all records and index entries from the cache.
   */
  clear(): void;

  /**
   * Returns the record with the given `id`, or `null` if not found.
   *
   * @param id - Primary key to look up.
   */
  getById(id: string): T | null;

  /**
   * Returns the record whose indexed field matches the given value, or `null`
   * if not found or if the field has not been registered as an index.
   *
   * @param field - Indexed field name registered via {@link addIndex}.
   * @param value - Value to look up in the index.
   */
  getByIndex<K extends keyof T>(field: K, value: string): T | null;

  /**
   * Returns all records currently in the cache as an array.
   */
  getAll(): T[];

  /**
   * Returns the number of records currently in the cache.
   */
  size(): number;
};

/**
 * Creates a new {@link CacheManager} instance for records of type `T`.
 *
 * Call {@link CacheManager.addIndex} immediately after creation to register
 * any secondary lookup fields before populating the cache.
 *
 * @typeParam T - The record type. Must include an `id: string` field.
 *
 * @example
 * ```ts
 * const cache = createCacheManager<JUser>().addIndex('uniqueIdentifier');
 * ```
 */
function createCacheManager<T extends { id: string }>(): CacheManager<T> {
  const _byId = new Map<string, T>();

  // field name → (field value → record id)
  const _indexes = new Map<string, Map<string, string>>();

  function _indexValue(record: T, field: string): void {
    const value = (record as any)[field];
    if (typeof value === 'string') {
      _indexes.get(field)!.set(value, record.id);
    }
  }

  function _removeFromIndexes(record: T): void {
    for (const [field, index] of _indexes.entries()) {
      const value = (record as any)[field];
      if (typeof value === 'string') {
        index.delete(value);
      }
    }
  }

  const manager: CacheManager<T> = {
    addIndex<K extends keyof T>(field: K): CacheManager<T> {
      _indexes.set(field as string, new Map());
      return manager;
    },

    refresh(records: T[]): void {
      _byId.clear();
      for (const index of _indexes.values()) index.clear();

      for (const record of records) {
        if (!record?.id) continue;
        _byId.set(record.id, record);
        for (const field of _indexes.keys()) _indexValue(record, field);
      }
    },

    upsert(record: T): void {
      if (!record?.id) return;

      const existing = _byId.get(record.id);
      if (existing) _removeFromIndexes(existing);

      _byId.set(record.id, record);
      for (const field of _indexes.keys()) _indexValue(record, field);
    },

    delete(id: string): T | null {
      const record = _byId.get(id) ?? null;
      if (!record) return null;

      _removeFromIndexes(record);
      _byId.delete(id);
      return record;
    },

    clear(): void {
      _byId.clear();
      for (const index of _indexes.values()) index.clear();
    },

    getById(id: string): T | null {
      return _byId.get(id) ?? null;
    },

    getByIndex<K extends keyof T>(field: K, value: string): T | null {
      const index = _indexes.get(field as string);
      if (!index) return null;
      const id = index.get(value);
      if (!id) return null;
      return _byId.get(id) ?? null;
    },

    getAll(): T[] {
      return Array.from(_byId.values());
    },

    size(): number {
      return _byId.size;
    },
  };

  return manager;
}

export { createCacheManager };
export type { CacheManager };
