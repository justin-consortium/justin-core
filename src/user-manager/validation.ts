/**
 * Returns true if `value` is a string with at least one non-whitespace character.
 *
 * @param value - Unknown input.
 * @returns True if the value is a non-empty string.
 */
const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

/**
 * Trims a string and returns it if non-empty; otherwise returns null.
 *
 * @param value - Unknown input.
 * @returns Cleaned string or null.
 */
const cleanString = (value: unknown): string | null => {
  if (!isNonEmptyString(value)) return null;
  return value.trim();
};

/**
 * Validates a namespace-like input. Returns cleaned string or null.
 *
 * @param namespace - Unknown input.
 * @returns Cleaned namespace or null.
 */
const cleanNamespace = (namespace: unknown): string | null => {
  return cleanString(namespace);
};

/**
 * Returns true if `value` is a non-null object and not an array.
 *
 * @param value - Unknown input.
 * @returns True if value is a plain object.
 */
const isPlainObject = (value: unknown): value is Record<string, any> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Asserts that the provided object does NOT include any reserved keys.
 * This is considered a programmer error / invariant violation and should throw.
 *
 * @param obj - The object to check.
 * @param reservedKeys - Keys that must not be present.
 * @param errorMessage - Optional custom error message.
 * @throws {Error} If any reserved key is present in `obj`.
 */
const assertNoReservedKeys = (
  obj: unknown,
  reservedKeys: string[],
  errorMessage?: string,
): void => {
  if (!isPlainObject(obj)) return;

  for (const key of reservedKeys) {
    if (key in obj) {
      throw new Error(errorMessage ?? `Cannot update reserved field "${key}".`);
    }
  }
};

/**
 * Returns a shallow copy of `obj` without the specified keys.
 *
 * @param obj - Source object.
 * @param keys - Keys to remove.
 * @returns A copy without the specified keys.
 */
const omitKeys = <T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Omit<T, K> => {
  const copy = { ...obj } as T;

  for (const key of keys) {
    delete copy[key];
  }

  return copy as Omit<T, K>;
};

export {
  isNonEmptyString,
  cleanString,
  cleanNamespace,
  isPlainObject,
  assertNoReservedKeys,
  omitKeys,
};
