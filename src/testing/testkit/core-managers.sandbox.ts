import sinon from 'sinon';
// eslint-disable-next-line no-duplicate-imports
import type { SinonSandbox, SinonStub } from 'sinon';
import { DataManager, ChangeListenerManager } from '../../data-manager';
import * as HelpersModule from '../../utils';

/**
 * Error shape thrown by the `handleError` stub in {@link makeCoreManagersSandbox}.
 * Includes the original db message passed to `handleError` as `dbMessage`.
 */
export type DbErrorWithMessage = Error & { dbMessage: string };

/**
 * Type guard for errors thrown by the `handleError` stub.
 */
export function isDbErrorWithMessage(err: unknown): err is DbErrorWithMessage {
  return err instanceof Error && typeof (err as any).dbMessage === 'string';
}

/**
 * Convenience accessor for the dbMessage (returns undefined if not present).
 */
export function getDbMessage(err: unknown): string | undefined {
  return isDbErrorWithMessage(err) ? err.dbMessage : undefined;
}

export type CoreManagersSandbox = {
  /**
   * The underlying Sinon sandbox. Prefer using `.restore()` on the returned object.
   */
  sb: SinonSandbox;

  /**
   * Real singleton instance, with methods stubbed for unit tests.
   */
  dm: ReturnType<typeof DataManager.getInstance>;

  /**
   * Real singleton instance, with methods stubbed for unit tests.
   */
  clm: ChangeListenerManager;

  /**
   * Stubbed handleError that always throws the underlying errors (or a new Error).
   * The thrown errors will include `dbMessage` (the first arg passed to handleError).
   */
  handleErrorStub: SinonStub;

  /**
   * Restore all sinon stubs/spies in this sandbox.
   */
  restore(): void;
};

/**
 * Creates a shared sandbox for unit tests that depend on core singletons.
 *
 * This mirrors the "clean beforeEach" pattern:
 * - DataManager singleton with common methods stubbed
 * - ChangeListenerManager singleton with listener methods stubbed
 * - handleError stub that always throws
 *
 * @example
 * ```ts
 * let t: CoreManagersSandbox;
 *
 * beforeEach(() => {
 *   t = makeCoreManagersSandbox();
 * });
 *
 * afterEach(() => {
 *   t.restore();
 * });
 * ```
 */
export function makeCoreManagersSandbox(): CoreManagersSandbox {
  const sb = sinon.createSandbox();

  const dm = DataManager.getInstance();
  const clm = ChangeListenerManager.getInstance();

  // DataManager stubs (baseline safe defaults)
  sb.stub(dm, 'init').resolves();
  sb.stub(dm, 'ensureStore').resolves();
  sb.stub(dm, 'ensureIndexes').resolves();
  sb.stub(dm, 'getInitializationStatus').returns(true);

  // single-item CRUD
  sb.stub(dm, 'addItemToCollection').resolves(null as any);
  sb.stub(dm, 'updateItemByIdInCollection').resolves(null as any);
  sb.stub(dm, 'removeItemFromCollection').resolves(0 as any);
  sb.stub(dm, 'findItemByIdInCollection').resolves(null as any);
  sb.stub(dm, 'findItemsInCollection').resolves([] as any);

  // bulk CRUD
  sb.stub(dm, 'addItemsToCollection').resolves([] as any);
  sb.stub(dm, 'updateItemsByIdInCollection').resolves(0 as any);
  sb.stub(dm, 'removeItemsFromCollection').resolves(0 as any);
  sb.stub(dm, 'findItemsByIdsInCollection').resolves([] as any);

  // collection-level
  sb.stub(dm, 'getAllInCollection').resolves([]);
  sb.stub(dm, 'clearCollection').resolves();

  // ChangeListenerManager stubs
  sb.stub(clm, 'addChangeListener');
  sb.stub(clm, 'removeChangeListener');
  sb.stub(clm, 'clearChangeListeners');

  /**
   * handleError stub
   *
   * Supports both call styles:
   *   handleError(message, errors)
   *   handleError(message, methodName, errors)
   *
   * Always rethrows the underlying Error (if present), or a new Error(message).
   */
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
