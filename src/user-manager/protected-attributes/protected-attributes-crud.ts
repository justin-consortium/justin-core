import DataManager from '../../data-manager/data-manager';
import { PROTECTED_ATTRIBUTES } from '../../data-manager/data-manager.constants';
import type { ProtectedAttributesRecord } from '../user.type';
import { assertNoReservedKeys, cleanNamespace, cleanString, isPlainObject } from '../validation';
import {
  deleteProtectedAttributesByUniqueIdentifierFromCache,
  getProtectedAttributesByNamespacesFromCache,
  upsertProtectedAttributesInCache,
} from './protected-attributes-cache';

const dm = DataManager.getInstance();

/**
 * Ensures that the DataManager has been initialized before any protected-attributes
 * CRUD operation can proceed.
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
 * Gets protected attributes records for a user (by uniqueIdentifier) across namespaces.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespaces - Namespaces to retrieve.
 * @returns Matching records (may be empty).
 */
const getProtectedAttributesByNamespacesForUniqueIdentifier = (
  uniqueIdentifier: string,
  namespaces: string[],
): ProtectedAttributesRecord[] => {
  _checkInitialization();

  const cleanedUniqueIdentifier = cleanString(uniqueIdentifier);
  if (!cleanedUniqueIdentifier) return [];

  return getProtectedAttributesByNamespacesFromCache(cleanedUniqueIdentifier, namespaces);
};

/**
 * Adds protected attributes for (uniqueIdentifier, namespace).
 *
 * Strict add: if a doc already exists, returns null.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - Namespace.
 * @param protectedAttributes - Protected payload.
 * @returns Created doc or null.
 * @throws {Error} If reserved/invariants are violated.
 */
const addProtectedAttributesForUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespace: string,
  protectedAttributes: Record<string, any>,
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  const cleanedUniqueIdentifier = cleanString(uniqueIdentifier);
  if (!cleanedUniqueIdentifier) return null;

  const cleanedNamespace = cleanNamespace(namespace);
  if (!cleanedNamespace) return null;

  if (!isPlainObject(protectedAttributes)) return null;

  assertNoReservedKeys(
    protectedAttributes,
    ['id', 'uniqueIdentifier', 'namespace'],
    'Cannot set reserved protected-attributes fields (id, uniqueIdentifier, namespace).',
  );

  const existing = await dm.findItemsInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES, {
    uniqueIdentifier: cleanedUniqueIdentifier,
    namespace: cleanedNamespace,
  });

  if (existing.length > 0) return null;

  const created = (await dm.addItemToCollection(PROTECTED_ATTRIBUTES, {
    uniqueIdentifier: cleanedUniqueIdentifier,
    namespace: cleanedNamespace,
    protectedAttributes,
  })) as ProtectedAttributesRecord;

  upsertProtectedAttributesInCache(created);
  return created;
};

/**
 * Adds protected attributes for a uniqueIdentifier across multiple namespaces.
 *
 * Current implementation loops and calls {@link addProtectedAttributesForUniqueIdentifier}.
 *
 * This is intentionally structured so it can be upgraded to a true bulk insert once:
 * - DataManager supports unordered bulk insert semantics, AND
 * - the adapter layer can surface duplicate-key outcomes per item.
 *
 * Semantics:
 * - Invalid inputs for a given item are skipped (treated as a no-op for that item).
 * - If an item violates reserved/invariant keys, the underlying add call throws.
 * - Existing docs are not modified (strict-add behavior); those items return null.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param items - Array of { namespace, protectedAttributes } inputs.
 * @returns Array of successfully created docs (may be empty).
 * @throws {Error} If reserved/invariants are violated.
 */
const addProtectedAttributesBatchForUniqueIdentifier = async (
  uniqueIdentifier: string,
  items: Array<{ namespace: string; protectedAttributes: Record<string, any> }>,
): Promise<ProtectedAttributesRecord[]> => {
  _checkInitialization();

  const cleanedUniqueIdentifier = cleanString(uniqueIdentifier);
  if (!cleanedUniqueIdentifier) return [];

  if (!Array.isArray(items) || items.length === 0) return [];

  const created: ProtectedAttributesRecord[] = [];

  for (const item of items as any[]) {
    const ns = (item as any)?.namespace;
    const attrs = (item as any)?.protectedAttributes;

    const doc = await addProtectedAttributesForUniqueIdentifier(cleanedUniqueIdentifier, ns, attrs);
    if (doc) created.push(doc);
  }

  return created;
};

