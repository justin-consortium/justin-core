import { DataManager, ChangeListenerManager } from './data-manager';
import { createLogger } from './logger';
import { UserManager } from './user-manager/user-manager';

const Log = createLogger({ context: { source: 'lifecycle' } });

type ShutdownCoreOptions = {
  /**
   * If true, attempts to continue shutting down other subsystems even if one fails.
   * Defaults to true.
   */
  continueOnError?: boolean;
};

/**
 * Gracefully shuts down all core-managed resources (UserManager, change listeners, and DataManager).
 *
 * Safe to call multiple times. Intended for both production apps and tests.
 *
 * @example
 * ```ts
 * import { shutdownCore } from '@just-in/core';
 *
 * // When your app needs to exit (server shutdown, Cloud Run SIGTERM, etc.)
 * await shutdownCore();
 * ```
 *
 * @example
 * ```ts
 * import { shutdownCore } from '@just-in/core';
 *
 * // Typical Node server usage
 * process.on('SIGINT', async () => {
 *   await shutdownCore();
 *   process.exit(0);
 * });
 *
 * process.on('SIGTERM', async () => {
 *   await shutdownCore();
 *   process.exit(0);
 * });
 * ```
 */
async function shutdownCore(opts: ShutdownCoreOptions = {}): Promise<void> {
  const continueOnError = opts.continueOnError ?? true;

  const dm = DataManager.getInstance();
  const clm = ChangeListenerManager.getInstance();

  const run = async (label: string, fn: () => unknown | Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      Log.error(`shutdownCore: ${label} failed`, { error: err });
      if (!continueOnError) throw err;
    }
  };

  // Stop higher-level modules first (they may rely on streams)
  await run('UserManager.shutdown', () => UserManager.shutdown());

  // Ensure any remaining listeners are cleared
  await run('ChangeListenerManager.clearChangeListeners', () => clm.clearChangeListeners());

  // Close DB last (also clears listeners inside DataManager.close)
  await run('DataManager.close', async () => {
    if (dm.getInitializationStatus()) {
      await dm.close();
    }
  });
}

export { shutdownCore };
export type { ShutdownCoreOptions };
