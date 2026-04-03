import type { CacheManager } from '../../cache-manager';
import { createCacheManager } from '../../cache-manager';
import { DataManager } from '../../data-manager';
import { checkInitialized } from '../../utils';
import { createLogger } from '../../logger';
import type { ProtectedAttributesRecord } from '../types';
import { PROTECTED_ATTRIBUTES } from '../constants';

const Log = createLogger({ context: { source: 'protected-attributes-cache' } });

const dm = DataManager.getInstance();

const _checkInit = (): void => checkInitialized(dm.getInitializationStatus(), 'UserManager');

/**
 * In-memory cache for protected-attributes records.
 *
 * Records are keyed by `id`. The `uniqueIdentifier` field is indexed so all
 * records for a given user can be retrieved without a DB round-trip.
 *
 * Note: unlike the users cache, there can be multiple records per
 * `uniqueIdentifier` (one per namespace), so index lookups return the first
 * match only — use {@link getAllProtectedAttributesByUniqueIdentifier} to get
 * all records for a user.
 */
const _cache: CacheManager<ProtectedAttributesRecord> =
  createCacheManager<ProtectedAttributesRecord>().addIndex('uniqueIdentifier');

// We maintain a separate map for multi-record lookups by uniqueIdentifier
// since CacheManager indexes are 1:1. This supplements the cache for the
// "get all for user" case.
const _byUniqueIdentifier = new Map<string, Set<string>>(); // uid → Set<id>

function _registerUid(record: ProtectedAttributesRecord): void {
  const existing = _byUniqueIdentifier.get(record.uniqueIdentifier) ?? new Set();
  existing.add(record.id);
  _byUniqueIdentifier.set(record.uniqueIdentifier, existing);
}

function _deregisterUid(record: ProtectedAttributesRecord): void {
  const ids = _byUniqueIdentifier.get(record.uniqueIdentifier);
  if (!ids) return;
  ids.delete(record.id);
  if (ids.size === 0) _byUniqueIdentifier.delete(record.uniqueIdentifier);
}

// ---------------------------------------------------------------------------
// Cache operations
// ---------------------------------------------------------------------------

/**
 * Loads all protected-attributes records from the database into the
 * in-memory cache, replacing whatever was there before.
 */
const refreshProtectedAttributesCache = async (): Promise<void> => {
  _checkInit();
  const docs = await dm.getAllInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES);

  _cache.clear();
  _byUniqueIdentifier.clear();

  for (const doc of docs) {
    if (!doc?.id) {
      Log.error('refreshProtectedAttributesCache: skipping malformed record — missing id', {
        record: doc,
      });
      continue;
    }
    _cache.upsert(doc);
    _registerUid(doc);
  }
};

/**
 * Clears all protected-attributes records and indexes from the cache.
 */
const clearProtectedAttributesCache = (): void => {
  _cache.clear();
  _byUniqueIdentifier.clear();
};

/**
 * Inserts or replaces a single protected-attributes record in the cache.
 *
 * @param record - Record to upsert.
 */
const upsertProtectedAttributesInCache = (record: ProtectedAttributesRecord): void => {
  _checkInit();
  if (!record?.id) {
    Log.error('upsertProtectedAttributesInCache: skipping malformed record — missing id', {
      record,
    });
    return;
  }

  const existing = _cache.getById(record.id);
  if (existing) _deregisterUid(existing);

  _cache.upsert(record);
  _registerUid(record);
};

/**
 * Removes a protected-attributes record from the cache by `id`.
 *
 * @param id - Primary key of the record to remove.
 */
const deleteProtectedAttributesByIdFromCache = (id: string): void => {
  _checkInit();
  const record = _cache.getById(id);
  if (!record) return;
  _deregisterUid(record);
  _cache.delete(id);
};

/**
 * Removes all cached protected-attributes records for the given user.
 *
 * @param uniqueIdentifier - User whose records should be evicted.
 */
const deleteProtectedAttributesByUniqueIdentifierFromCache = (uniqueIdentifier: string): void => {
  _checkInit();
  const ids = _byUniqueIdentifier.get(uniqueIdentifier);
  if (!ids) return;

  for (const id of ids) _cache.delete(id);
  _byUniqueIdentifier.delete(uniqueIdentifier);
};

/**
 * Returns all cached protected-attributes records for the given user.
 *
 * @param uniqueIdentifier - User whose records to retrieve.
 */
const getAllProtectedAttributesByUniqueIdentifier = (
  uniqueIdentifier: string,
): ProtectedAttributesRecord[] => {
  _checkInit();
  const ids = _byUniqueIdentifier.get(uniqueIdentifier);
  if (!ids) return [];

  const results: ProtectedAttributesRecord[] = [];
  for (const id of ids) {
    const record = _cache.getById(id);
    if (record) results.push(record);
  }
  return results;
};

/**
 * Returns cached protected-attributes records for the given user, filtered
 * to the specified namespaces. Empty-string or non-existent namespaces are
 * silently skipped.
 *
 * @param uniqueIdentifier - User whose records to retrieve.
 * @param namespaces - Namespaces to include.
 */
const getProtectedAttributesByUniqueIdentifier = (
  uniqueIdentifier: string,
  namespaces: string[],
): ProtectedAttributesRecord[] => {
  _checkInit();
  const all = getAllProtectedAttributesByUniqueIdentifier(uniqueIdentifier);
  const nsSet = new Set(namespaces.filter(Boolean));
  return all.filter((r) => nsSet.has(r.namespace));
};

/** @internal — exposed for testing only */
const __testing__protectedAttributesCache = { _cache, _byUniqueIdentifier };

export {
  refreshProtectedAttributesCache,
  clearProtectedAttributesCache,
  upsertProtectedAttributesInCache,
  deleteProtectedAttributesByIdFromCache,
  deleteProtectedAttributesByUniqueIdentifierFromCache,
  getAllProtectedAttributesByUniqueIdentifier,
  getProtectedAttributesByUniqueIdentifier,
  __testing__protectedAttributesCache,
};
