/**
 * Duck-type shape used to detect user-like objects during log normalization.
 * Intentionally generic — the logger has no dependency on domain types.
 */
type UserLike = {
  uniqueIdentifier?: unknown;
  id?: unknown;
  attributes?: unknown;
};

/**
 * Duck-type shape used to detect event-like objects during log normalization.
 */
type EventLike = {
  id?: unknown;
  eventType?: unknown;
  publishedTimestamp?: unknown;
  generatedTimestamp?: unknown;
};

/**
 * Returns a new object with `key` added. If the key already exists a numeric
 * suffix is appended (`key_2`, `key_3`, …) so existing data is never overwritten.
 *
 * Pure — does not mutate `target`.
 *
 * @param target - The object to extend.
 * @param key - The desired property name.
 * @param value - The value to set.
 */
function mergeWithPossibleSuffix(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  if (!(key in target)) return { ...target, [key]: value };

  let i = 2;
  let candidate = `${key}_${i}`;
  while (candidate in target) {
    i++;
    candidate = `${key}_${i}`;
  }

  return { ...target, [candidate]: value };
}

/**
 * Attempts to extract a normalized user shape from an unknown value.
 *
 * Considers the value user-like if it has a `uniqueIdentifier` string, or
 * both an `id` string and an `attributes` object. Always normalizes to
 * `{ uniqueIdentifier }`.
 *
 * @param value - Value that might be user-like.
 * @returns Normalized user object or `undefined`.
 */
function extractFromUserLike(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const maybe = value as UserLike;

  if (typeof maybe.uniqueIdentifier === 'string') {
    return { uniqueIdentifier: maybe.uniqueIdentifier };
  }

  if (
    typeof maybe.id === 'string' &&
    typeof maybe.attributes === 'object' &&
    maybe.attributes !== null
  ) {
    return { uniqueIdentifier: maybe.id };
  }

  return undefined;
}

/**
 * Attempts to extract a normalized event shape from an unknown value.
 *
 * Considers the value event-like if it carries at least one of `eventType`,
 * `publishedTimestamp`, or `generatedTimestamp`. Normalizes to
 * `{ eventId?, eventType?, eventTime? }`.
 *
 * @param value - Value that might be event-like.
 * @returns Normalized event object or `undefined`.
 */
function extractFromEventLike(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const maybe = value as EventLike;

  if (!maybe.eventType && !maybe.publishedTimestamp && !maybe.generatedTimestamp) {
    return undefined;
  }

  const out: Record<string, unknown> = {};

  if (typeof maybe.id === 'string') out.eventId = maybe.id;
  if (typeof maybe.eventType === 'string') out.eventType = maybe.eventType;

  const when = maybe.publishedTimestamp ?? maybe.generatedTimestamp;
  if (when instanceof Date) out.eventTime = when.toISOString();
  else if (typeof when === 'string') out.eventTime = when;

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Normalizes a single leaf value to be JSON-log safe.
 *
 * - `Error` → `{ name, message, stack }`
 * - `Date`  → ISO string
 * - everything else → returned as-is
 *
 * @param value - The value to normalize.
 */
function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

/**
 * Normalizes a single property from an extras object.
 *
 * - User-like values are collapsed to `{ uniqueIdentifier }`.
 * - Event-like values are collapsed to `{ eventId?, eventType?, eventTime? }`.
 * - Everything else is normalized via {@link normalizeValue}.
 *
 * @param key - The original property name.
 * @param value - The original property value.
 */
function normalizeObjectEntry(key: string, value: unknown): Record<string, unknown> {
  const userBits = extractFromUserLike(value);
  if (userBits) {
    return key === 'user' ? userBits : { [key]: userBits };
  }

  const eventBits = extractFromEventLike(value);
  if (eventBits) {
    return key === 'event' ? { event: eventBits } : { [key]: eventBits };
  }

  return { [key]: normalizeValue(value) };
}

/**
 * Normalizes a single "extras" argument into a flat object suitable for
 * structured logging.
 *
 * - `Error` → `{ error: { name, message, stack } }`
 * - `Date` → `{ date: '<iso>' }`
 * - User-like object → `{ uniqueIdentifier }`
 * - Event-like object → `{ event: { ... } }`
 * - Plain object → each property normalized and merged, with key suffixing
 *   via {@link mergeWithPossibleSuffix} to avoid collisions
 * - Primitive → `{ value: primitive }`
 *
 * @param arg - The extras value passed to the logger.
 * @returns A flat object of normalized fields, or `undefined` if nothing
 * could be extracted.
 */
function normalizeExtraArg(arg: unknown): Record<string, unknown> | undefined {
  if (arg instanceof Error) return { error: normalizeValue(arg) };
  if (arg instanceof Date) return { date: normalizeValue(arg) };
  if (arg === undefined || arg === null) return undefined;

  if (typeof arg === 'object' && !Array.isArray(arg)) {
    const userBits = extractFromUserLike(arg);
    if (userBits) return userBits;

    const eventBits = extractFromEventLike(arg);
    if (eventBits) return { event: eventBits };

    let out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(arg as Record<string, unknown>)) {
      const partial = normalizeObjectEntry(key, val);
      for (const [pKey, pVal] of Object.entries(partial)) {
        out = mergeWithPossibleSuffix(out, pKey, pVal);
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  return { value: arg };
}

export { mergeWithPossibleSuffix, normalizeExtraArg };
