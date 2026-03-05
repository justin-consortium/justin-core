import DataManager from '../../data-manager/data-manager';
import { PROTECTED_ATTRIBUTES } from '../../data-manager/data-manager.constants';
import { ProtectedAttributesRecord } from '../user.type';
import { cleanString } from '../validation';

const dm = DataManager.getInstance();

/**
 * In-memory cache for protected attributes.
 *
 * Outer key: uniqueIdentifier
 * Inner key: namespace
 *
 * @private
 */
const _protectedAttributes: Map<string, Map<string, ProtectedAttributesRecord>> = new Map();

/**
 * Ensures that the DataManager has been initialized before any cache
 * operation can proceed.
 *
 * @throws {Error} If DataManager is not initialized.
 * @private
 */
const _checkInitialization = (): void => {
  if (!dm.getInitializationStatus()) {
    throw new Error('UserManager has not been initialized');
  }
};

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
 * @param {ProtectedAttributesRecord} doc - The protected attributes record to cache.
 */
const upsertProtectedAttributesInCache = (doc: ProtectedAttributesRecord): void => {
  _checkInitialization();

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

  const cleaned = cleanString(uniqueIdentifier);
  if (!cleaned) return;

  _protectedAttributes.delete(cleaned);
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

  const cleaned = cleanString(docId);
  if (!cleaned) return false;

  for (const [uniqueIdentifier, byNamespace] of _protectedAttributes.entries()) {
    for (const [namespace, doc] of byNamespace.entries()) {
      if ((doc as any)?.id === cleaned) {
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
  _checkInitialization();

  const cleanedUniqueIdentifier = cleanString(uniqueIdentifier);
  if (!cleanedUniqueIdentifier) return [];

  if (!Array.isArray(namespaces) || namespaces.length === 0) {
    return [];
  }

  const byNamespace = _protectedAttributes.get(cleanedUniqueIdentifier);
  if (!byNamespace) {
    return [];
  }

  const cleanedNamespaces = namespaces
    .filter((ns) => typeof ns === 'string')
    .map((ns) => ns.trim())
    .filter((ns) => ns.length > 0);

  const results: ProtectedAttributesRecord[] = [];
  for (const ns of cleanedNamespaces) {
    const doc = byNamespace.get(ns);
    if (doc) {
      results.push(doc);
    }
  }

  return results;
};

export {
  clearProtectedAttributesCache,
  refreshProtectedAttributesCache,
  upsertProtectedAttributesInCache,
  deleteProtectedAttributesByUniqueIdentifierFromCache,
  deleteProtectedAttributesDocByIdFromCache,
  getProtectedAttributesByNamespacesFromCache,
};

/**
 * Testing exports for cache internals.
 *
 * @private
 */
export const __testing__protectedAttributesCache = {
  _checkInitialization,
  _protectedAttributes,
};
