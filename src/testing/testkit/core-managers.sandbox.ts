import sinon from 'sinon';

import type { SinonSandbox, SinonStub } from 'sinon';
import { DataManager, ChangeListenerManager } from '../../data-manager';
import * as HelpersModule from '../../utils/error.helpers';

/**
 * Error shape thrown by the `handleError` stub in {@link makeCoreManagersSandbox}.
 * Includes the original message passed to `handleError` as `dbMessage`.
 */
export type DbErrorWithMessage = Error & { dbMessage: string };

/**
 * Type guard for errors thrown by the `handleError` stub.
 */
export function isDbErrorWithMessage(err: unknown): err is DbErrorWithMessage {
  return err instanceof Error && typeof (err as any).dbMessage === 'string';
}

/**
 * Convenience accessor for the `dbMessage` field — returns `undefined` if not present.
 */
export function getDbMessage(err: unknown): string | undefined {
  return isDbErrorWithMessage(err) ? err.dbMessage : undefined;
}

export type CoreManagersSandbox = {
  /**
   * The underlying Sinon sandbox. Prefer calling `.restore()` on the returned
   * object rather than directly on this.
   */
  sb: SinonSandbox;

  /**
   * Real singleton instance with methods stubbed for unit tests.
   */
  dm: ReturnType<typeof DataManager.getInstance>;

  /**
   * Real singleton instance with methods stubbed for unit tests.
   */
  clm: ChangeListenerManager;

  /**
   * Stubbed `handleError` that always throws the underlying error (or a new
   * `Error`). The thrown error includes a `dbMessage` field set to the first
   * argument originally passed to `handleError`.
   */
  handleErrorStub: SinonStub;

  /**
   * Restores all Sinon stubs and spies in this sandbox.
   */
  restore(): void;
};

/**
 * Creates a shared Sinon sandbox for unit tests that depend on core singletons.
 *
 * Sets up safe stub defaults for `DataManager` and `ChangeListenerManager` so
 * tests can override only the specific calls they care about without worrying
 * about hitting a real database. Also stubs `handleError` to always throw,
 * making error-path assertions straightforward.
 *
 * @example
 * ```ts
 * let t: CoreManagersSandbox;
 *
 * beforeEach(() => { t = makeCoreManagersSandbox(); });
 * afterEach(() => { t.restore(); });
 *
 * it('handles DB failure', () => {
 *   t.dm.addItemToCollection.rejects(new Error('timeout'));
 *   // ...
 * });
 * ```
 */
export function makeCoreManagersSandbox(): CoreManagersSandbox {
  const sb = sinon.createSandbox();

  const dm = DataManager.getInstance();
  const clm = ChangeListenerManager.getInstance();

  // DataManager — safe defaults that resolve without hitting a DB.
  sb.stub(dm, 'init').resolves();
  sb.stub(dm, 'ensureStore').resolves();
  sb.stub(dm, 'ensureIndexes').resolves();
  sb.stub(dm, 'getInitializationStatus').returns(true);

  // Single-item CRUD
  sb.stub(dm, 'addItemToCollection').resolves(null as any);
  sb.stub(dm, 'updateItemByIdInCollection').resolves(null as any);
  sb.stub(dm, 'removeItemFromCollection').resolves(0 as any);
  sb.stub(dm, 'findItemByIdInCollection').resolves(null as any);
  sb.stub(dm, 'findItemsInCollection').resolves([] as any);

  // Bulk CRUD
  sb.stub(dm, 'addItemsToCollection').resolves([] as any);
  sb.stub(dm, 'updateItemsByIdInCollection').resolves(0 as any);
  sb.stub(dm, 'removeItemsFromCollection').resolves(0 as any);
  sb.stub(dm, 'findItemsByIdsInCollection').resolves([] as any);

  // Collection-level
  sb.stub(dm, 'getAllInCollection').resolves([]);
  sb.stub(dm, 'clearCollection').resolves();

  // ChangeListenerManager — no-ops by default.
  sb.stub(clm, 'addChangeListener');
  sb.stub(clm, 'removeChangeListener').resolves();
  sb.stub(clm, 'clearChangeListeners').resolves();

  // handleError — always throws so callers can assert on the thrown error without
  // needing to set up a logger or parse structured output.
  const handleErrorStub = sb
    .stub(HelpersModule, 'handleError')
    .callsFake((...args: unknown[]): never => {
      const [message, , options] = args as [string, string, { error?: unknown } | undefined];
      const msg = String(message);
      const error = (options as any)?.error;
      const err = error instanceof Error ? error : new Error(String(error ?? msg));
      (err as DbErrorWithMessage).dbMessage = msg;
      throw err;
    });

  return {
    sb,
    dm,
    clm,
    handleErrorStub,
    restore() {
      sb.restore();
    },
  };
}
