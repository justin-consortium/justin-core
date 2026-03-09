import DataManager from '../../data-manager/data-manager';
import { PROTECTED_ATTRIBUTES } from '../../data-manager/data-manager.constants';
import { handleDbError, checkInitialized } from '../../data-manager/data-manager.helpers';
import type { NamespacedAttributes, ProtectedAttributesRecord } from '../types';
import {
  assertNoReservedKeysDeep,
  isNonEmptyString,
  getPathSegments,
  isPlainObject,
  setValueAtPath,
  deleteValueAtPath,
} from '../helpers';
import {
  deleteProtectedAttributesByUniqueIdentifierFromCache,
  getAllProtectedAttributesFromCache,
  getProtectedAttributesByNamespacesFromCache,
  upsertProtectedAttributesInCache,
} from './protected-attributes-cache';

const dm = DataManager.getInstance();

const RESERVED_PROTECTED_ATTRIBUTE_KEYS = ['id', 'uniqueIdentifier', 'namespace'];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const _checkInitialization = (): void => {
  checkInitialized(dm.getInitializationStatus(), 'UserManager');
};

/**
 * Validates a protected-attributes payload.
 *
 * @param protectedAttributes - The payload to validate.
 * @returns True when valid.
 * @throws {Error} If reserved keys are present.
 * @private
 */
const _isValidProtectedAttributesPayload = (
  protectedAttributes: Record<string, any>,
): boolean => {
  if (!isPlainObject(protectedAttributes)) return false;

  assertNoReservedKeysDeep(
    protectedAttributes,
    RESERVED_PROTECTED_ATTRIBUTE_KEYS,
    'Cannot set reserved protected-attributes fields (id, uniqueIdentifier, namespace).',
  );

  return true;
};

/**
 * Normalizes a namespaced attributes input into an array.
 * @private
 */
const _normalizeNamespacedAttributesInput = (
  input: NamespacedAttributes | NamespacedAttributes[],
): NamespacedAttributes[] => {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object') return [input];
  return [];
};

/**
 * Finds a protected-attributes record by uniqueIdentifier and namespace.
 *
 * @throws {Error} If the DB query fails.
 * @private
 */
const _findProtectedAttributesRecord = async (
  uniqueIdentifier: string,
  namespace: string,
): Promise<ProtectedAttributesRecord | null> => {
  try {
    const docs = await dm.findItemsInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES, {
      uniqueIdentifier,
      namespace,
    });

    if (!Array.isArray(docs) || docs.length === 0) return null;

    return docs[0] ?? null;
  } catch (error) {
    return handleDbError(
      `Failed to find protected attributes for ${uniqueIdentifier}/${namespace}`,
      '_findProtectedAttributesRecord',
      error,
    );
  }
};

/**
 * Performs a shallow merge of protected attributes.
 * @private
 */
const _mergeProtectedAttributes = (
  existing: Record<string, any>,
  incoming: Record<string, any>,
): Record<string, any> => {
  return {
    ...(isPlainObject(existing) ? existing : {}),
    ...incoming,
  };
};

/**
 * Asserts that a path string does not contain reserved key segments.
 *
 * @throws {Error} If any path segment is a reserved key.
 * @private
 */
