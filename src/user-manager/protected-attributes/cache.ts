import { DataManager, PROTECTED_ATTRIBUTES, checkInitialized } from '../../data-manager';
import { ProtectedAttributesRecord } from '../types';
import { isNonEmptyString } from '../helpers';

const dm = DataManager.getInstance();

const _checkInitialization = (): void => {
  checkInitialized(dm.getInitializationStatus(), 'UserManager');
};

/**
 * In-memory cache for protected attributes.
 * Outer key: uniqueIdentifier / Inner key: namespace
 * @private
 */
const _protectedAttributes: Map<string, Map<string, ProtectedAttributesRecord>> = new Map();

/**
 * Clears the protected attributes cache.
 */
const clearProtectedAttributesCache = (): void => {
  _protectedAttributes.clear();
};

/**
 * Loads all protected attributes documents from the database into the in-memory cache.
 *
 * @returns {Promise<void>} Resolves when protected attributes are loaded into the cache.
 */
const refreshProtectedAttributesCache = async (): Promise<void> => {
  _checkInitialization();
  clearProtectedAttributesCache();

  const docs = await dm.getAllInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES);
  docs.forEach((doc: ProtectedAttributesRecord) => {
    if (!doc?.uniqueIdentifier || !doc?.namespace) return;

    const byNamespace =
      _protectedAttributes.get(doc.uniqueIdentifier) ??
      new Map<string, ProtectedAttributesRecord>();

    byNamespace.set(doc.namespace, doc);
    _protectedAttributes.set(doc.uniqueIdentifier, byNamespace);
  });
};

/**
 * Upserts a protected attributes document into the in-memory cache.
 *
 * Note: intentionally does not call `_checkInitialization` — this is a pure
 * cache mutation used as a side-effect after confirmed write operations where
 * initialization has already been verified by the caller.
 *
 * @param {ProtectedAttributesRecord} doc - The protected attributes record to cache.
 */
const upsertProtectedAttributesInCache = (doc: ProtectedAttributesRecord): void => {
  if (!doc?.uniqueIdentifier || !doc?.namespace) return;

  const byNamespace =
    _protectedAttributes.get(doc.uniqueIdentifier) ?? new Map<string, ProtectedAttributesRecord>();

  byNamespace.set(doc.namespace, doc);
  _protectedAttributes.set(doc.uniqueIdentifier, byNamespace);
};

/**
 * Deletes all protected attributes for a given uniqueIdentifier from cache.
 *
 * @param {string} uniqueIdentifier - The uniqueIdentifier to delete.
 */
const deleteProtectedAttributesByUniqueIdentifierFromCache = (uniqueIdentifier: string): void => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return;

  _protectedAttributes.delete(uniqueIdentifier);
};

/**
 * Deletes a protected attributes doc from cache by its document id.
 *
 * Note: delete change events currently provide only the doc id.
 *
 * @param {string} docId - The protected attributes doc id.
 * @returns {boolean} True if a doc was found and removed.
 */
const deleteProtectedAttributesDocByIdFromCache = (docId: string): boolean => {
  _checkInitialization();

  if (!isNonEmptyString(docId)) return false;

  for (const [uniqueIdentifier, byNamespace] of _protectedAttributes.entries()) {
    for (const [namespace, doc] of byNamespace.entries()) {
      if ((doc as any)?.id === docId) {
        byNamespace.delete(namespace);

        if (byNamespace.size === 0) {
          _protectedAttributes.delete(uniqueIdentifier);
        } else {
          _protectedAttributes.set(uniqueIdentifier, byNamespace);
        }

        return true;
      }
    }
  }

  return false;
};

/**
 * Retrieves all protected attributes documents for a user from cache.
 *
 * @param {string} uniqueIdentifier - The uniqueIdentifier to look up.
 * @returns {ProtectedAttributesRecord[]} All protected attributes records for the user.
 */
const getAllProtectedAttributesFromCache = (
  uniqueIdentifier: string,
): ProtectedAttributesRecord[] => {
  const byNamespace = _protectedAttributes.get(uniqueIdentifier);
  if (!byNamespace) return [];

  return [...byNamespace.values()];
};

/**
 * Retrieves protected attributes documents for a user by namespaces from cache.
 *
 * @param {string} uniqueIdentifier - The uniqueIdentifier to look up.
 * @param {string[]} namespaces - Namespaces to retrieve.
 * @returns {ProtectedAttributesRecord[]} Matching protected attributes records.
 */
const getProtectedAttributesByNamespacesFromCache = (
  uniqueIdentifier: string,
  namespaces: string[],
): ProtectedAttributesRecord[] => {
  if (!Array.isArray(namespaces) || namespaces.length === 0) return [];

  const byNamespace = _protectedAttributes.get(uniqueIdentifier);
  if (!byNamespace) return [];

  const results: ProtectedAttributesRecord[] = [];
  for (const ns of namespaces) {
    const doc = byNamespace.get(ns);
    if (doc) results.push(doc);
  }

  return results;
};

export {
  clearProtectedAttributesCache,
  refreshProtectedAttributesCache,
  upsertProtectedAttributesInCache,
  deleteProtectedAttributesByUniqueIdentifierFromCache,
  deleteProtectedAttributesDocByIdFromCache,
  getAllProtectedAttributesFromCache,
  getProtectedAttributesByNamespacesFromCache,
};

/**
 * Testing exports for cache internals.
 * @private
 */
export const __testing__protectedAttributesCache = {
  _checkInitialization,
  _protectedAttributes,
};
