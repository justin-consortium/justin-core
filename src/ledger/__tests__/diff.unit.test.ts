import { deepDiff, diffForAdd, diffForUpdate, diffForDelete, emptyDiff } from '../diff';

describe('ledger/diff unit tests', () => {
  describe('deepDiff — flat objects', () => {
    it('reports added fields', () => {
      const result = deepDiff({}, { name: 'Alice', score: 10 });

      expect(result.added).toEqual({ name: 'Alice', score: 10 });
      expect(result.changed).toEqual({});
      expect(result.removed).toEqual({});
    });

    it('reports removed fields', () => {
      const result = deepDiff({ name: 'Alice', role: 'admin' }, { name: 'Alice' });

      expect(result.removed).toEqual({ role: 'admin' });
      expect(result.added).toEqual({});
      expect(result.changed).toEqual({});
    });

    it('reports changed fields with from/to values', () => {
      const result = deepDiff({ name: 'Alice' }, { name: 'Alicia' });

      expect(result.changed).toEqual({ name: { from: 'Alice', to: 'Alicia' } });
      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
    });

    it('returns empty diff for identical objects', () => {
      const result = deepDiff({ name: 'Alice', score: 5 }, { name: 'Alice', score: 5 });

      expect(result).toEqual({ added: {}, changed: {}, removed: {} });
    });

    it('populates all three buckets in a single diff', () => {
      const result = deepDiff(
        { name: 'Alice', role: 'admin', score: 5 },
        { name: 'Alicia', score: 10, email: 'a@example.com' },
      );

      expect(result.changed).toMatchObject({ name: { from: 'Alice', to: 'Alicia' } });
      expect(result.changed).toMatchObject({ score: { from: 5, to: 10 } });
      expect(result.added).toHaveProperty('email', 'a@example.com');
      expect(result.removed).toHaveProperty('role', 'admin');
    });
  });

  describe('deepDiff — nested objects', () => {
    it('uses dot notation for nested changed fields', () => {
      const result = deepDiff(
        { address: { city: 'Detroit', zip: '48201' } },
        { address: { city: 'Dearborn', zip: '48201' } },
      );

      expect(result.changed).toEqual({ 'address.city': { from: 'Detroit', to: 'Dearborn' } });
      expect(result.added).toEqual({});
      expect(result.removed).toEqual({});
    });

    it('reports added nested fields with dot path', () => {
      const result = deepDiff(
        { address: { city: 'Detroit' } },
        { address: { city: 'Detroit', zip: '48201' } },
      );

      expect(result.added).toEqual({ 'address.zip': '48201' });
    });

    it('reports removed nested fields with dot path', () => {
      const result = deepDiff(
        { address: { city: 'Detroit', zip: '48201' } },
        { address: { city: 'Detroit' } },
      );

      expect(result.removed).toEqual({ 'address.zip': '48201' });
    });

    it('handles deeply nested paths', () => {
      const result = deepDiff({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } });

      expect(result.changed).toEqual({ 'a.b.c': { from: 1, to: 2 } });
    });

    it('does not emit intermediate path segments on their own', () => {
      const result = deepDiff({ address: { city: 'Detroit' } }, { address: { city: 'Dearborn' } });

      expect(result.changed).not.toHaveProperty('address');
      expect(result.changed['address.city']).toBeDefined();
    });

    it('flattens an entirely new nested object into leaf paths', () => {
      const result = deepDiff({}, { address: { city: 'Detroit', zip: '48201' } });

      expect(result.added).toEqual({ 'address.city': 'Detroit', 'address.zip': '48201' });
    });

    it('flattens an entirely removed nested object into leaf paths', () => {
      const result = deepDiff({ address: { city: 'Detroit', zip: '48201' } }, {});

      expect(result.removed).toEqual({ 'address.city': 'Detroit', 'address.zip': '48201' });
    });
  });

  describe('deepDiff — arrays', () => {
    it('diffs individual changed elements by index', () => {
      const result = deepDiff({ tags: ['a', 'b'] }, { tags: ['a', 'c'] });

      expect(result.changed).toEqual({ 'tags.1': { from: 'b', to: 'c' } });
    });

    it('reports added array elements by index', () => {
      const result = deepDiff({ tags: ['a'] }, { tags: ['a', 'b'] });

      expect(result.added['tags.1']).toBe('b');
    });

    it('reports removed array elements by index', () => {
      const result = deepDiff({ tags: ['a', 'b'] }, { tags: ['a'] });

      expect(result.removed['tags.1']).toBe('b');
    });
  });

  describe('deepDiff — edge cases', () => {
    it('handles null values', () => {
      const result = deepDiff({ val: null }, { val: 'something' });

      expect(result.changed).toEqual({ val: { from: null, to: 'something' } });
    });

    it('distinguishes numeric zero from false', () => {
      const result = deepDiff({ val: 0 }, { val: false });

      expect(result.changed).toEqual({ val: { from: 0, to: false } });
    });

    it('returns empty diff for two empty objects', () => {
      expect(deepDiff({}, {})).toEqual({ added: {}, changed: {}, removed: {} });
    });
  });

  describe('diffForAdd', () => {
    it('places all snapshot fields in added', () => {
      const result = diffForAdd({ id: 'u1', name: 'Alice' });

      expect(result.added).toEqual({ id: 'u1', name: 'Alice' });
      expect(result.changed).toEqual({});
      expect(result.removed).toEqual({});
    });
  });

  describe('diffForUpdate', () => {
    it('returns the diff between prev and next', () => {
      const result = diffForUpdate({ name: 'Alice' }, { name: 'Alicia', score: 5 });

      expect(result.changed).toEqual({ name: { from: 'Alice', to: 'Alicia' } });
      expect(result.added).toHaveProperty('score', 5);
    });
  });

  describe('diffForDelete', () => {
    it('places all snapshot fields in removed', () => {
      const result = diffForDelete({ id: 'u1', name: 'Alice' });

      expect(result.removed).toEqual({ id: 'u1', name: 'Alice' });
      expect(result.added).toEqual({});
      expect(result.changed).toEqual({});
    });
  });

  describe('emptyDiff', () => {
    it('returns all-empty buckets', () => {
      expect(emptyDiff()).toEqual({ added: {}, changed: {}, removed: {} });
    });
  });
});