const _assertNoReservedKeyPath = (keyPath: string): void => {
  const segments = getPathSegments(keyPath);

  for (const segment of segments) {
    if (RESERVED_PROTECTED_ATTRIBUTE_KEYS.includes(segment)) {
      throw new Error(
        'Cannot set reserved protected-attributes fields (id, uniqueIdentifier, namespace).',
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Gets protected attributes records for a user across the provided namespaces.
 * Served from cache — no DB round-trip.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespaces - The namespaces to retrieve.
 * @returns Matching records, or an empty array.
 * @throws {Error} If DataManager has not been initialized.
 */
const getProtectedAttributesByUniqueIdentifier = (
  uniqueIdentifier: string,
  namespaces: string[],
): ProtectedAttributesRecord[] => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return [];
  if (!Array.isArray(namespaces) || namespaces.length === 0) return [];

  const validNamespaces = namespaces.filter(isNonEmptyString);
  if (validNamespaces.length === 0) return [];

  return getProtectedAttributesByNamespacesFromCache(uniqueIdentifier, validNamespaces);
};

/**
 * Gets all protected attributes records for a user.
 * Served from cache — no DB round-trip.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @returns All records for the user, or an empty array.
 * @throws {Error} If DataManager has not been initialized.
 */
const getAllProtectedAttributesByUniqueIdentifier = (
  uniqueIdentifier: string,
): ProtectedAttributesRecord[] => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return [];

  return getAllProtectedAttributesFromCache(uniqueIdentifier);
};

// ---------------------------------------------------------------------------
// Upsert operation
// ---------------------------------------------------------------------------

/**
 * Upserts one or more namespace-scoped protected attributes records for a user.
 *
 * For each namespace:
 * - if no record exists, a new record is created.
 * - if a record exists, the incoming protectedAttributes are shallow-merged and persisted.
 *
 * Invalid items are skipped.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param input - A single namespaced attributes object or an array of them.
 * @returns The created or updated records.
 * @throws {Error} If DataManager has not been initialized, a payload contains reserved keys,
 * or a DB operation fails.
 */
const setProtectedAttributesByUniqueIdentifier = async (
  uniqueIdentifier: string,
  input: NamespacedAttributes | NamespacedAttributes[],
): Promise<ProtectedAttributesRecord[]> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return [];

  const items = _normalizeNamespacedAttributesInput(input);
  if (items.length === 0) return [];

  const results: ProtectedAttributesRecord[] = [];

  for (const item of items) {
    const namespace = item?.namespace;
    const protectedAttributes = item?.protectedAttributes;

    if (!isNonEmptyString(namespace)) continue;
    if (!_isValidProtectedAttributesPayload(protectedAttributes)) continue;

    const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);

    if (!existing) {
      try {
        const created = (await dm.addItemToCollection(PROTECTED_ATTRIBUTES, {
          uniqueIdentifier,
          namespace,
          protectedAttributes,
        })) as ProtectedAttributesRecord;

        upsertProtectedAttributesInCache(created);
        results.push(created);
      } catch (error) {
        handleDbError(
          `Failed to create protected attributes for ${uniqueIdentifier}/${namespace}`,
          'setProtectedAttributesByUniqueIdentifier',
          error,
        );
      }
      continue;
    }

    const existingId = existing?.id;
    if (!existingId || typeof existingId !== 'string') {
      throw new Error('ProtectedAttributesRecord is missing id.');
    }

    const mergedProtectedAttributes = _mergeProtectedAttributes(
      existing.protectedAttributes,
      protectedAttributes,
    );

    try {
      const updated = (await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, existingId, {
        protectedAttributes: mergedProtectedAttributes,
      })) as ProtectedAttributesRecord;

      upsertProtectedAttributesInCache(updated);
      results.push(updated);
    } catch (error) {
      handleDbError(
        `Failed to update protected attributes for ${uniqueIdentifier}/${namespace}`,
        'setProtectedAttributesByUniqueIdentifier',
        error,
      );
    }
  }

  return results;
};

// ---------------------------------------------------------------------------
// Key-level patch operations
// ---------------------------------------------------------------------------

/**
 * Updates a single nested key path within a namespace-scoped protected attributes object.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - The namespace to update.
 * @param keyPath - The key path to update.
 * @param value - The value to set.
 * @returns The updated record, or null if not found or input is invalid.
 * @throws {Error} If DataManager has not been initialized, the path or value contains
 * reserved keys, or the DB operation fails.
 */
const updateProtectedAttributeByUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespace: string,
  keyPath: string,
  value: any,
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return null;
  if (!isNonEmptyString(namespace)) return null;

  const pathSegments = getPathSegments(keyPath);
  if (pathSegments.length === 0) return null;

  _assertNoReservedKeyPath(keyPath);

  assertNoReservedKeysDeep(
    value,
    RESERVED_PROTECTED_ATTRIBUTE_KEYS,
    'Cannot set reserved protected-attributes fields (id, uniqueIdentifier, namespace).',
  );

  const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);
  if (!existing) return null;

  const existingId = existing?.id;
  if (!existingId || typeof existingId !== 'string') {
    throw new Error('ProtectedAttributesRecord is missing id.');
  }

  const currentProtectedAttributes = isPlainObject(existing.protectedAttributes)
    ? existing.protectedAttributes
    : {};

  const updatedProtectedAttributes = setValueAtPath(currentProtectedAttributes, keyPath, value);

  try {
    const updated = (await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, existingId, {
      protectedAttributes: updatedProtectedAttributes,
    })) as ProtectedAttributesRecord;

    upsertProtectedAttributesInCache(updated);
    return updated;
  } catch (error) {
    return handleDbError(
      `Failed to update protected attribute at ${keyPath} for ${uniqueIdentifier}/${namespace}`,
      'updateProtectedAttributeByUniqueIdentifier',
      error,
    );
  }
};

