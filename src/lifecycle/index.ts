import { DataManager, ChangeListenerManager, configureDB as _configureDB } from '../data-manager';
import type { DBConfig } from '../data-manager/types';
import { createLogger } from '../logger';

export type { DBConfig } from '../data-manager/types';

const Log = createLogger({ context: { source: 'lifecycle' } });

// ---------------------------------------------------------------------------
// Manager registry
// ---------------------------------------------------------------------------

/**
 * The minimal contract a manager must satisfy to participate in the lifecycle
 * system. Only `shutdown` is required — `init` is called directly by the
 * application or by the manager itself.
 */
type ManagedShutdown = {
  shutdown: () => Promise<void>;
};

const _registry = new Set<ManagedShutdown>();

/**
 * Registers a manager with the lifecycle system.
 *
 * Called automatically inside each manager's `init()` — you should not need
 * to call this directly. Once registered, the manager's `shutdown()` will be
 * invoked by {@link shutdownCore} during teardown.
 *
 * Duplicate registrations (same object reference) are ignored.
 *
 * @param manager - Object with a `shutdown` method.
 */
export function registerManager(manager: ManagedShutdown): void {
  _registry.add(manager);
}

/**
 * Removes all registered managers from the registry.
 *
 * Called as part of {@link shutdownCore}. Exposed separately so tests can
 * reset the registry between runs without going through a full shutdown.
 *
 * @internal
 */
export function clearManagerRegistry(): void {
  _registry.clear();
}

// ---------------------------------------------------------------------------
// configureDB
// ---------------------------------------------------------------------------

/**
 * Stores the database connection configuration for lazy initialisation.
 *
 * Call this once at application startup, before calling `init()` on any
 * manager. The actual connection is established lazily on the first
 * `DataManager.init()` call, so the order relative to other startup work
 * does not matter as long as it comes before any manager `init`.
 *
 * All managers share the same underlying connection — there is no need to
 * call `configureDB` more than once per process.
 *
 * @example
 * ```ts
 * import { configureDB, DBType } from '@just-in/core';
 * import { UserManager } from '@just-in/core';
 *
 * configureDB({ dbType: DBType.MONGO, uri: process.env.MONGO_URI });
 *
 * await UserManager.init();
 * await ContentManager.init();
 * ```
 *
 * @param config - Database connection configuration.
 */
export function configureDB(config: DBConfig): void {
  _configureDB(config);
}

// ---------------------------------------------------------------------------
// shutdownCore
// ---------------------------------------------------------------------------

/**
 * Options accepted by {@link shutdownCore}.
 */
export type ShutdownCoreOptions = {
  /**
   * If `true`, continues shutting down remaining subsystems even if one fails.
   * Defaults to `true`.
   */
  continueOnError?: boolean;
};

/**
 * Gracefully shuts down all registered managers, change listeners, and the
 * database connection.
 *
 * Shutdown order:
 * 1. All managers registered via {@link registerManager} (in parallel).
 * 2. Any remaining change listeners not already removed by the managers.
 * 3. The DataManager connection (also clears listeners internally).
 *
 * Safe to call multiple times — subsequent calls after the first are no-ops
 * for already-closed resources. Clears the manager registry on completion so
 * the process can be re-initialised cleanly (useful in tests).
 *
 * @example
 * ```ts
 * process.on('SIGTERM', async () => {
 *   await shutdownCore();
 *   process.exit(0);
 * });
 * ```
 *
 * @param opts - Optional shutdown behaviour configuration.
 */
export async function shutdownCore(opts: ShutdownCoreOptions = {}): Promise<void> {
  const continueOnError = opts.continueOnError ?? true;

  const run = async (label: string, fn: () => unknown | Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      Log.error(`shutdownCore: ${label} failed`, { error: err });
      if (!continueOnError) throw err;
    }
  };

  const dm = DataManager.getInstance();
  const clm = ChangeListenerManager.getInstance();

  // Shut down all registered managers in parallel — they are independent and
  // each is responsible for tearing down its own change streams.
  const managers = Array.from(_registry);
  await Promise.all(managers.map((m) => run(`manager.shutdown`, () => m.shutdown())));

  // Belt-and-suspenders: clear any listeners that managers may have missed.
  await run('ChangeListenerManager.clearChangeListeners', () => clm.clearChangeListeners());

  // Close the DB connection last — adapters rely on it staying open until here.
  await run('DataManager.close', async () => {
    if (dm.getInitializationStatus()) await dm.close();
  });

  clearManagerRegistry();
}
