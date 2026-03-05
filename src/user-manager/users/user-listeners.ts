import { ChangeListenerManager } from '../../data-manager/change-listener.manager';
import { USERS } from '../../data-manager/data-manager.constants';
import { CollectionChangeType } from '../../data-manager/data-manager.type';
import { JUser } from '../user.type';
import { deleteUserFromCache, upsertUserInCache } from './user-cache';

const clm = ChangeListenerManager.getInstance();

/**
 * Sets up change listeners for user-related database changes.
 *
 * Optionally accepts a hook that will be called when a user is deleted,
 * with the deleted user's uniqueIdentifier (if known). This is useful for
 * cascading cache cleanup (e.g. protected-attributes cache).
 *
 * @param {(uniqueIdentifier: string) => void} [onUserDeletedByUniqueIdentifier] - Optional hook.
 */
const setupUserChangeListeners = (
  onUserDeletedByUniqueIdentifier?: (uniqueIdentifier: string) => void,
): void => {
  clm.addChangeListener(USERS, CollectionChangeType.INSERT, (jUser: JUser) => {
    upsertUserInCache(jUser);
  });

  clm.addChangeListener(USERS, CollectionChangeType.UPDATE, (jUser: JUser) => {
    upsertUserInCache(jUser);
  });

  clm.addChangeListener(USERS, CollectionChangeType.DELETE, (userId: string) => {
    const uniqueIdentifier = deleteUserFromCache(userId);

    if (uniqueIdentifier && onUserDeletedByUniqueIdentifier) {
      onUserDeletedByUniqueIdentifier(uniqueIdentifier);
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