/**
 * Updates multiple nested key paths within a namespace-scoped protected attributes object.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - The namespace to update.
 * @param updates - An object whose keys are path strings and values are the values to set.
 * @returns The updated record, or null if not found or input is invalid.
 * @throws {Error} If DataManager has not been initialized, any path or value contains
 * reserved keys, or the DB operation fails.
 */
const updateProtectedAttributesByUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespace: string,
  updates: Record<string, any>,
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return null;
  if (!isNonEmptyString(namespace)) return null;
  if (!isPlainObject(updates)) return null;

  const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);
  if (!existing) return null;

  const existingId = existing?.id;
  if (!existingId || typeof existingId !== 'string') {
    throw new Error('ProtectedAttributesRecord is missing id.');
  }

  let updatedProtectedAttributes = isPlainObject(existing.protectedAttributes)
    ? { ...existing.protectedAttributes }
    : {};

  for (const [keyPath, value] of Object.entries(updates)) {
    const pathSegments = getPathSegments(keyPath);
    if (pathSegments.length === 0) continue;

    _assertNoReservedKeyPath(keyPath);

    assertNoReservedKeysDeep(
      value,
      RESERVED_PROTECTED_ATTRIBUTE_KEYS,
      'Cannot set reserved protected-attributes fields (id, uniqueIdentifier, namespace).',
    );

    updatedProtectedAttributes = setValueAtPath(updatedProtectedAttributes, keyPath, value);
  }

  try {
    const updated = (await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, existingId, {
      protectedAttributes: updatedProtectedAttributes,
    })) as ProtectedAttributesRecord;

    upsertProtectedAttributesInCache(updated);
    return updated;
  } catch (error) {
    return handleDbError(
      `Failed to update protected attributes for ${uniqueIdentifier}/${namespace}`,
      'updateProtectedAttributesByUniqueIdentifier',
      error,
    );
  }
};

// ---------------------------------------------------------------------------
// Delete operations
// ---------------------------------------------------------------------------

/**
 * Deletes one or more namespace-scoped protected attributes records for a user.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespaces - A namespace string or array of namespace strings to delete.
 * @returns True if at least one record was deleted.
 * @throws {Error} If DataManager has not been initialized or a DB operation fails.
 */
const deleteProtectedAttributesByUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespaces: string | string[],
): Promise<boolean> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return false;

  const namespaceList = Array.isArray(namespaces) ? namespaces : [namespaces];
  if (namespaceList.length === 0) return false;

  const validNamespaces = namespaceList.filter(isNonEmptyString);
  if (validNamespaces.length === 0) return false;

  const idsToDelete: string[] = [];

  for (const namespace of validNamespaces) {
    const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);
    const id = existing?.id;
    if (id && typeof id === 'string') idsToDelete.push(id);
  }

  if (idsToDelete.length === 0) return false;

  try {
    const deletedCount = await dm.removeItemsFromCollection(PROTECTED_ATTRIBUTES, idsToDelete);
    const deletedAny = deletedCount > 0;

    if (deletedAny) {
      deleteProtectedAttributesByUniqueIdentifierFromCache(uniqueIdentifier);

      const remainingDocs = await dm.findItemsInCollection<ProtectedAttributesRecord>(
        PROTECTED_ATTRIBUTES,
        { uniqueIdentifier },
      );

      remainingDocs.forEach((doc: ProtectedAttributesRecord) => {
        upsertProtectedAttributesInCache(doc);
      });
    }

    return deletedAny;
  } catch (error) {
    return handleDbError(
      `Failed to delete protected attributes for ${uniqueIdentifier}`,
      'deleteProtectedAttributesByUniqueIdentifier',
      error,
    );
  }
};

/**
 * Deletes all protected attributes records for a user in a single bulk operation.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @throws {Error} If DataManager has not been initialized or a DB operation fails.
 */
const deleteAllProtectedAttributesByUniqueIdentifier = async (
  uniqueIdentifier: string,
): Promise<void> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return;

  try {
    const docs = await dm.findItemsInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES, {
      uniqueIdentifier,
    });

    const ids = docs.map((doc) => doc?.id).filter((id): id is string => typeof id === 'string');

    if (ids.length > 0) {
      await dm.removeItemsFromCollection(PROTECTED_ATTRIBUTES, ids);
    }

    deleteProtectedAttributesByUniqueIdentifierFromCache(uniqueIdentifier);
  } catch (error) {
    handleDbError(
      `Failed to delete all protected attributes for ${uniqueIdentifier}`,
      'deleteAllProtectedAttributesByUniqueIdentifier',
      error,
    );
  }
};

