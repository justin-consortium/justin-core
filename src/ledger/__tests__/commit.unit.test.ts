import { beginLedgerCommit, makeImplicitCommit } from '../commit';

describe('ledger/commit unit tests', () => {
  describe('beginLedgerCommit', () => {
    it('returns a context with a non-empty string commitId', () => {
      const ctx = beginLedgerCommit();

      expect(typeof ctx.commitId).toBe('string');
      expect(ctx.commitId.length).toBeGreaterThan(0);
    });

    it('returns a context with a committedAt Date within the current call window', () => {
      const before = new Date();
      const ctx = beginLedgerCommit();
      const after = new Date();

      expect(ctx.committedAt).toBeInstanceOf(Date);
      expect(ctx.committedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(ctx.committedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('stores metadata when provided', () => {
      const ctx = beginLedgerCommit({ initiatedBy: 'test-suite' });

      expect(ctx.metadata).toEqual({ initiatedBy: 'test-suite' });
    });

    it('omits metadata field entirely when not provided', () => {
      const ctx = beginLedgerCommit();

      expect(ctx).not.toHaveProperty('metadata');
    });

    it('two calls produce distinct commitIds', () => {
      const ctx1 = beginLedgerCommit();
      const ctx2 = beginLedgerCommit();

      expect(ctx1.commitId).not.toBe(ctx2.commitId);
    });
  });

  describe('makeImplicitCommit', () => {
    it('returns a context with the same shape as beginLedgerCommit', () => {
      const ctx = makeImplicitCommit();

      expect(typeof ctx.commitId).toBe('string');
      expect(ctx.commitId.length).toBeGreaterThan(0);
      expect(ctx.committedAt).toBeInstanceOf(Date);
    });

    it('stores metadata when provided', () => {
      const ctx = makeImplicitCommit({ initiatedBy: 'implicit' });

      expect(ctx.metadata).toEqual({ initiatedBy: 'implicit' });
    });

    it('produces a distinct commitId from a concurrent beginLedgerCommit call', () => {
      const ctx1 = beginLedgerCommit();
      const ctx2 = makeImplicitCommit();

      expect(ctx1.commitId).not.toBe(ctx2.commitId);
    });
  });
});
