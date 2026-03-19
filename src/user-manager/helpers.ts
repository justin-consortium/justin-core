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
 * Cleans and filters string values.
 *
 * Invalid strings are removed.
 *
 * @param values - The string values to clean.
 * @returns An array of valid cleaned strings.
 */
const cleanStrings = (values: string[]): string[] => {
  return values
    .map((value: string) => cleanString(value))
    .filter((value): value is string => Boolean(value));
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
 * Returns false if the provided object includes any reserved keys.
 *
 *
 * @param obj - The object to check.
 * @param reservedKeys - Keys that must not be present.
 * @returns `true` if no reserved keys are present; `false` if any reserved key is found.
 */
const assertNoReservedKeys = (obj: unknown, reservedKeys: string[]): boolean => {
  if (!isPlainObject(obj)) return true;

  for (const key of reservedKeys) {
    if (key in obj) return false;
  }

  return true;
};

/**
 * Returns false if the provided value tree includes any reserved keys.
 *
 * Plain objects are traversed by key. Arrays are traversed by element. Primitive
 * values are ignored.
 *
 * @param value - The value tree to inspect.
 * @param reservedKeys - Keys that must not appear anywhere in the tree.
 * @returns `true` if no reserved keys are present anywhere in the tree; `false` otherwise.
 */
const assertNoReservedKeysDeep = (value: unknown, reservedKeys: string[]): boolean => {
  if (Array.isArray(value)) {
    return value.every((item) => assertNoReservedKeysDeep(item, reservedKeys));
  }

  if (!isPlainObject(value)) return true;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (reservedKeys.includes(key)) return false;
    if (!assertNoReservedKeysDeep(nestedValue, reservedKeys)) return false;
  }

  return true;
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

/**
 * Splits a path string into cleaned path segments.
 *
 * Supports dot notation such as "fitbit.steps.today".
 *
 * @param path - The path string to split.
 * @returns An array of cleaned path segments.
 */
const getPathSegments = (path: string): string[] => {
  const cleanedPath = cleanString(path);
  if (!cleanedPath) {
    return [];
  }

  return cleanStrings(cleanedPath.split('.'));
};

/**
 * Sets a value at a nested path in an object.
 *
 * Missing intermediate objects are created as plain objects.
 *
 * @param source - The source object.
 * @param path - The dot-notated path to set.
 * @param value - The value to set at the path.
 * @returns A new object with the value set at the provided path.
 */
const setValueAtPath = (
  source: Record<string, any>,
  path: string,
  value: any,
): Record<string, any> => {
  const segments = getPathSegments(path);
  if (segments.length === 0) {
    return source;
  }

  const result: Record<string, any> = isPlainObject(source) ? { ...source } : {};
  let current: Record<string, any> = result;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] as string;
    const nextValue = current[segment];

    current[segment] = isPlainObject(nextValue) ? { ...nextValue } : {};
    current = current[segment] as Record<string, any>;
  }

  current[segments[segments.length - 1] as string] = value;
  return result;
};

/**
 * Deletes a value at a nested path in an object.
 *
 * Empty parent objects are preserved after deletion.
 *
 * @param source - The source object.
 * @param path - The dot-notated path to delete.
 * @returns A new object with the value removed at the provided path.
 */
const deleteValueAtPath = (source: Record<string, any>, path: string): Record<string, any> => {
  const segments = getPathSegments(path);
  if (segments.length === 0 || !isPlainObject(source)) {
    return isPlainObject(source) ? { ...source } : {};
  }

  const result: Record<string, any> = { ...source };
  let current: Record<string, any> = result;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] as string;
    const nextValue = current[segment];

    if (!isPlainObject(nextValue)) {
      return result;
    }

    current[segment] = { ...nextValue };
    current = current[segment] as Record<string, any>;
  }

  delete current[segments[segments.length - 1] as string];
  return result;
};

export {
  isNonEmptyString,
  cleanString,
  cleanStrings,
  isPlainObject,
  assertNoReservedKeys,
  assertNoReservedKeysDeep,
  omitKeys,
  getPathSegments,
  setValueAtPath,
  deleteValueAtPath,
};
