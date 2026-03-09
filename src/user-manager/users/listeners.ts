import { ChangeListenerManager } from '../../data-manager/change-listener.manager';
import { USERS } from '../../data-manager/data-manager.constants';
import { CollectionChangeType } from '../../data-manager/data-manager.type';
import { JUser } from '../types';
import { deleteUserFromCache, upsertUserInCache } from './cache';
import { createLogger } from '../../logger';

const Log = createLogger({ context: { source: 'user-listeners' } });

const clm = ChangeListenerManager.getInstance();

/**
 * Sets up change listeners for user-related database changes.
 *
 * Optionally accepts a hook called when a user is deleted, with the deleted
 * user's uniqueIdentifier (if known). Useful for cascading cache cleanup.
 *
 * @param onUserDeletedByUniqueIdentifier - Optional hook called with the deleted user's uniqueIdentifier.
 */
const setupUserChangeListeners = (
  onUserDeletedByUniqueIdentifier?: (uniqueIdentifier: string) => void,
): void => {
  clm.addChangeListener(USERS, CollectionChangeType.INSERT, (jUser: JUser) => {
    try {
      upsertUserInCache(jUser);
    } catch (error) {
      Log.error('Failed to upsert user in cache on INSERT', { error, userId: jUser?.id });
    }
  });

  clm.addChangeListener(USERS, CollectionChangeType.UPDATE, (jUser: JUser) => {
    try {
      upsertUserInCache(jUser);
    } catch (error) {
      Log.error('Failed to upsert user in cache on UPDATE', { error, userId: jUser?.id });
    }
  });

  clm.addChangeListener(USERS, CollectionChangeType.DELETE, (userId: string) => {
    try {
      const uniqueIdentifier = deleteUserFromCache(userId);

      if (uniqueIdentifier && onUserDeletedByUniqueIdentifier) {
        onUserDeletedByUniqueIdentifier(uniqueIdentifier);
      }
    } catch (error) {
      Log.error('Failed to delete user from cache on DELETE', { error, userId });
    }
  });
};

/**
 * Removes user-related change listeners.
 */
const removeUserChangeListeners = (): void => {
  clm.removeChangeListener(USERS, CollectionChangeType.INSERT);
  clm.removeChangeListener(USERS, CollectionChangeType.UPDATE);
  clm.removeChangeListener(USERS, CollectionChangeType.DELETE);
};

export { setupUserChangeListeners, removeUserChangeListeners };
