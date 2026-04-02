import { DataManager } from '../../data-manager';
import { PROTECTED_ATTRIBUTES } from '../constants';
import {
  checkInitialized,
  coreSuccess,
  coreFailure,
  coreFailureResult,
  unwrapSuccess,
  makeLoopFailureCollector,
} from '../../utils';
import { JustinErrorCode } from '../../errors';
import type { NamespacedAttributes, ProtectedAttributesRecord } from '../types';
import type { CoreResult, FailureEntry } from '../../types';
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
  getAllProtectedAttributesByUniqueIdentifier as getAllProtectedAttributesFromCache,
  getProtectedAttributesByUniqueIdentifier as getProtectedAttributesFromCacheByNamespaces,
  upsertProtectedAttributesInCache,
} from './cache';

const dm = DataManager.getInstance();

const RESERVED_PROTECTED_ATTRIBUTE_KEYS = ['id', 'uniqueIdentifier', 'namespace'];

const _checkInitialization = (): void => {
  checkInitialized(dm.getInitializationStatus(), 'UserManager');
};

/**
 * Validates a protected-attributes payload.
 *
 * @param protectedAttributes - The payload to validate.
 * @returns True if valid; false if not a plain object or contains reserved keys.
 * @private
 */
const _isValidProtectedAttributesPayload = (protectedAttributes: Record<string, any>): boolean => {
  if (!isPlainObject(protectedAttributes)) return false;
  if (!assertNoReservedKeysDeep(protectedAttributes, RESERVED_PROTECTED_ATTRIBUTE_KEYS))
    return false;
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
 * Returns null if not found or if the query fails.
 * @private
 */
const _findProtectedAttributesRecord = async (
  uniqueIdentifier: string,
  namespace: string,
): Promise<ProtectedAttributesRecord | null> => {
  const docs = await dm.findItemsInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES, {
    uniqueIdentifier,
    namespace,
  });

  if (!Array.isArray(docs) || docs.length === 0) return null;
  return docs[0] ?? null;
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
 * Returns false if a path string contains any reserved or prototype-polluting
 * segments.
 *
 * Reserved segments (`id`, `uniqueIdentifier`, `namespace`) protect the
 * top-level record fields from being targeted by key-level patch operations.
 * Dangerous segments (`__proto__`, `constructor`, `prototype`) prevent
 * prototype pollution during path traversal.
 *
 * @param keyPath - The dot-notated path to check.
 * @returns True if the path is safe; false if it contains a reserved or dangerous segment.
 * @private
 */
const DANGEROUS_KEY_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const _isValidKeyPath = (keyPath: string): boolean => {
  const segments = getPathSegments(keyPath);
  for (const segment of segments) {
    if (RESERVED_PROTECTED_ATTRIBUTE_KEYS.includes(segment)) return false;
    if (DANGEROUS_KEY_SEGMENTS.has(segment)) return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Internal write helper
// ---------------------------------------------------------------------------

type _UpsertSingleResult =
  | { ok: true; record: ProtectedAttributesRecord }
  | { ok: false; code: string; reason: string };

/**
 * Creates or shallow-merges a single namespace-scoped protected-attributes record.
 *
 * Returns a discriminated union so the outer loop in
 * {@link setProtectedAttributes} can collect successes and
 * failures without throwing.
 *
 * @private
 */
const _upsertSingleProtectedAttributesRecord = async (
  uniqueIdentifier: string,
  namespace: string,
  protectedAttributes: Record<string, any>,
): Promise<_UpsertSingleResult> => {
  const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);

  if (!existing) {
    const addResult = unwrapSuccess<object, ProtectedAttributesRecord>(
      await dm.addItemToCollection(PROTECTED_ATTRIBUTES, {
        uniqueIdentifier,
        namespace,
        protectedAttributes,
      }),
      '_upsertSingleProtectedAttributesRecord',
      { uniqueIdentifier },
      { namespace },
    );
    if (!addResult.ok) {
      return { ok: false, code: addResult.failures[0].code, reason: addResult.failures[0].reason };
    }
    const created = addResult.successes[0] as ProtectedAttributesRecord;
    upsertProtectedAttributesInCache(created);
    return { ok: true, record: created };
  }

  const existingId = existing?.id;
  if (!existingId) {
    return {
      ok: false,
      code: JustinErrorCode.VALIDATION_ERROR,
      reason: 'ProtectedAttributesRecord is missing id',
    };
  }

  const merged = _mergeProtectedAttributes(existing.protectedAttributes, protectedAttributes);

  const updateResult = unwrapSuccess<object, ProtectedAttributesRecord>(
    await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, existingId, {
      protectedAttributes: merged,
    }),
    '_upsertSingleProtectedAttributesRecord',
    { uniqueIdentifier },
    { namespace },
  );
  if (!updateResult.ok) {
    return {
      ok: false,
      code: updateResult.failures[0].code,
      reason: updateResult.failures[0].reason,
    };
  }

  const updated = updateResult.successes[0] as ProtectedAttributesRecord;
  upsertProtectedAttributesInCache(updated);
  return { ok: true, record: updated };
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
 * @throws {JustinError} If DataManager has not been initialized.
 */
const getProtectedAttributes = (
  uniqueIdentifier: string,
  namespaces: string[],
): ProtectedAttributesRecord[] => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return [];
  if (!Array.isArray(namespaces) || namespaces.length === 0) return [];

  const validNamespaces = namespaces.filter(isNonEmptyString);
  if (validNamespaces.length === 0) return [];

  return getProtectedAttributesFromCacheByNamespaces(uniqueIdentifier, validNamespaces);
};

/**
 * Gets all protected attributes records for a user.
 * Served from cache — no DB round-trip.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @returns All records for the user, or an empty array.
 * @throws {JustinError} If DataManager has not been initialized.
 */
const getAllProtectedAttributes = (uniqueIdentifier: string): ProtectedAttributesRecord[] => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return [];

  return getAllProtectedAttributesFromCache(uniqueIdentifier);
};

