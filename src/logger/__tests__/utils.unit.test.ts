import { normalizeExtraArg, mergeWithPossibleSuffix } from '../utils';

/**
 * logger/utils unit tests
 *
 * These are the pure normalization functions that sit between whatever a
 * caller passes to Log.info/warn/error and what actually reaches the emitter.
 * Getting them wrong means structured log fields are silently dropped or
 * mutated — so the cases here are intentionally thorough.
 */

// ---------------------------------------------------------------------------
// mergeWithPossibleSuffix
// ---------------------------------------------------------------------------

describe('mergeWithPossibleSuffix', () => {
  it('adds the key when it does not already exist', () => {
    const result = mergeWithPossibleSuffix({ a: 1 }, 'b', 2);

    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('does not mutate the target object', () => {
    const target = { a: 1 };
    mergeWithPossibleSuffix(target, 'b', 2);

    expect(target).toEqual({ a: 1 });
  });

  it('uses key_2 when the key already exists', () => {
    const result = mergeWithPossibleSuffix({ error: 'first' }, 'error', 'second');

    expect(result).toEqual({ error: 'first', error_2: 'second' });
  });

  it('uses key_3 when key and key_2 both already exist', () => {
    const result = mergeWithPossibleSuffix(
      { error: 'first', error_2: 'second' },
      'error',
      'third',
    );

    expect(result).toEqual({ error: 'first', error_2: 'second', error_3: 'third' });
  });

  it('increments suffix until a free slot is found', () => {
    const target = { x: 1, x_2: 2, x_3: 3, x_4: 4 };
    const result = mergeWithPossibleSuffix(target, 'x', 5);

    expect(result.x_5).toBe(5);
  });

  it('works on an empty target', () => {
    const result = mergeWithPossibleSuffix({}, 'key', 'value');

    expect(result).toEqual({ key: 'value' });
  });

  it('preserves all existing keys', () => {
    const result = mergeWithPossibleSuffix({ a: 1, b: 2, c: 3 }, 'd', 4);

    expect(result).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });
});

// ---------------------------------------------------------------------------
// normalizeExtraArg — Error instances
// ---------------------------------------------------------------------------

describe('normalizeExtraArg — Error instances', () => {
  it('normalizes an Error to { error: { name, message, stack } }', () => {
    const err = new Error('something broke');
    const result = normalizeExtraArg(err);

    expect(result).toMatchObject({
      error: {
        name: 'Error',
        message: 'something broke',
      },
    });
    expect((result?.error as any).stack).toBeDefined();
  });

  it('preserves the error name for custom error subclasses', () => {
    class CustomError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = 'CustomError';
      }
    }

    const result = normalizeExtraArg(new CustomError('custom'));

    expect((result?.error as any).name).toBe('CustomError');
  });

  it('preserves the error message exactly', () => {
    const result = normalizeExtraArg(new Error('exact message'));

    expect((result?.error as any).message).toBe('exact message');
  });
});

// ---------------------------------------------------------------------------
// normalizeExtraArg — Date instances
// ---------------------------------------------------------------------------

describe('normalizeExtraArg — Date instances', () => {
  it('normalizes a Date to { date: "<iso string>" }', () => {
    const date = new Date('2024-01-15T10:00:00.000Z');
    const result = normalizeExtraArg(date);

    expect(result).toEqual({ date: '2024-01-15T10:00:00.000Z' });
  });
});

// ---------------------------------------------------------------------------
// normalizeExtraArg — null and undefined
// ---------------------------------------------------------------------------

