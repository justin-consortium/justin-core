import { EventEmitter } from 'events';
import { CollectionChangeType } from './types';
import DataManager from './';
import { Readable } from 'stream';
import { createLogger } from '../logger/logger';

const Log = createLogger({
  context: {
    source: 'change-listener-manager',
  },
});

/**
 * A readable stream that may optionally expose an adapter-specific cleanup hook.
 *
 * Some adapters (e.g., Mongo change streams) need an explicit close step to avoid
 * leaving underlying resources open. When present, `cleanup()` should close those
 * resources. If absent, callers should fall back to `stream.destroy()`.
 */
type ReadableWithCleanup = Readable & {
  cleanup?: () => Promise<void> | void;
};

/**
 * Closes a stream, running the adapter cleanup hook first if present.
 * Always resolves — never throws.
 *
 * @param stream - The stream to close.
 * @private
 */
async function _closeStream(stream: ReadableWithCleanup): Promise<void> {
  const maybeCleanup = stream.cleanup;

  try {
    if (maybeCleanup) {
      await maybeCleanup();
    }
  } catch {
    // swallow — best-effort close
  } finally {
    stream.destroy();
  }
}

/**
 * Manages change listeners for database collections.
 *
 * The `ChangeListenerManager` allows registering, removing, and managing
 * listeners for changes in database collections. It works with the DataManager
 * to ensure a database-agnostic implementation.
 */
class ChangeListenerManager extends EventEmitter {
  private static instance: ChangeListenerManager | undefined = undefined;
  private changeListeners: Map<
    string,
    {
      stream: ReadableWithCleanup;
      collectionName: string;
      changeType: CollectionChangeType;
      cleanup: () => void;
    }
  > = new Map();

  private constructor() {
    super();
  }

  /**
   * Retrieves the singleton instance of `ChangeListenerManager`.
   * @returns {ChangeListenerManager} The singleton instance.
   */
  public static getInstance(): ChangeListenerManager {
    if (!ChangeListenerManager.instance) {
      ChangeListenerManager.instance = new ChangeListenerManager();
    }
    return ChangeListenerManager.instance;
  }

  protected static killInstance(): void {
    if (ChangeListenerManager.instance) {
      ChangeListenerManager.instance = undefined;
    }
  }

  /**
   * Registers a change listener for a specific collection and change type.
   *
   * @template T - The expected type of data emitted by the change stream.
   * @param {string} collectionName - The name of the collection to monitor.
   * @param {CollectionChangeType} changeType - The type of changes to listen for.
   * @param {(data: T) => void} callback - The function to execute on change events.
   */
  public addChangeListener<T = any>(
    collectionName: string,
    changeType: CollectionChangeType,
    callback: (data: T) => void,
  ): void {
    const key = `${collectionName}-${changeType}`;
    if (this.changeListeners.has(key)) {
      Log.warn(`Change listener for ${key} is already registered.`);
      return;
    }

    const stream = DataManager.getInstance().getChangeStream(
      collectionName,
      changeType,
    ) as ReadableWithCleanup;

    const listener = (data: T) => {
      callback(data);
      this.emit(`${collectionName}-${changeType}`, data);
    };

    const errorHandler = (error: Error) => {
      Log.error('Change stream error', error);
    };

    stream.on('data', listener);
    stream.on('error', errorHandler);

    this.changeListeners.set(key, {
      stream,
      collectionName,
      changeType,
      cleanup: () => {
        stream.removeListener('data', listener);
        stream.removeListener('error', errorHandler);
      },
    });

    Log.debug(`Change listener added for ${key}.`);
  }

  /**
   * Removes a change listener for a specific collection and change type.
   *
   * Awaiting this promise ensures the underlying stream (and any adapter-level
   * resources such as a Mongo change stream) are fully closed before returning.
   * This is important when the caller intends to re-open streams shortly after,
   * e.g. during a UserManager re-init in tests or after a graceful restart.
   *
   * @param {string} collectionName - The name of the collection.
   * @param {CollectionChangeType} changeType - The type of changes to stop listening for.
   * @returns {Promise<void>} Resolves when the stream is fully closed.
   */
  public async removeChangeListener(
    collectionName: string,
    changeType: CollectionChangeType,
  ): Promise<void> {
    const key = `${collectionName}-${changeType}`;

    if (!this.changeListeners.has(key)) {
      Log.warn(`No change listener registered for ${key}.`);
      return;
    }

    const { stream, cleanup } = this.changeListeners.get(key)!;

    // Remove event listeners we attached first, so no more callbacks fire.
    cleanup();

    // Delete from the map before awaiting close, so a racing addChangeListener
    // call (if any) can register a fresh stream rather than seeing a stale entry.
    this.changeListeners.delete(key);

    await _closeStream(stream);

    Log.info(`Change listener removed for ${key}.`);
  }

  /**
   * Clears all registered change listeners, awaiting full stream teardown.
   *
   * All streams are closed in parallel so teardown is as fast as possible.
   *
   * @returns {Promise<void>} Resolves when all streams are fully closed.
   */
  public async clearChangeListeners(): Promise<void> {
    const entries = [...this.changeListeners.entries()];

    // Clear the map immediately so any racing addChangeListener calls see a clean state.
    this.changeListeners.clear();

    await Promise.all(
      entries.map(async ([, { stream, cleanup, collectionName, changeType }]) => {
        cleanup();
        await _closeStream(stream);
        Log.info(`Change listener for ${collectionName}:${changeType} removed.`);
      }),
    );

    Log.info(`All custom change listeners removed.`);
  }

  /**
   * Checks if a change listener exists for a given collection and change type.
   *
   * @param {string} collectionName - The name of the collection.
   * @param {CollectionChangeType} changeType - The type of changes to check for.
   * @returns {boolean} True if the listener exists, false otherwise.
   */
  public hasChangeListener(collectionName: string, changeType: CollectionChangeType): boolean {
    return this.changeListeners.has(`${collectionName}-${changeType}`);
  }
}

export { ChangeListenerManager };
