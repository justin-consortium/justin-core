import type { LedgerDiff } from './types';

/**
 * Computes a deep, path-keyed diff between two plain-object snapshots.
 *
 * Keys use dot notation for nested fields (`"address.city"`, `"tags.0"`) and
 * only leaf-level changes are recorded — intermediate path segments are not
 * emitted on their own.
 *
 * Arrays are treated as indexed objects so individual element changes surface
 * as `"tags.0"`, `"tags.1"` rather than replacing the whole array.
 *
 * Two values are considered equal when `JSON.stringify(a) === JSON.stringify(b)`
 * at the leaf level, which handles nested objects, arrays, and `null` uniformly
 * without requiring a deep-equal library.
 *
 * @param prev   - The snapshot before the write. Pass `{}` for ADD operations.
 * @param next   - The snapshot after the write. Pass `{}` for DELETE operations.
 * @param prefix - Internal recursion prefix — callers should omit this.
 *
 * @example
 * ```ts
 * deepDiff(
 *   { name: 'Alice', address: { city: 'Detroit' } },
 *   { name: 'Alice', address: { city: 'Dearborn' }, score: 10 },
 * );
 * // {
 * //   added:   { score: 10 },
 * //   changed: { 'address.city': { from: 'Detroit', to: 'Dearborn' } },
 * //   removed: {},
 * // }
 * ```
 */
const deepDiff = (
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  prefix = '',
): LedgerDiff => {
  const added: Record<string, unknown> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const removed: Record<string, unknown> = {};

  const prevKeys = new Set(Object.keys(prev));
  const nextKeys = new Set(Object.keys(next));

  for (const key of nextKeys) {
    if (!prevKeys.has(key)) {
      _flattenInto(added, prefix ? `${prefix}.${key}` : key, next[key]);
    }
  }

  for (const key of prevKeys) {
    if (!nextKeys.has(key)) {
      _flattenInto(removed, prefix ? `${prefix}.${key}` : key, prev[key]);
    }
  }

  for (const key of prevKeys) {
    if (!nextKeys.has(key)) continue;

    const path = prefix ? `${prefix}.${key}` : key;
    const prevVal = prev[key];
    const nextVal = next[key];

    if (_isPlainObject(prevVal) && _isPlainObject(nextVal)) {
      const nested = deepDiff(
        prevVal as Record<string, unknown>,
        nextVal as Record<string, unknown>,
        path,
      );
      Object.assign(added, nested.added);
      Object.assign(changed, nested.changed);
      Object.assign(removed, nested.removed);
    } else if (Array.isArray(prevVal) && Array.isArray(nextVal)) {
      const nested = deepDiff(_arrayToIndexedObject(prevVal), _arrayToIndexedObject(nextVal), path);
      Object.assign(added, nested.added);
      Object.assign(changed, nested.changed);
      Object.assign(removed, nested.removed);
    } else if (!_leafEqual(prevVal, nextVal)) {
      changed[path] = { from: prevVal, to: nextVal };
    }
  }

  return { added, changed, removed };
};

/**
 * Builds the {@link LedgerDiff} for an ADD operation.
 * All fields in `snapshot` are placed in `added`.
 *
 * @param snapshot - The inserted record's post-image.
 */
const diffForAdd = (snapshot: Record<string, unknown>): LedgerDiff => deepDiff({}, snapshot);

/**
 * Builds the {@link LedgerDiff} for an UPDATE operation.
 *
 * @param prev - The snapshot from the most recent open ledger entry.
 * @param next - The post-image returned by the DataManager update.
 */
const diffForUpdate = (prev: Record<string, unknown>, next: Record<string, unknown>): LedgerDiff =>
  deepDiff(prev, next);

/**
 * Builds the {@link LedgerDiff} for a DELETE operation.
 * All fields in `snapshot` are placed in `removed`.
 *
 * @param snapshot - The last known snapshot sourced from the open ledger entry.
 */
const diffForDelete = (snapshot: Record<string, unknown>): LedgerDiff => deepDiff(snapshot, {});

/**
 * Returns an empty diff.
 * Used when no snapshot is available (e.g. record never written through DataManager).
 */
const emptyDiff = (): LedgerDiff => ({ added: {}, changed: {}, removed: {} });

const _isPlainObject = (val: unknown): val is Record<string, unknown> =>
  val !== null && typeof val === 'object' && !Array.isArray(val);

const _arrayToIndexedObject = (arr: unknown[]): Record<string, unknown> =>
  Object.fromEntries(arr.map((v, i) => [String(i), v]));

const _leafEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

/**
 * Flattens a (possibly nested) value into `target` under `path`.
 *
 * Nested objects and arrays are recursed so that an entirely new or removed
 * subtree records all its leaf paths individually rather than collapsing the
 * whole object under a single key.
 *
 * @internal
 */
const _flattenInto = (target: Record<string, unknown>, path: string, val: unknown): void => {
  if (_isPlainObject(val)) {
    for (const [k, v] of Object.entries(val)) {
      _flattenInto(target, `${path}.${k}`, v);
    }
  } else if (Array.isArray(val)) {
    val.forEach((v, i) => _flattenInto(target, `${path}.${i}`, v));
  } else {
    target[path] = val;
  }
};

export { deepDiff, diffForAdd, diffForUpdate, diffForDelete, emptyDiff };