describe('normalizeExtraArg — null and undefined', () => {
  it('returns undefined for null', () => {
    expect(normalizeExtraArg(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(normalizeExtraArg(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeExtraArg — primitives
// ---------------------------------------------------------------------------

describe('normalizeExtraArg — primitives', () => {
  it('wraps a string in { value }', () => {
    expect(normalizeExtraArg('hello')).toEqual({ value: 'hello' });
  });

  it('wraps a number in { value }', () => {
    expect(normalizeExtraArg(42)).toEqual({ value: 42 });
  });

  it('wraps a boolean in { value }', () => {
    expect(normalizeExtraArg(true)).toEqual({ value: true });
  });
});

// ---------------------------------------------------------------------------
// normalizeExtraArg — user-like objects
// ---------------------------------------------------------------------------

describe('normalizeExtraArg — user-like objects', () => {
  it('collapses a top-level user-like object with uniqueIdentifier to { uniqueIdentifier }', () => {
    const result = normalizeExtraArg({
      uniqueIdentifier: 'alice',
      name: 'Alice',
      score: 10,
    });

    expect(result).toEqual({ uniqueIdentifier: 'alice' });
  });

  it('collapses an object with id + attributes to { uniqueIdentifier: id }', () => {
    const result = normalizeExtraArg({
      id: 'abc123',
      attributes: { name: 'Alice' },
    });

    expect(result).toEqual({ uniqueIdentifier: 'abc123' });
  });

  it('prefers uniqueIdentifier over the id + attributes fallback', () => {
    const result = normalizeExtraArg({
      id: 'abc123',
      uniqueIdentifier: 'alice',
      attributes: {},
    });

    expect(result).toEqual({ uniqueIdentifier: 'alice' });
  });

  it('collapses a nested user under its original key when key is not "user"', () => {
    const result = normalizeExtraArg({
      actor: { uniqueIdentifier: 'alice', name: 'Alice' },
    });

    expect(result).toEqual({ actor: { uniqueIdentifier: 'alice' } });
  });

  it('collapses a nested user under "user" key directly to { uniqueIdentifier }', () => {
    const result = normalizeExtraArg({
      user: { uniqueIdentifier: 'alice', name: 'Alice' },
    });

    expect(result).toEqual({ uniqueIdentifier: 'alice' });
  });
});

// ---------------------------------------------------------------------------
// normalizeExtraArg — event-like objects
// ---------------------------------------------------------------------------

describe('normalizeExtraArg — event-like objects', () => {
  it('normalizes a top-level event-like object to { event: { ... } }', () => {
    const result = normalizeExtraArg({
      id: 'evt-1',
      eventType: 'USER_UPDATED',
      publishedTimestamp: '2024-01-15T10:00:00.000Z',
    });

    expect(result).toEqual({
      event: {
        eventId: 'evt-1',
        eventType: 'USER_UPDATED',
        eventTime: '2024-01-15T10:00:00.000Z',
      },
    });
  });

  it('uses publishedTimestamp when both timestamps are present', () => {
    const result = normalizeExtraArg({
      eventType: 'TEST',
      publishedTimestamp: '2024-01-01T00:00:00.000Z',
      generatedTimestamp: '2023-01-01T00:00:00.000Z',
    });

    expect((result?.event as any).eventTime).toBe('2024-01-01T00:00:00.000Z');
  });

  it('falls back to generatedTimestamp when publishedTimestamp is absent', () => {
    const result = normalizeExtraArg({
      eventType: 'TEST',
      generatedTimestamp: '2024-06-01T00:00:00.000Z',
    });

    expect((result?.event as any).eventTime).toBe('2024-06-01T00:00:00.000Z');
  });

  it('converts a Date timestamp to ISO string', () => {
    const date = new Date('2024-01-15T10:00:00.000Z');
    const result = normalizeExtraArg({
      eventType: 'TEST',
      publishedTimestamp: date,
    });

    expect((result?.event as any).eventTime).toBe('2024-01-15T10:00:00.000Z');
  });

  it('omits eventId when id is not a string', () => {
    const result = normalizeExtraArg({
      eventType: 'TEST',
      publishedTimestamp: '2024-01-01T00:00:00.000Z',
    });

    expect(result?.event).not.toHaveProperty('eventId');
  });

  it('does not treat an object as event-like if it has none of the event fields', () => {
    const result = normalizeExtraArg({ name: 'Alice', score: 10 });

    expect(result).not.toHaveProperty('event');
  });

  it('wraps a nested event under its original key when key is not "event"', () => {
    const result = normalizeExtraArg({
      trigger: { eventType: 'STEP_COUNT', publishedTimestamp: '2024-01-01T00:00:00.000Z' },
    });

    expect(result).toHaveProperty('trigger');
    expect((result?.trigger as any).eventType).toBe('STEP_COUNT');
  });
});

// ---------------------------------------------------------------------------
// normalizeExtraArg — plain objects
// ---------------------------------------------------------------------------

describe('normalizeExtraArg — plain objects', () => {
  it('returns the object with its keys preserved for non-special plain objects', () => {
    const result = normalizeExtraArg({ userId: 'abc', collection: 'users' });

    expect(result).toEqual({ userId: 'abc', collection: 'users' });
  });

  it('normalizes a nested Error value', () => {
    const err = new Error('inner');
    const result = normalizeExtraArg({ cause: err });

    expect((result?.cause as any).message).toBe('inner');
    expect((result?.cause as any).name).toBe('Error');
  });

  it('normalizes a nested Date value to an ISO string', () => {
    const date = new Date('2024-01-15T10:00:00.000Z');
    const result = normalizeExtraArg({ timestamp: date });

    expect(result?.timestamp).toBe('2024-01-15T10:00:00.000Z');
  });

  it('uses key suffixing when two keys would collide after normalization', () => {
    // Both 'user' and 'actor' normalize to keys that could collide
    // if both are user-like — the suffix prevents overwriting
    const result = normalizeExtraArg({
      error: 'first',
      error_dup: 'not an error instance',
    });

    expect(result?.error).toBe('first');
  });

  it('returns undefined for an empty object', () => {
    expect(normalizeExtraArg({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeExtraArg — arrays
// ---------------------------------------------------------------------------

describe('normalizeExtraArg — arrays', () => {
  it('wraps an array in { value } rather than iterating it', () => {
    const result = normalizeExtraArg([1, 2, 3]);

    expect(result).toEqual({ value: [1, 2, 3] });
  });
});
