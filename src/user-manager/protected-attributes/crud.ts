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
  getProtectedAttributesByUniqueIdentifier as getProtectedAttributesByNamespacesFromCache,
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
 * Returns false if a path string contains any reserved key segments.
 *
 * @param keyPath - The dot-notated path to check.
 * @returns True if the path is safe; false if it contains a reserved segment.
 * @private
 */
const _isValidKeyPath = (keyPath: string): boolean => {
  const segments = getPathSegments(keyPath);
  for (const segment of segments) {
    if (RESERVED_PROTECTED_ATTRIBUTE_KEYS.includes(segment)) return false;
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
 * {@link setProtectedAttributesByUniqueIdentifier} can collect successes and
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
 * @throws {JustinError} If DataManager has not been initialized.
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
const setProtectedAttributesByUniqueIdentifier = async (
  uniqueIdentifier: string,
  input: NamespacedAttributes | NamespacedAttributes[],
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier))
    return coreFailureResult(
      'setProtectedAttributesByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier },
    );

  const items = _normalizeNamespacedAttributesInput(input);
  if (items.length === 0) return coreSuccess([]);

  const successes: ProtectedAttributesRecord[] = [];
  const collector = makeLoopFailureCollector<ProtectedAttributesRecord>(
    'setProtectedAttributesByUniqueIdentifier',
    { uniqueIdentifier },
  );

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
 * Updates a single nested key path within a namespace-scoped protected attributes object.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - The namespace to update.
 * @param keyPath - The key path to update.
 * @param value - The value to set.
 * @returns A {@link CoreResult} containing the updated record on success, or a failure with
 *   `VALIDATION_ERROR` for invalid input or `NOT_FOUND` if no record exists for the namespace.
 * @throws {JustinError} If DataManager has not been initialized.
 */
const updateProtectedAttributeByUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespace: string,
  keyPath: string,
  value: any,
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  const fail = (code: string, reason: string) =>
    coreFailureResult<ProtectedAttributesRecord>(
      'updateProtectedAttributeByUniqueIdentifier',
      code,
      reason,
      { uniqueIdentifier },
      { namespace, keyPath },
    );

  if (!isNonEmptyString(uniqueIdentifier))
    return fail(JustinErrorCode.VALIDATION_ERROR, 'uniqueIdentifier must be a non-empty string');
  if (!isNonEmptyString(namespace))
    return fail(JustinErrorCode.VALIDATION_ERROR, 'namespace must be a non-empty string');

  const pathSegments = getPathSegments(keyPath);
  if (pathSegments.length === 0)
    return fail(JustinErrorCode.VALIDATION_ERROR, 'keyPath must be a non-empty dot-notated string');
  if (!_isValidKeyPath(keyPath))
    return fail(
      JustinErrorCode.VALIDATION_ERROR,
      'keyPath contains a reserved segment (id, uniqueIdentifier, namespace)',
    );
  if (!assertNoReservedKeysDeep(value, RESERVED_PROTECTED_ATTRIBUTE_KEYS))
    return fail(
      JustinErrorCode.VALIDATION_ERROR,
      'value contains reserved keys (id, uniqueIdentifier, namespace)',
    );

  const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);
  if (!existing)
    return fail(
      JustinErrorCode.NOT_FOUND,
      `protected attributes record not found for (${uniqueIdentifier}/${namespace})`,
    );

  const existingId = existing?.id;
  if (!existingId)
    return fail(JustinErrorCode.VALIDATION_ERROR, 'protected attributes record is missing id');

  const currentProtectedAttributes = isPlainObject(existing.protectedAttributes)
    ? existing.protectedAttributes
    : {};

  const updatedProtectedAttributes = setValueAtPath(currentProtectedAttributes, keyPath, value);

  const updateResult = unwrapSuccess<object, ProtectedAttributesRecord>(
    await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, existingId, {
      protectedAttributes: updatedProtectedAttributes,
    }),
    'updateProtectedAttributeByUniqueIdentifier',
    { uniqueIdentifier },
    { namespace, keyPath },
  );
  if (!updateResult.ok) return updateResult;

  const updated = updateResult.successes[0] as ProtectedAttributesRecord;
  upsertProtectedAttributesInCache(updated);
  return coreSuccess([updated]);
};

/**
 * Updates multiple nested key paths within a namespace-scoped protected attributes object.
 *
 * Every skipped entry carries `uniqueIdentifier`, `namespace`, `keyPath`, `code`, and
 * `reason` so callers have the complete picture without correlating back to call arguments.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - The namespace to update.
 * @param updates - An object whose keys are path strings and values are the values to set.
 * @returns A {@link CoreResult} with the updated record and any skipped-path failures.
 * @throws {JustinError} If DataManager has not been initialized.
 */
const updateProtectedAttributesByUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespace: string,
  updates: Record<string, any>,
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier))
    return coreFailureResult(
      'updateProtectedAttributesByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier },
    );
  if (!isNonEmptyString(namespace))
    return coreFailureResult(
      'updateProtectedAttributesByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'namespace must be a non-empty string',
      { uniqueIdentifier },
      { namespace },
    );
  if (!isPlainObject(updates))
    return coreFailureResult(
      'updateProtectedAttributesByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'updates must be a plain object',
      { uniqueIdentifier },
      { namespace },
    );

  const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);
  if (!existing)
    return coreFailureResult(
      'updateProtectedAttributesByUniqueIdentifier',
      JustinErrorCode.NOT_FOUND,
      `protected attributes record not found for (${uniqueIdentifier}/${namespace})`,
      { uniqueIdentifier },
      { namespace },
    );

  const existingId = existing?.id;
  if (!existingId)
    return coreFailureResult(
      'updateProtectedAttributesByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'protected attributes record is missing id',
      { uniqueIdentifier },
      { namespace },
    );

  let updatedProtectedAttributes = isPlainObject(existing.protectedAttributes)
    ? { ...existing.protectedAttributes }
    : {};

  const skipCollector = makeLoopFailureCollector<ProtectedAttributesRecord>(
    'updateProtectedAttributesByUniqueIdentifier',
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
        'keyPath contains a reserved segment (id, uniqueIdentifier, namespace)',
        { namespace, keyPath },
      );
      continue;
    }
    if (!assertNoReservedKeysDeep(value, RESERVED_PROTECTED_ATTRIBUTE_KEYS)) {
      skipCollector.push(
        JustinErrorCode.VALIDATION_ERROR,
        'value contains reserved keys (id, uniqueIdentifier, namespace)',
        { namespace, keyPath },
      );
      continue;
    }

    updatedProtectedAttributes = setValueAtPath(updatedProtectedAttributes, keyPath, value);
  }

  const updateResult = unwrapSuccess<object, ProtectedAttributesRecord>(
    await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, existingId, {
      protectedAttributes: updatedProtectedAttributes,
    }),
    'updateProtectedAttributesByUniqueIdentifier',
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
const deleteProtectedAttributesByUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespaces: string | string[],
): Promise<CoreResult<null>> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier))
    return coreFailureResult(
      'deleteProtectedAttributesByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier },
    );

  const namespaceList = Array.isArray(namespaces) ? namespaces : [namespaces];
  if (namespaceList.length === 0)
    return coreFailureResult(
      'deleteProtectedAttributesByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'at least one namespace must be provided',
      { uniqueIdentifier },
    );

  const validNamespaces = namespaceList.filter(isNonEmptyString);
  if (validNamespaces.length === 0)
    return coreFailureResult(
      'deleteProtectedAttributesByUniqueIdentifier',
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
      'deleteProtectedAttributesByUniqueIdentifier',
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
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @throws {JustinError} If DataManager has not been initialized.
 */
const deleteAllProtectedAttributesByUniqueIdentifier = async (
  uniqueIdentifier: string,
): Promise<void> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier)) return;

  const docs = await dm.findItemsInCollection<ProtectedAttributesRecord>(PROTECTED_ATTRIBUTES, {
    uniqueIdentifier,
  });

  const ids = docs
    .map((doc: ProtectedAttributesRecord) => doc?.id)
    .filter((id: string | undefined): id is string => typeof id === 'string');

  if (ids.length > 0) {
    await dm.removeItemsFromCollection(PROTECTED_ATTRIBUTES, ids);
  }

  deleteProtectedAttributesByUniqueIdentifierFromCache(uniqueIdentifier);
};

/**
 * Deletes a single nested key path within a namespace-scoped protected attributes object.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - The namespace to update.
 * @param keyPath - The key path to delete.
 * @returns A {@link CoreResult} containing the updated record on success, or a failure with
 *   `VALIDATION_ERROR` for invalid input or `NOT_FOUND` if no record exists for the namespace.
 * @throws {JustinError} If DataManager has not been initialized.
 */
const deleteProtectedAttributeByUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespace: string,
  keyPath: string,
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  const fail = (code: string, reason: string) =>
    coreFailureResult<ProtectedAttributesRecord>(
      'deleteProtectedAttributeByUniqueIdentifier',
      code,
      reason,
      { uniqueIdentifier },
      { namespace, keyPath },
    );

  if (!isNonEmptyString(uniqueIdentifier))
    return fail(JustinErrorCode.VALIDATION_ERROR, 'uniqueIdentifier must be a non-empty string');
  if (!isNonEmptyString(namespace))
    return fail(JustinErrorCode.VALIDATION_ERROR, 'namespace must be a non-empty string');

  const pathSegments = getPathSegments(keyPath);
  if (pathSegments.length === 0)
    return fail(JustinErrorCode.VALIDATION_ERROR, 'keyPath must be a non-empty dot-notated string');
  if (!_isValidKeyPath(keyPath))
    return fail(
      JustinErrorCode.VALIDATION_ERROR,
      'keyPath contains a reserved segment (id, uniqueIdentifier, namespace)',
    );

  const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);
  if (!existing)
    return fail(
      JustinErrorCode.NOT_FOUND,
      `protected attributes record not found for (${uniqueIdentifier}/${namespace})`,
    );

  const existingId = existing?.id;
  if (!existingId)
    return fail(JustinErrorCode.VALIDATION_ERROR, 'protected attributes record is missing id');

  const currentProtectedAttributes = isPlainObject(existing.protectedAttributes)
    ? existing.protectedAttributes
    : {};

  const updatedProtectedAttributes = deleteValueAtPath(currentProtectedAttributes, keyPath);

  const updateResult = unwrapSuccess<object, ProtectedAttributesRecord>(
    await dm.updateItemByIdInCollection(PROTECTED_ATTRIBUTES, existingId, {
      protectedAttributes: updatedProtectedAttributes,
    }),
    'deleteProtectedAttributeByUniqueIdentifier',
    { uniqueIdentifier },
    { namespace, keyPath },
  );
  if (!updateResult.ok) return updateResult;

  const updated = updateResult.successes[0] as ProtectedAttributesRecord;
  upsertProtectedAttributesInCache(updated);
  return coreSuccess([updated]);
};

/**
 * Deletes multiple nested key paths within a namespace-scoped protected attributes object.
 *
 * Every skipped entry carries `uniqueIdentifier`, `namespace`, `keyPath`, `code`, and
 * `reason` so callers have the complete picture without correlating back to call arguments.
 *
 * @param uniqueIdentifier - The user's uniqueIdentifier.
 * @param namespace - The namespace to update.
 * @param keyPaths - A path string or array of path strings to delete.
 * @returns A {@link CoreResult} with the updated record and any skipped-path failures.
 * @throws {JustinError} If DataManager has not been initialized.
 */
const deleteProtectedAttributesFromNamespaceByUniqueIdentifier = async (
  uniqueIdentifier: string,
  namespace: string,
  keyPaths: string | string[],
): Promise<CoreResult<ProtectedAttributesRecord>> => {
  _checkInitialization();

  if (!isNonEmptyString(uniqueIdentifier))
    return coreFailureResult(
      'deleteProtectedAttributesFromNamespaceByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'uniqueIdentifier must be a non-empty string',
      { uniqueIdentifier },
    );
  if (!isNonEmptyString(namespace))
    return coreFailureResult(
      'deleteProtectedAttributesFromNamespaceByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'namespace must be a non-empty string',
      { uniqueIdentifier },
      { namespace },
    );

  const paths = Array.isArray(keyPaths) ? keyPaths : [keyPaths];
  if (paths.length === 0)
    return coreFailureResult(
      'deleteProtectedAttributesFromNamespaceByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'at least one keyPath must be provided',
      { uniqueIdentifier },
      { namespace },
    );

  const existing = await _findProtectedAttributesRecord(uniqueIdentifier, namespace);
  if (!existing)
    return coreFailureResult(
      'deleteProtectedAttributesFromNamespaceByUniqueIdentifier',
      JustinErrorCode.NOT_FOUND,
      `protected attributes record not found for (${uniqueIdentifier}/${namespace})`,
      { uniqueIdentifier },
      { namespace },
    );

  const existingId = existing?.id;
  if (!existingId)
    return coreFailureResult(
      'deleteProtectedAttributesFromNamespaceByUniqueIdentifier',
      JustinErrorCode.VALIDATION_ERROR,
      'protected attributes record is missing id',
      { uniqueIdentifier },
      { namespace },
    );

  let updatedProtectedAttributes = isPlainObject(existing.protectedAttributes)
    ? { ...existing.protectedAttributes }
    : {};

  const skipCollector = makeLoopFailureCollector<ProtectedAttributesRecord>(
    'deleteProtectedAttributesFromNamespaceByUniqueIdentifier',
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
        'keyPath contains a reserved segment (id, uniqueIdentifier, namespace)',
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
    'deleteProtectedAttributesFromNamespaceByUniqueIdentifier',
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
  _isValidKeyPath,
  _upsertSingleProtectedAttributesRecord,
};
