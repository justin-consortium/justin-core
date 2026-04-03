import {
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
} from '../helpers';

describe('user-manager helpers unit tests', () => {
  describe('isNonEmptyString', () => {
    it('returns true for a regular string', () => {
      expect(isNonEmptyString('hello')).toBe(true);
    });

    it('returns true for a string with spaces in it', () => {
      expect(isNonEmptyString('test mark')).toBe(true);
    });

    it('returns false for an empty string', () => {
      expect(isNonEmptyString('')).toBe(false);
    });

    it('returns false for a whitespace-only string', () => {
      expect(isNonEmptyString('   ')).toBe(false);
    });

    it('returns false for a tab-only string', () => {
      expect(isNonEmptyString('\t')).toBe(false);
    });

    it('returns false for null', () => {
      expect(isNonEmptyString(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isNonEmptyString(undefined)).toBe(false);
    });

    it('returns false for a number', () => {
      expect(isNonEmptyString(42)).toBe(false);
    });

    it('returns false for an object', () => {
      expect(isNonEmptyString({})).toBe(false);
    });

    it('returns false for an array', () => {
      expect(isNonEmptyString([])).toBe(false);
    });

    it('returns false for a boolean', () => {
      expect(isNonEmptyString(true)).toBe(false);
    });
  });

  describe('cleanString', () => {
    it('returns the trimmed string for a valid input', () => {
      expect(cleanString('  hello  ')).toBe('hello');
    });

    it('preserves internal spaces', () => {
      expect(cleanString('  test mark  ')).toBe('test mark');
    });

    it('returns the string unchanged when no trimming is needed', () => {
      expect(cleanString('hello')).toBe('hello');
    });

    it('returns null for an empty string', () => {
      expect(cleanString('')).toBeNull();
    });

    it('returns null for a whitespace-only string', () => {
      expect(cleanString('   ')).toBeNull();
    });

    it('returns null for null', () => {
      expect(cleanString(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(cleanString(undefined)).toBeNull();
    });

    it('returns null for a number', () => {
      expect(cleanString(42)).toBeNull();
    });
  });

  describe('cleanStrings', () => {
    it('trims and returns all valid strings', () => {
      expect(cleanStrings(['  a  ', 'b', '  c  '])).toEqual(['a', 'b', 'c']);
    });

    it('filters out empty strings', () => {
      expect(cleanStrings(['a', '', 'b'])).toEqual(['a', 'b']);
    });

    it('filters out whitespace-only strings', () => {
      expect(cleanStrings(['a', '   ', 'b'])).toEqual(['a', 'b']);
    });

    it('returns an empty array for an empty input', () => {
      expect(cleanStrings([])).toEqual([]);
    });

    it('returns an empty array when all strings are invalid', () => {
      expect(cleanStrings(['', '   ', '\t'])).toEqual([]);
    });
  });

  describe('isPlainObject', () => {
    it('returns true for a plain object literal', () => {
      expect(isPlainObject({ a: 1 })).toBe(true);
    });

    it('returns true for an empty object', () => {
      expect(isPlainObject({})).toBe(true);
    });

    it('returns false for an array', () => {
      expect(isPlainObject([])).toBe(false);
    });

    it('returns false for null', () => {
      expect(isPlainObject(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isPlainObject(undefined)).toBe(false);
    });

    it('returns false for a string', () => {
      expect(isPlainObject('hello')).toBe(false);
    });

    it('returns false for a number', () => {
      expect(isPlainObject(42)).toBe(false);
    });

    it('returns false for a boolean', () => {
      expect(isPlainObject(true)).toBe(false);
    });
  });

  describe('assertNoReservedKeys', () => {
    it('returns true when no reserved keys are present', () => {
      expect(assertNoReservedKeys({ name: 'Alice' }, ['id', 'uniqueIdentifier'])).toBe(true);
    });

    it('returns false when a reserved key is present', () => {
      expect(assertNoReservedKeys({ id: 'hack', name: 'Alice' }, ['id', 'uniqueIdentifier'])).toBe(
        false,
      );
    });

    it('returns false when uniqueIdentifier is present', () => {
      expect(assertNoReservedKeys({ uniqueIdentifier: 'hack' }, ['id', 'uniqueIdentifier'])).toBe(
        false,
      );
    });

    it('returns true for an empty object', () => {
      expect(assertNoReservedKeys({}, ['id', 'uniqueIdentifier'])).toBe(true);
    });

    it('returns true when reserved key list is empty', () => {
      expect(assertNoReservedKeys({ id: 'abc' }, [])).toBe(true);
    });

    it('returns true for a non-object value — does not throw', () => {
      expect(assertNoReservedKeys(null as any, ['id'])).toBe(true);
      expect(assertNoReservedKeys('string' as any, ['id'])).toBe(true);
    });
  });

  describe('assertNoReservedKeysDeep', () => {
    it('returns true for a plain object with no reserved keys', () => {
      expect(assertNoReservedKeysDeep({ steps: 1000 }, ['id', 'uniqueIdentifier'])).toBe(true);
    });

    it('returns false when a reserved key appears at the top level', () => {
      expect(assertNoReservedKeysDeep({ id: 'hack' }, ['id'])).toBe(false);
    });

    it('returns false when a reserved key is nested', () => {
      expect(assertNoReservedKeysDeep({ daily: { id: 'hack' } }, ['id'])).toBe(false);
    });

    it('returns false when a reserved key is deeply nested', () => {
      expect(assertNoReservedKeysDeep({ a: { b: { id: 'hack' } } }, ['id'])).toBe(false);
    });

    it('returns true for a deeply nested structure with no reserved keys', () => {
      expect(
        assertNoReservedKeysDeep({ a: { b: { c: 'safe' } } }, ['id', 'uniqueIdentifier']),
      ).toBe(true);
    });

    it('traverses arrays and returns false when a reserved key is inside an array element', () => {
      expect(assertNoReservedKeysDeep([{ id: 'hack' }], ['id'])).toBe(false);
    });

    it('traverses arrays and returns true when no reserved keys are inside', () => {
      expect(assertNoReservedKeysDeep([{ steps: 100 }], ['id'])).toBe(true);
    });

    it('returns true for primitives', () => {
      expect(assertNoReservedKeysDeep('string', ['id'])).toBe(true);
      expect(assertNoReservedKeysDeep(42, ['id'])).toBe(true);
      expect(assertNoReservedKeysDeep(null, ['id'])).toBe(true);
    });
  });

  describe('omitKeys', () => {
    it('returns a copy of the object without the specified keys', () => {
      const result = omitKeys({ id: 'abc', uniqueIdentifier: 'alice', name: 'Alice' }, [
        'id',
        'uniqueIdentifier',
      ]);

      expect(result).toEqual({ name: 'Alice' });
    });

    it('does not mutate the original object', () => {
      const original = { id: 'abc', name: 'Alice' };
      omitKeys(original, ['id']);

      expect(original).toEqual({ id: 'abc', name: 'Alice' });
    });

    it('returns the full object when no keys match', () => {
      const result = omitKeys({ name: 'Alice', score: 10 } as Record<string, any>, ['id'] as any);

      expect(result).toEqual({ name: 'Alice', score: 10 });
    });

    it('returns an empty object when all keys are omitted', () => {
      const result = omitKeys({ id: 'abc' }, ['id']);

      expect(result).toEqual({});
    });

    it('returns an unchanged copy when the keys array is empty', () => {
      const result = omitKeys({ id: 'abc', name: 'Alice' }, []);

      expect(result).toEqual({ id: 'abc', name: 'Alice' });
    });
  });

  describe('getPathSegments', () => {
    it('splits a simple dot-notated path', () => {
      expect(getPathSegments('fitbit.steps')).toEqual(['fitbit', 'steps']);
    });

    it('handles a deeply nested path', () => {
      expect(getPathSegments('a.b.c.d')).toEqual(['a', 'b', 'c', 'd']);
    });

    it('returns a single-element array for a path with no dots', () => {
      expect(getPathSegments('steps')).toEqual(['steps']);
    });

    it('returns an empty array for an empty string', () => {
      expect(getPathSegments('')).toEqual([]);
    });

    it('returns an empty array for a whitespace-only string', () => {
      expect(getPathSegments('   ')).toEqual([]);
    });

    it('filters out empty segments from double dots', () => {
      expect(getPathSegments('a..b')).toEqual(['a', 'b']);
    });

    it('trims whitespace from individual segments', () => {
      expect(getPathSegments(' a . b . c ')).toEqual(['a', 'b', 'c']);
    });
  });

  describe('setValueAtPath', () => {
    it('sets a top-level key', () => {
      const result = setValueAtPath({ steps: 100 }, 'steps', 200);

      expect(result).toEqual({ steps: 200 });
    });

    it('sets a nested key via dot notation', () => {
      const result = setValueAtPath({ daily: { steps: 100 } }, 'daily.steps', 999);

      expect((result.daily as any).steps).toBe(999);
    });

    it('creates intermediate objects when the path does not exist', () => {
      const result = setValueAtPath({}, 'a.b.c', 'deep');

      expect((result as any).a.b.c).toBe('deep');
    });

    it('preserves sibling keys when setting a nested value', () => {
      const result = setValueAtPath({ daily: { steps: 100, calories: 200 } }, 'daily.steps', 500);

      expect(result.daily).toEqual({ steps: 500, calories: 200 });
    });

    it('does not mutate the original object', () => {
      const original = { steps: 100 };
      setValueAtPath(original, 'steps', 999);

      expect(original.steps).toBe(100);
    });

    it('returns the source unchanged when path is empty', () => {
      const result = setValueAtPath({ steps: 100 }, '', 999);

      expect(result).toEqual({ steps: 100 });
    });

    it('handles a non-object source by starting fresh', () => {
      const result = setValueAtPath(null as any, 'a', 1);

      expect(result).toEqual({ a: 1 });
    });

    it('can set a value to null', () => {
      const result = setValueAtPath({ steps: 100 }, 'steps', null);

      expect(result.steps).toBeNull();
    });

    it('can set a value to an object', () => {
      const result = setValueAtPath({}, 'data', { nested: true });

      expect(result.data).toEqual({ nested: true });
    });
  });

  describe('deleteValueAtPath', () => {
    it('deletes a top-level key', () => {
      const result = deleteValueAtPath({ a: 1, b: 2 }, 'a');

      expect(result).toEqual({ b: 2 });
    });

    it('deletes a nested key via dot notation', () => {
      const result = deleteValueAtPath({ daily: { steps: 100, calories: 200 } }, 'daily.steps');

      expect(result.daily).toEqual({ calories: 200 });
      expect(result.daily).not.toHaveProperty('steps');
    });

    it('does not mutate the original object', () => {
      const original = { a: 1, b: 2 };
      deleteValueAtPath(original, 'a');

      expect(original).toEqual({ a: 1, b: 2 });
    });

    it('returns the object unchanged when the path does not exist', () => {
      const result = deleteValueAtPath({ a: 1 }, 'b.c');

      expect(result).toEqual({ a: 1 });
    });

    it('preserves sibling keys when deleting a nested value', () => {
      const result = deleteValueAtPath(
        { daily: { steps: 100, calories: 200, weight: 70 } },
        'daily.calories',
      );

      expect(result.daily).toEqual({ steps: 100, weight: 70 });
    });

    it('returns an empty object for a null source', () => {
      const result = deleteValueAtPath(null as any, 'a');

      expect(result).toEqual({});
    });

    it('returns the source unchanged when path is empty', () => {
      const result = deleteValueAtPath({ a: 1 }, '');

      expect(result).toEqual({ a: 1 });
    });

    it('leaves an empty parent object in place after deletion', () => {
      const result = deleteValueAtPath({ daily: { steps: 100 } }, 'daily.steps');

      expect(result).toHaveProperty('daily');
      expect(result.daily).toEqual({});
    });
  });
});