/**
 * Upserts protected attributes for (uniqueIdentifier, namespace).
 *
 * If none exists, creates; otherwise updates.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - Namespace.
 * @param protectedAttributes - Protected payload.
 * @returns Upserted doc or null for invalid input.
 * @throws {Error} If reserved/invariants are violated.
 */
const upsertProtectedAttributesForUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespace: string,
  protectedAttributes: Record<string, any>,
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  const cleanedUniqueIdentifier = cleanString(uniqueIdentifier);
  if (!cleanedUniqueIdentifier) return null;

  const cleanedNamespace = cleanNamespace(namespace);
  if (!cleanedNamespace) return null;

  if (!isPlainObject(protectedAttributes)) return null;

  assertNoReservedKeys(
    protectedAttributes,
    ['id', 'uniqueIdentifier', 'namespace'],
    'Cannot set reserved protected-attributes fields (id, uniqueIdentifier, namespace).',
  );

  const existing = await dm.findItemsInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES, {
    uniqueIdentifier: cleanedUniqueIdentifier,
    namespace: cleanedNamespace,
  });

  if (existing.length === 0) {
    const created = (await dm.addItemToCollection(PROTECTED_ATTRIBUTES, {
      uniqueIdentifier: cleanedUniqueIdentifier,
      namespace: cleanedNamespace,
      protectedAttributes,
    })) as ProtectedAttributesRecord;

    upsertProtectedAttributesInCache(created);
    return created;
  }

  const doc = existing[0] as any;
  const docId = doc?.id;

  if (!docId || typeof docId !== 'string') {
    throw new Error('ProtectedAttributesRecord is missing id.');
  }

  const updated = (await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, docId, {
    protectedAttributes,
  })) as ProtectedAttributesRecord;

  upsertProtectedAttributesInCache(updated);
  return updated;
};

/**
 * Deletes protected attributes for (uniqueIdentifier, namespace).
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - Namespace.
 * @returns True if any doc was deleted.
 */
const deleteProtectedAttributesByNamespaceForUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespace: string,
): Promise<boolean> => {
  _checkInitialization();

  const cleanedUniqueIdentifier = cleanString(uniqueIdentifier);
  if (!cleanedUniqueIdentifier) return false;

  const cleanedNamespace = cleanNamespace(namespace);
  if (!cleanedNamespace) return false;

  const docs = await dm.findItemsInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES, {
    uniqueIdentifier: cleanedUniqueIdentifier,
    namespace: cleanedNamespace,
  });

  let deletedAny = false;

  for (const doc of docs) {
    const id = (doc as any)?.id;
    if (!id) continue;

    const deleted = await dm.removeItemFromCollection(PROTECTED_ATTRIBUTES, id);
    deletedAny = deletedAny || Boolean(deleted);
  }

  if (deletedAny) {
    // Conservative correctness: drop the bucket; cache listeners will repopulate as needed.
    deleteProtectedAttributesByUniqueIdentifierFromCache(cleanedUniqueIdentifier);
  }

  return deletedAny;
};

/**
 * Deletes all protected attributes for a uniqueIdentifier.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @returns {Promise<void>}
 */
const deleteAllProtectedAttributesForUniqueIdentifier = async (
  uniqueIdentifier: string,
): Promise<void> => {
  _checkInitialization();

  const cleanedUniqueIdentifier = cleanString(uniqueIdentifier);
  if (!cleanedUniqueIdentifier) return;

  const docs = await dm.findItemsInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES, {
    uniqueIdentifier: cleanedUniqueIdentifier,
  });

  for (const doc of docs) {
    const id = (doc as any)?.id;
    if (id) {
      await dm.removeItemFromCollection(PROTECTED_ATTRIBUTES, id);
    }
  }

  deleteProtectedAttributesByUniqueIdentifierFromCache(cleanedUniqueIdentifier);
};

export {
  getProtectedAttributesByNamespacesForUniqueIdentifier,
  addProtectedAttributesForUniqueIdentifier,
  addProtectedAttributesBatchForUniqueIdentifier,
  upsertProtectedAttributesForUniqueIdentifier,
  deleteProtectedAttributesByNamespaceForUniqueIdentifier,
  deleteAllProtectedAttributesForUniqueIdentifier,
};

/**
 * Testing exports for CRUD internals.
 *
 * @private
 */
export const __testing__protectedAttributesCrud = {
  _checkInitialization,
};
