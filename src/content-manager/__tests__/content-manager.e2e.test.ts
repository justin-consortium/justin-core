import { MongoMemoryReplSet } from 'mongodb-memory-server';
import sinon from 'sinon';

import { configureDB } from '../../lifecycle';
import { DataManager, DBType } from '../../data-manager';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import { ContentManager } from '../../content-manager/content-manager';
import { CONTENT } from '../../content-manager/constants';
import {
  waitForMongoReady,
  expectOk,
  expectFailed,
  expectFailedWithCode,
  silenceLogger,
} from '../../testing';
import type { JContent } from '../../content-manager/types';

/**
 * ContentManager end-to-end tests.
 *
 * Goals:
 * - Exercise every public ContentManager API against real Mongo infrastructure.
 * - Cover happy paths, edge cases, and invalid-input paths.
 * - Verify DB state directly via DataManager as a secondary assertion source.
 * - Assert CoreResult shape (ok, successes, failures) on every write operation.
 *
 * ContentManager has no in-memory cache, so every read goes to the DB —
 * there is no cache-vs-DB consistency surface to test here.
 */

jest.setTimeout(120_000);

describe('ContentManager public API — e2e', () => {
  let repl: MongoMemoryReplSet;
  let dm: DataManager;
  let sb: sinon.SinonSandbox;
  let silenceLogs: { restore: () => void };

  beforeAll(async () => {
    silenceLogs = silenceLogger();
    sb = sinon.createSandbox();

    repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = repl.getUri();
    await waitForMongoReady(uri);

    const realInit = MongoDBManager.init.bind(MongoDBManager);
    sb.stub(MongoDBManager, 'init').callsFake(() => realInit(uri, 'content-manager-e2e'));

    configureDB({ dbType: DBType.MONGO, uri });

    dm = DataManager.getInstance();
    await ContentManager.init();
  });

  afterAll(async () => {
    try {
      await ContentManager.shutdown();
    } catch {}
    try {
      await dm.close();
    } catch {}
    try {
      await repl.stop();
    } catch {}
    try {
      sb.restore();
    } catch {}
    silenceLogs.restore();
  });

  beforeEach(async () => {
    await dm.clearCollection(CONTENT);
  });

  /** Creates a content record and asserts success — convenience for test setup. */
  async function createContent(
    uniqueIdentifier: string,
    type = 'message',
    value: Record<string, any> = {},
  ): Promise<JContent> {
    const result = await ContentManager.createContent({ uniqueIdentifier, type, value });
    return expectOk(result);
  }

  // ===========================================================================
  // createContent
  // ===========================================================================

  describe('createContent', () => {
    it('returns ok:true with the created content record', async () => {
      const result = await ContentManager.createContent({
        uniqueIdentifier: 'msg-1',
        type: 'message',
        value: { text: 'Hello!' },
      });

      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(1);
      const content = result.successes[0];
      expect(content.id).toEqual(expect.any(String));
      expect(content.uniqueIdentifier).toBe('msg-1');
      expect(content.type).toBe('message');
      expect(content.value).toMatchObject({ text: 'Hello!' });
    });

    it('persists the record to DB', async () => {
      await createContent('msg-1');
      const all = await dm.getAllInCollection<any>(CONTENT);
      expect(all).toHaveLength(1);
      expect(all[0].uniqueIdentifier).toBe('msg-1');
    });

    it('does not expose _id — only id', async () => {
      const result = await ContentManager.createContent({
        uniqueIdentifier: 'msg-1',
        type: 'message',
        value: {},
      });
      const content = expectOk(result);
      expect((content as any)._id).toBeUndefined();
      expect(content.id).toEqual(expect.any(String));
    });

    it('returns ok:false with VALIDATION_ERROR for duplicate uniqueIdentifier', async () => {
      await createContent('msg-1');
      const duplicate = await ContentManager.createContent({
        uniqueIdentifier: 'msg-1',
        type: 'message',
        value: {},
      });
      const failure = expectFailedWithCode(duplicate, 'VALIDATION_ERROR');
      expect(failure.uniqueIdentifier).toBe('msg-1');
    });

    it('returns ok:false for null input', async () => {
      // @ts-expect-error intentional
      expectFailed(await ContentManager.createContent(null));
    });

    it('returns ok:false with VALIDATION_ERROR for empty uniqueIdentifier', async () => {
      expectFailedWithCode(
        await ContentManager.createContent({ uniqueIdentifier: '', type: 'message', value: {} }),
        'VALIDATION_ERROR',
      );
    });

    it('returns ok:false with VALIDATION_ERROR for empty type', async () => {
      expectFailedWithCode(
        await ContentManager.createContent({ uniqueIdentifier: 'msg-1', type: '', value: {} }),
        'VALIDATION_ERROR',
      );
    });

    it('returns ok:false with VALIDATION_ERROR when value is not a plain object', async () => {
      expectFailedWithCode(
        // @ts-expect-error intentional
        await ContentManager.createContent({
          uniqueIdentifier: 'msg-1',
          type: 'message',
          value: 'bad',
        }),
        'VALIDATION_ERROR',
      );
    });

    it('returns ok:false with VALIDATION_ERROR when value contains reserved key "id"', async () => {
      expectFailedWithCode(
        await ContentManager.createContent({
          uniqueIdentifier: 'msg-1',
          type: 'message',
          value: { id: 'hack' },
        }),
        'VALIDATION_ERROR',
      );
    });

    it('returns ok:false with VALIDATION_ERROR when value contains reserved key "type"', async () => {
      expectFailedWithCode(
        await ContentManager.createContent({
          uniqueIdentifier: 'msg-1',
          type: 'message',
          value: { type: 'hack' },
        }),
        'VALIDATION_ERROR',
      );
    });

    it('preserves uniqueIdentifier with spaces exactly as provided', async () => {
      const content = await createContent('my content item');
      expect(content.uniqueIdentifier).toBe('my content item');
    });

    it('supports different types in the same collection', async () => {
      await createContent('gif-1', 'gif', { url: 'https://example.com/walk.gif' });
      await createContent('push-1', 'push-notification', { title: 'Move!', body: 'Time to walk.' });
      await createContent('msg-1', 'message', { text: 'Great job today.' });

      const all = await dm.getAllInCollection<any>(CONTENT);
      expect(all).toHaveLength(3);
      expect(all.map((c: any) => c.type).sort()).toEqual(['gif', 'message', 'push-notification']);
    });
  });

  // ===========================================================================
  // createContents
  // ===========================================================================

  describe('createContents', () => {
    it('returns ok:true with all created records when all succeed', async () => {
      const result = await ContentManager.createContents([
        { uniqueIdentifier: 'c1', type: 'gif', value: { url: 'a.gif' } },
        { uniqueIdentifier: 'c2', type: 'gif', value: { url: 'b.gif' } },
        { uniqueIdentifier: 'c3', type: 'message', value: { text: 'hi' } },
      ]);

      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(3);
      expect(result.successes.map((c) => c.uniqueIdentifier).sort()).toEqual(['c1', 'c2', 'c3']);
    });

    it('returns ok:false with partial successes when some records are invalid', async () => {
      const result = await ContentManager.createContents([
        { uniqueIdentifier: 'valid-1', type: 'message', value: {} },
        // @ts-expect-error intentional
        null,
        { uniqueIdentifier: 'valid-2', type: 'message', value: {} },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.successes).toHaveLength(2);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].code).toBe('VALIDATION_ERROR');
      }
    });

    it('returns ok:true with empty successes for empty input', async () => {
      const result = await ContentManager.createContents([]);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });

    it('persists all created records to DB', async () => {
      await ContentManager.createContents([
        { uniqueIdentifier: 'p1', type: 'message', value: {} },
        { uniqueIdentifier: 'p2', type: 'message', value: {} },
      ]);
      expect(await dm.getAllInCollection<any>(CONTENT)).toHaveLength(2);
    });

    it('failure entries include uniqueIdentifier for traceability', async () => {
      await createContent('existing');

      const result = await ContentManager.createContents([
        { uniqueIdentifier: 'new-one', type: 'message', value: {} },
        { uniqueIdentifier: 'existing', type: 'message', value: {} },
      ]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.successes).toHaveLength(1);
        expect(result.failures[0].uniqueIdentifier).toBe('existing');
        expect(result.failures[0].code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ===========================================================================
  // getContent / getContentBySlug
  // ===========================================================================

  describe('getContent / getContentBySlug', () => {
    it('getContent returns the record by id', async () => {
      const content = await createContent('msg-1', 'message', { text: 'Hello' });
      const found = await ContentManager.getContent(content.id);
      expect(found).not.toBeNull();
      expect(found!.uniqueIdentifier).toBe('msg-1');
    });

    it('getContent returns null for unknown id', async () => {
      // Use a valid-looking but non-existent ObjectId
      const found = await ContentManager.getContent('000000000000000000000001');
      expect(found).toBeNull();
    });

    it('getContent returns null for empty string', async () => {
      expect(await ContentManager.getContent('')).toBeNull();
    });

    it('getContentBySlug returns the record by uniqueIdentifier', async () => {
      await createContent('gif-walking-1', 'gif', { url: 'https://example.com/walk.gif' });
      const found = await ContentManager.getContentBySlug('gif-walking-1');
      expect(found).not.toBeNull();
      expect(found!.type).toBe('gif');
      expect(found!.value).toMatchObject({ url: 'https://example.com/walk.gif' });
    });

    it('getContentBySlug returns null for unknown uniqueIdentifier', async () => {
      expect(await ContentManager.getContentBySlug('does-not-exist')).toBeNull();
    });

    it('getContentBySlug matches exactly — does not trim', async () => {
      await createContent('my content');
      expect(await ContentManager.getContentBySlug('my content')).not.toBeNull();
      expect(await ContentManager.getContentBySlug('mycontent')).toBeNull();
      expect(await ContentManager.getContentBySlug(' my content ')).toBeNull();
    });
  });

  // ===========================================================================
  // getContentByType
  // ===========================================================================

  describe('getContentByType', () => {
    it('returns all records of the requested type', async () => {
      await createContent('gif-1', 'gif', { url: 'a.gif' });
      await createContent('gif-2', 'gif', { url: 'b.gif' });
      await createContent('msg-1', 'message', { text: 'hi' });

      const gifs = await ContentManager.getContentByType('gif');
      expect(gifs).toHaveLength(2);
      expect(gifs.every((c) => c.type === 'gif')).toBe(true);
    });

    it('returns empty array when no records match the type', async () => {
      await createContent('msg-1', 'message', { text: 'hi' });
      const gifs = await ContentManager.getContentByType('gif');
      expect(gifs).toEqual([]);
    });

    it('returns empty array for empty type string', async () => {
      await createContent('msg-1', 'message', {});
      expect(await ContentManager.getContentByType('')).toEqual([]);
    });

    it('returned records include the full value payload', async () => {
      await createContent('push-1', 'push-notification', {
        title: 'Move!',
        body: 'Time to take a walk.',
      });

      const [found] = await ContentManager.getContentByType('push-notification');
      expect(found.value).toMatchObject({ title: 'Move!', body: 'Time to take a walk.' });
    });
  });

  // ===========================================================================
  // getAllContent
  // ===========================================================================

  describe('getAllContent', () => {
    it('returns all records in the collection', async () => {
      await createContent('c1', 'gif', {});
      await createContent('c2', 'message', {});
      await createContent('c3', 'push-notification', {});

      const all = await ContentManager.getAllContent();
      expect(all).toHaveLength(3);
    });

    it('returns empty array when the collection is empty', async () => {
      expect(await ContentManager.getAllContent()).toEqual([]);
    });
  });

  // ===========================================================================
  // updateContent
  // ===========================================================================

  describe('updateContent', () => {
    it('returns ok:true with the updated record when updating value', async () => {
      const content = await createContent('msg-1', 'message', { text: 'Old' });
      const updated = expectOk(
        await ContentManager.updateContent(content.id, { value: { text: 'New' } }),
      );
      expect(updated.value).toMatchObject({ text: 'New' });
      expect(updated.type).toBe('message');
      expect(updated.uniqueIdentifier).toBe('msg-1');
    });

    it('persists the update to DB', async () => {
      const content = await createContent('msg-1', 'message', { text: 'Old' });
      await ContentManager.updateContent(content.id, { value: { text: 'New' } });
      const all = await dm.getAllInCollection<any>(CONTENT);
      expect(all[0].value).toMatchObject({ text: 'New' });
    });

    it('can update uniqueIdentifier', async () => {
      const content = await createContent('old-slug', 'message', {});
      const updated = expectOk(
        await ContentManager.updateContent(content.id, { uniqueIdentifier: 'new-slug' }),
      );
      expect(updated.uniqueIdentifier).toBe('new-slug');
    });

    it('type field is not updatable — it is intentionally excluded', async () => {
      const content = await createContent('msg-1', 'message', {});
      // ContentUpdateRecord does not include type — TypeScript prevents it
      // but we verify the DB record is unchanged
      await ContentManager.updateContent(content.id, { value: { text: 'Updated' } });
      const found = await ContentManager.getContent(content.id);
      expect(found!.type).toBe('message');
    });

    it('returns ok:false with VALIDATION_ERROR for duplicate uniqueIdentifier', async () => {
      const c1 = await createContent('slug-1', 'message', {});
      await createContent('slug-2', 'message', {});

      expectFailedWithCode(
        await ContentManager.updateContent(c1.id, { uniqueIdentifier: 'slug-2' }),
        'VALIDATION_ERROR',
      );
    });

    it('returns ok:false with VALIDATION_ERROR when value contains reserved key', async () => {
      const content = await createContent('msg-1', 'message', {});
      expectFailedWithCode(
        await ContentManager.updateContent(content.id, { value: { id: 'hack' } }),
        'VALIDATION_ERROR',
      );
    });

    it('returns ok:false with NOT_FOUND for unknown contentId', async () => {
      expectFailedWithCode(
        await ContentManager.updateContent('000000000000000000000001', { value: { x: 1 } }),
        'NOT_FOUND',
      );
    });

    it('returns ok:false with VALIDATION_ERROR for empty contentId', async () => {
      expectFailedWithCode(
        await ContentManager.updateContent('', { value: {} }),
        'VALIDATION_ERROR',
      );
    });

    it('failure entry carries id for traceability', async () => {
      const result = await ContentManager.updateContent('000000000000000000000001', { value: {} });
      if (!result.ok) expect(result.failures[0].id).toBe('000000000000000000000001');
    });
  });

  // ===========================================================================
  // deleteContent
  // ===========================================================================

  describe('deleteContent', () => {
    it('returns ok:true on successful deletion', async () => {
      const content = await createContent('msg-1');
      expect((await ContentManager.deleteContent(content.id)).ok).toBe(true);
    });

    it('removes the record from DB', async () => {
      const content = await createContent('msg-1');
      await ContentManager.deleteContent(content.id);
      expect(await dm.getAllInCollection<any>(CONTENT)).toHaveLength(0);
    });

    it('the record is no longer retrievable after deletion', async () => {
      const content = await createContent('msg-1');
      await ContentManager.deleteContent(content.id);
      expect(await ContentManager.getContent(content.id)).toBeNull();
    });

    it('returns ok:false with NOT_FOUND for unknown contentId', async () => {
      expectFailedWithCode(
        await ContentManager.deleteContent('000000000000000000000001'),
        'NOT_FOUND',
      );
    });

    it('returns ok:false with VALIDATION_ERROR for empty contentId', async () => {
      expectFailedWithCode(await ContentManager.deleteContent(''), 'VALIDATION_ERROR');
    });

    it('failure entry carries id for traceability', async () => {
      const result = await ContentManager.deleteContent('000000000000000000000001');
      if (!result.ok) expect(result.failures[0].id).toBe('000000000000000000000001');
    });
  });

  // ===========================================================================
  // deleteContents (bulk)
  // ===========================================================================

  describe('deleteContents', () => {
    it('deletes multiple records in one call', async () => {
      const c1 = await createContent('c1');
      const c2 = await createContent('c2');
      const c3 = await createContent('c3');

      const result = await ContentManager.deleteContents([c1.id, c2.id]);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(2);

      expect(await dm.getAllInCollection<any>(CONTENT)).toHaveLength(1);
      expect(await ContentManager.getContent(c3.id)).not.toBeNull();
    });

    it('returns ok:true with empty successes for empty input', async () => {
      const result = await ContentManager.deleteContents([]);
      expect(result.ok).toBe(true);
      expect(result.successes).toHaveLength(0);
    });
  });

  // ===========================================================================
  // deleteAllContent
  // ===========================================================================

  describe('deleteAllContent', () => {
    it('removes all records from the collection', async () => {
      await createContent('c1');
      await createContent('c2');
      await createContent('c3');

      const result = await ContentManager.deleteAllContent();
      expect(result.ok).toBe(true);
      expect(await dm.getAllInCollection<any>(CONTENT)).toHaveLength(0);
    });

    it('is a no-op on an empty collection', async () => {
      const result = await ContentManager.deleteAllContent();
      expect(result.ok).toBe(true);
    });
  });

  // ===========================================================================
  // CoreResult shape consistency
  // ===========================================================================

  describe('CoreResult shape consistency', () => {
    it('single and bulk operations return the same result envelope shape', async () => {
      const single = await ContentManager.createContent({
        uniqueIdentifier: 'shape-test',
        type: 'message',
        value: {},
      });
      expect(single).toHaveProperty('ok');
      expect(single).toHaveProperty('successes');
      if (!single.ok) expect(single).toHaveProperty('failures');

      const bulk = await ContentManager.createContents([
        { uniqueIdentifier: 'bulk-shape-1', type: 'gif', value: {} },
        { uniqueIdentifier: 'bulk-shape-2', type: 'gif', value: {} },
      ]);
      expect(bulk).toHaveProperty('ok');
      expect(bulk).toHaveProperty('successes');
      if (!bulk.ok) expect(bulk).toHaveProperty('failures');
    });
  });
});