// ---------------------------------------------------------------------------
// Upsert operation
// ---------------------------------------------------------------------------

/**
 * Upserts one or more namespace-scoped protected-attributes records for a user.
 *
 * For each namespace:
 * - if no record exists, a new record is created.
 * - if a record exists, the incoming protectedAttributes are shallow-merged.
 *
 * Every failure entry carries `uniqueIdentifier`, `namespace`, `code`, and `reason`
 * so callers have complete context without inspecting call arguments.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param input - A single namespaced attributes object or an array of them.
 * @returns A {@link CoreResult} with per-namespace success and failure detail.
 * @throws {JustinError} If DataManager has not been initialized.
 */
const setProtectedAttributes = async (
  uniqueIdentifier: string,
  input: NamespacedAttributes | NamespacedAttributes[],
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier))
    return coreFailureResult(
      'setProtectedAttributes',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier },
    );

  const items = _normalizeNamespacedAttributesInput(input);
  if (items.length === 0) return coreSuccess([]);

  const successes: ProtectedAttributesRecord[] = [];
  const collector = makeLoopFailureCollector<ProtectedAttributesRecord>('setProtectedAttributes', {
    uniqueIdentifier,
  });

  for (const item of items) {
    const namespace = item?.namespace;
    const protectedAttributes = item?.protectedAttributes;
    const ns = String(namespace ?? '');

    if (!isNonEmptyString(namespace)) {
      collector.push(JustinErrorCode.VALIDATION_ERROR, 'namespace must be a non-empty string', {
        namespace: ns,
      });
      continue;
    }

    if (!_isValidProtectedAttributesPayload(protectedAttributes)) {
      collector.push(
        JustinErrorCode.VALIDATION_ERROR,
        !isPlainObject(protectedAttributes)
          ? 'protectedAttributes must be a plain object'
          : 'protectedAttributes contains reserved keys (id, uniqueIdentifier, namespace)',
        { namespace },
      );
      continue;
    }

    const result = await _upsertSingleProtectedAttributesRecord(
      uniqueIdentifier,
      namespace,
      protectedAttributes,
    );

    if (!result.ok) {
      collector.push(result.code, result.reason, { namespace });
      continue;
    }

    successes.push(result.record);
  }

  return collector.hasFailures
    ? coreFailure(collector.failures, successes)
    : coreSuccess(successes);
};

