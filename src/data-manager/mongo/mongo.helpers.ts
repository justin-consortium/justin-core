import * as mongoDB from 'mongodb';
import { Log } from '../../logger/logger-manager'

/**
 * Safely converts a string to a MongoDB `ObjectId`.
 *
 * Attempts to create an `ObjectId` from `id`. If conversion fails, logs and
 * returns `null` instead of throwing.
 *
 * @param id - The string to convert into an `ObjectId`.
 * @returns The created `ObjectId` or `null` if the format is invalid.
 */
export const toObjectId = (id: string | null | undefined): mongoDB.ObjectId | null => {
  if (!id || typeof id !== 'string') {
    Log.error(`Invalid ObjectId format: ${id}`);
    return null;
  }

  try {
    return new mongoDB.ObjectId(id);
  } catch {
    Log.error(`Invalid ObjectId format: ${id}`);
    return null;
  }
};

/**
 * Coerces an `IndexSpecification` into what the driver expects for
 * `IndexDescription.key` (either a plain object or a Map).
 *
 * Keeps the shape predictable for `createIndexes`.
 *
 * @param key - The index specification in any supported form.
 * @returns A plain object or Map keyed by field name to direction.
 */
export const asIndexKey = (
  key: mongoDB.IndexSpecification
):
  | Record<string, mongoDB.IndexDirection>
  | Map<string, mongoDB.IndexDirection> => {
  if (typeof key === "string") {
    // "field" -> { field: 1 }
    return { [key]: 1 };
  }
  if (Array.isArray(key)) {
    // Cast via unknown so TS is happy with tuple shape.
    const tuples = key as unknown as Array<[string, mongoDB.IndexDirection]>;
    const out: Record<string, mongoDB.IndexDirection> = {};
    for (const [k, v] of tuples) out[String(k)] = v;
    return out;
  }
  if (key instanceof Map) {
    return key as Map<string, mongoDB.IndexDirection>;
  }
  // assume plain object { a: 1 }
  return key as Record<string, mongoDB.IndexDirection>;
};

/**
 * Builds a stable string signature for an index key so we can compare
 * "same index different name" situations. Helpful for idempotency checks.
 *
 * Examples:
 * - { a: 1, b: -1 }      → "a:1|b:-1"
 * - [ ['a', 1], ['b', -1] ] → "a:1|b:-1"
 * - "field"               → "field:1"
 * - Map([['a',1]])        → "a:1"
 *
 * @param key - The index specification in any supported form.
 * @returns A stable signature string for the key shape.
 */
export const normalizeIndexKey = (key: mongoDB.IndexSpecification): string => {
  if (typeof key === "string") {
    return `${key}:1`;
  }

  if (Array.isArray(key)) {
    const tuples = key as unknown as Array<[string, mongoDB.IndexDirection]>;
    return tuples.map(([k, v]) => `${String(k)}:${String(v)}`).join("|");
  }

  if (key instanceof Map) {
    return Array.from(key.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${String(k)}:${String(v)}`)
      .join("|");
  }

  const obj = key as Record<string, unknown>;
  return Object.entries(obj)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${String(v)}`)
    .join("|");
};