/**
 * Deletes a single nested key path within a namespace-scoped protected attributes object.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - The namespace to update.
 * @param keyPath - The key path to delete.
 * @returns The updated record, or null if not found or input is invalid.
 * @throws {Error} If DataManager has not been initialized, the path contains reserved keys,
 * or the DB operation fails.
 */
const deleteProtectedAttributeByUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespace: string,
  keyPath: string,
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return null;
  if (!isNonEmptyString(namespace)) return null;

  const pathSegments = getPathSegments(keyPath);
  if (pathSegments.length === 0) return null;

  _assertNoReservedKeyPath(keyPath);

  const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);
  if (!existing) return null;

  const existingId = existing?.id;
  if (!existingId || typeof existingId !== 'string') {
    throw new Error('ProtectedAttributesRecord is missing id.');
  }

  const currentProtectedAttributes = isPlainObject(existing.protectedAttributes)
    ? existing.protectedAttributes
    : {};

  const updatedProtectedAttributes = deleteValueAtPath(currentProtectedAttributes, keyPath);

  try {
    const updated = (await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, existingId, {
      protectedAttributes: updatedProtectedAttributes,
    })) as ProtectedAttributesRecord;

    upsertProtectedAttributesInCache(updated);
    return updated;
  } catch (error) {
    return handleDbError(
      `Failed to delete protected attribute at ${keyPath} for ${uniqueIdentifier}/${namespace}`,
      'deleteProtectedAttributeByUniqueIdentifier',
      error,
    );
  }
};

/**
 * Deletes multiple nested key paths within a namespace-scoped protected attributes object.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - The namespace to update.
 * @param keyPaths - A path string or array of path strings to delete.
 * @returns The updated record, or null if not found or input is invalid.
 * @throws {Error} If DataManager has not been initialized, any path contains reserved keys,
 * or the DB operation fails.
 */
const deleteProtectedAttributesFromNamespaceByUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespace: string,
  keyPaths: string | string[],
): Promise<ProtectedAttributesRecord | null> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return null;
  if (!isNonEmptyString(namespace)) return null;

  const paths = Array.isArray(keyPaths) ? keyPaths : [keyPaths];
  if (paths.length === 0) return null;

  const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);
  if (!existing) return null;

  const existingId = existing?.id;
  if (!existingId || typeof existingId !== 'string') {
    throw new Error('ProtectedAttributesRecord is missing id.');
  }

  let updatedProtectedAttributes = isPlainObject(existing.protectedAttributes)
    ? { ...existing.protectedAttributes }
    : {};

  for (const keyPath of paths) {
    const pathSegments = getPathSegments(keyPath);
    if (pathSegments.length === 0) continue;

    _assertNoReservedKeyPath(keyPath);
    updatedProtectedAttributes = deleteValueAtPath(updatedProtectedAttributes, keyPath);
  }

  try {
    const updated = (await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, existingId, {
      protectedAttributes: updatedProtectedAttributes,
    })) as ProtectedAttributesRecord;

    upsertProtectedAttributesInCache(updated);
    return updated;
  } catch (error) {
    return handleDbError(
      `Failed to delete protected attributes from namespace ${namespace} for ${uniqueIdentifier}`,
      'deleteProtectedAttributesFromNamespaceByUniqueIdentifier',
      error,
    );
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  getProtectedAttributesByUniqueIdentifier,
  getAllProtectedAttributesByUniqueIdentifier,
  setProtectedAttributesByUniqueIdentifier,
  deleteProtectedAttributesByUniqueIdentifier,
  deleteAllProtectedAttributesByUniqueIdentifier,
  updateProtectedAttributeByUniqueIdentifier,
  updateProtectedAttributesByUniqueIdentifier,
  deleteProtectedAttributeByUniqueIdentifier,
  deleteProtectedAttributesFromNamespaceByUniqueIdentifier,
};

/**
 * Testing exports for protected-attributes CRUD internals.
 * @private
 */
export const __testing__protectedAttributesCrud = {
  _checkInitialization,
  _isValidProtectedAttributesPayload,
  _normalizeNamespacedAttributesInput,
  _findProtectedAttributesRecord,
  _mergeProtectedAttributes,
  _assertNoReservedKeyPath,
};