// ---------------------------------------------------------------------------
// Key-level patch operations
// ---------------------------------------------------------------------------

/**
 * Sets one or more nested key paths within a namespace-scoped protected attributes object.
 *
 * If the namespace record does not exist it is created with the provided key paths as its
 * initial content. If it already exists the valid key paths are applied on top of the
 * existing content in a single DB write.
 *
 * Invalid or reserved paths are skipped and reported as failures; all valid paths are
 * applied regardless.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - The namespace to set keys on.
 * @param updates - Object whose keys are dot-notated paths and values are the values to set.
 * @returns A {@link CoreResult} with the created or updated record and any skipped-path failures.
 * @throws {JustinError} If DataManager has not been initialized.
 */
const setProtectedAttributeKeysByNamespace = async (
  uniqueIdentifier: string,
  namespace: string,
  updates: Record<string, any>,
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier))
    return coreFailureResult(
      'setProtectedAttributeKeysByNamespace',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier },
    );
  if (!isNonEmptyString(namespace))
    return coreFailureResult(
      'setProtectedAttributeKeysByNamespace',
      JustinErrorCode.VALIDATION_ERROR,
      'namespace must be a non-empty string',
      { uniqueIdentifier },
      { namespace },
    );
  if (!isPlainObject(updates))
    return coreFailureResult(
      'setProtectedAttributeKeysByNamespace',
      JustinErrorCode.VALIDATION_ERROR,
      'updates must be a plain object',
      { uniqueIdentifier },
      { namespace },
    );

  const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);

  // Build the updated protectedAttributes from existing content (or empty for new namespace)
  let updatedProtectedAttributes: Record<string, any> = isPlainObject(existing?.protectedAttributes)
    ? { ...existing!.protectedAttributes }
    : {};

  const skipCollector = makeLoopFailureCollector<ProtectedAttributesRecord>(
    'setProtectedAttributeKeysByNamespace',
    { uniqueIdentifier },
  );

  for (const [keyPath, value] of Object.entries(updates)) {
    const pathSegments = getPathSegments(keyPath);

    if (pathSegments.length === 0) {
      skipCollector.push(
        JustinErrorCode.VALIDATION_ERROR,
        'keyPath must be a non-empty dot-notated string',
        { namespace, keyPath },
      );
      continue;
    }
    if (!_isValidKeyPath(keyPath)) {
      skipCollector.push(
        JustinErrorCode.VALIDATION_ERROR,
        'keyPath contains a reserved or dangerous segment (id, uniqueIdentifier, namespace, __proto__, constructor, prototype)',
        { namespace, keyPath },
      );
      continue;
    }
    updatedProtectedAttributes = setValueAtPath(updatedProtectedAttributes, keyPath, value);
  }

  let record: ProtectedAttributesRecord;

  if (!existing) {
    // Namespace does not exist — create it with the computed attributes
    const addResult = unwrapSuccess<object, ProtectedAttributesRecord>(
      await dm.addItemToCollection(PROTECTED_ATTRIBUTES, {
        uniqueIdentifier,
        namespace,
        protectedAttributes: updatedProtectedAttributes,
      }),
      'setProtectedAttributeKeysByNamespace',
      { uniqueIdentifier },
      { namespace },
    );
    if (!addResult.ok) {
      return coreFailure([...skipCollector.failures, ...addResult.failures]);
    }
    record = addResult.successes[0] as ProtectedAttributesRecord;
  } else {
    const existingId = existing.id;
    if (!existingId)
      return coreFailureResult(
        'setProtectedAttributeKeysByNamespace',
        JustinErrorCode.VALIDATION_ERROR,
        'protected attributes record is missing id',
        { uniqueIdentifier },
        { namespace },
      );

    const updateResult = unwrapSuccess<object, ProtectedAttributesRecord>(
      await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, existingId, {
        protectedAttributes: updatedProtectedAttributes,
      }),
      'setProtectedAttributeKeysByNamespace',
      { uniqueIdentifier },
      { namespace },
    );
    if (!updateResult.ok) {
      return coreFailure([...skipCollector.failures, ...updateResult.failures]);
    }
    record = updateResult.successes[0] as ProtectedAttributesRecord;
  }

  upsertProtectedAttributesInCache(record);
  return skipCollector.hasFailures
    ? coreFailure(skipCollector.failures, [record])
    : coreSuccess([record]);
};

// ---------------------------------------------------------------------------
// Delete operations
// ---------------------------------------------------------------------------

/**
 * Deletes one or more namespace-scoped protected attributes records for a user.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespaces - A namespace string or array of namespace strings to delete.
 * @returns A {@link CoreResult} with `successes: [null]` when at least one record was deleted,
 *   or a failure with `NOT_FOUND` if no matching records exist.
 * @throws {JustinError} If DataManager has not been initialized.
 */
const deleteProtectedAttributeNamespaces = async (
  uniqueIdentifier: string,
  namespaces: string | string[],
): Promise<CoreResult<null>> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier))
    return coreFailureResult(
      'deleteProtectedAttributeNamespaces',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier },
    );

  const namespaceList = Array.isArray(namespaces) ? namespaces : [namespaces];
  if (namespaceList.length === 0)
    return coreFailureResult(
      'deleteProtectedAttributeNamespaces',
      JustinErrorCode.VALIDATION_ERROR,
      'at least one namespace must be provided',
      { uniqueIdentifier },
    );

  const validNamespaces = namespaceList.filter(isNonEmptyString);
  if (validNamespaces.length === 0)
    return coreFailureResult(
      'deleteProtectedAttributeNamespaces',
      JustinErrorCode.VALIDATION_ERROR,
      'no valid namespaces provided',
      { uniqueIdentifier },
    );

  const idsToDelete: string[] = [];

  for (const namespace of validNamespaces) {
    const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);
    const id = existing?.id;
    if (id && typeof id === 'string') idsToDelete.push(id);
  }

  if (idsToDelete.length === 0)
    return coreFailureResult(
      'deleteProtectedAttributeNamespaces',
      JustinErrorCode.NOT_FOUND,
      'no matching protected attributes records found',
      { uniqueIdentifier },
    );

  const removeResult = await dm.removeItemsFromCollection(PROTECTED_ATTRIBUTES, idsToDelete);
  if (!removeResult.ok && removeResult.successes.length === 0) {
    return coreFailure(
      removeResult.failures.map((f: FailureEntry) => ({ uniqueIdentifier, ...f })),
    );
  }

  deleteProtectedAttributesByUniqueIdentifierFromCache(uniqueIdentifier);

  const remainingDocs = await dm.findItemsInCollection<ProtectedAttributesRecord>(
    PROTECTED_ATTRIBUTES,
    { uniqueIdentifier },
  );
  remainingDocs.forEach((doc: ProtectedAttributesRecord) => upsertProtectedAttributesInCache(doc));

  if (!removeResult.ok) {
    return coreFailure(
      removeResult.failures.map((f: FailureEntry) => ({ uniqueIdentifier, ...f })),
      [null],
    );
  }
  return coreSuccess([null]);
};

/**
 * Deletes all protected attributes records for a user in a single bulk operation.
 *
 * Returns `ok: true` with `successes: [null]` when all records are removed (or when
 * there are no records to remove). Returns `ok: false` if the DB removal fails.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @returns A {@link CoreResult} with `successes: [null]` on success, or a failure
 *   with `VALIDATION_ERROR` if `uniqueIdentifier` is empty.
 * @throws {JustinError} If DataManager has not been initialized.
 */
const deleteAllProtectedAttributes = async (
  uniqueIdentifier: string,
): Promise<CoreResult<null>> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier))
    return coreFailureResult(
      'deleteAllProtectedAttributes',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier },
    );

  const docs = await dm.findItemsInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES, {
    uniqueIdentifier,
  });

  const ids = docs
    .map((doc: ProtectedAttributesRecord) => doc?.id)
    .filter((id: string | undefined): id is string => typeof id === 'string');

  if (ids.length > 0) {
    const removeResult = await dm.removeItemsFromCollection(PROTECTED_ATTRIBUTES, ids);
    if (!removeResult.ok && removeResult.successes.length === 0) {
      return coreFailure(removeResult.failures);
    }
  }

  deleteProtectedAttributesByUniqueIdentifierFromCache(uniqueIdentifier);
  return coreSuccess([null]);
};

/**
 * Deletes one or more nested key paths within a namespace-scoped protected attributes object.
 *
 * Pass a single path string or an array. Invalid or reserved paths are skipped and reported
 * as failures; valid paths are deleted in a single DB write.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - The namespace to update.
 * @param keyPaths - A dot-notated path string or an array of them.
 * @returns A {@link CoreResult} with the updated record and any skipped-path failures.
 * @throws {JustinError} If DataManager has not been initialized.
 */
const deleteProtectedAttributeKeysByNamespace = async (
  uniqueIdentifier: string,
  namespace: string,
  keyPaths: string | string[],
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier))
    return coreFailureResult(
      'deleteProtectedAttributeKeysByNamespace',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier },
    );
  if (!isNonEmptyString(namespace))
    return coreFailureResult(
      'deleteProtectedAttributeKeysByNamespace',
      JustinErrorCode.VALIDATION_ERROR,
      'namespace must be a non-empty string',
      { uniqueIdentifier },
      { namespace },
    );

  const paths = Array.isArray(keyPaths) ? keyPaths : [keyPaths];
  if (paths.length === 0)
    return coreFailureResult(
      'deleteProtectedAttributeKeysByNamespace',
      JustinErrorCode.VALIDATION_ERROR,
      'at least one keyPath must be provided',
      { uniqueIdentifier },
      { namespace },
    );

  const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);
  if (!existing)
    return coreFailureResult(
      'deleteProtectedAttributeKeysByNamespace',
      JustinErrorCode.NOT_FOUND,
      `protected attributes record not found for (${uniqueIdentifier}/${namespace})`,
      { uniqueIdentifier },
      { namespace },
    );

  const existingId = existing?.id;
  if (!existingId)
    return coreFailureResult(
      'deleteProtectedAttributeKeysByNamespace',
      JustinErrorCode.VALIDATION_ERROR,
      'protected attributes record is missing id',
      { uniqueIdentifier },
      { namespace },
    );

  let updatedProtectedAttributes = isPlainObject(existing.protectedAttributes)
    ? { ...existing.protectedAttributes }
    : {};

  const skipCollector = makeLoopFailureCollector<ProtectedAttributesRecord>(
    'deleteProtectedAttributeKeysByNamespace',
    { uniqueIdentifier },
  );

  for (const keyPath of paths) {
    const pathSegments = getPathSegments(keyPath);

    if (pathSegments.length === 0) {
      skipCollector.push(
        JustinErrorCode.VALIDATION_ERROR,
        'keyPath must be a non-empty dot-notated string',
        { namespace, keyPath },
      );
      continue;
    }
    if (!_isValidKeyPath(keyPath)) {
      skipCollector.push(
        JustinErrorCode.VALIDATION_ERROR,
        'keyPath contains a reserved or dangerous segment (id, uniqueIdentifier, namespace, __proto__, constructor, prototype)',
        { namespace, keyPath },
      );
      continue;
    }

    updatedProtectedAttributes = deleteValueAtPath(updatedProtectedAttributes, keyPath);
  }

  const updateResult = unwrapSuccess<object, ProtectedAttributesRecord>(
    await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, existingId, {
      protectedAttributes: updatedProtectedAttributes,
    }),
    'deleteProtectedAttributeKeysByNamespace',
    { uniqueIdentifier },
    { namespace },
  );
  if (!updateResult.ok) {
    return coreFailure([...skipCollector.failures, ...updateResult.failures]);
  }

  const updated = updateResult.successes[0] as ProtectedAttributesRecord;
  upsertProtectedAttributesInCache(updated);
  return skipCollector.hasFailures
    ? coreFailure(skipCollector.failures, [updated])
    : coreSuccess([updated]);
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  getProtectedAttributes,
  getAllProtectedAttributes,
  setProtectedAttributes,
  setProtectedAttributeKeysByNamespace,
  deleteProtectedAttributeNamespaces,
  deleteAllProtectedAttributes,
  deleteProtectedAttributeKeysByNamespace,
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
  _isValidKeyPath,
  _upsertSingleProtectedAttributesRecord,
};
