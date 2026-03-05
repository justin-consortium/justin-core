import { ChangeListenerManager } from '../../data-manager/change-listener.manager';
import { PROTECTED_ATTRIBUTES } from '../../data-manager/data-manager.constants';
import { CollectionChangeType } from '../../data-manager/data-manager.type';
import { ProtectedAttributesRecord } from '../user.type';
import {
  deleteProtectedAttributesDocByIdFromCache,
  upsertProtectedAttributesInCache,
} from './protected-attributes-cache';

const clm = ChangeListenerManager.getInstance();

/**
 * Sets up change listeners for protected-attributes database changes.
 */
const setupProtectedAttributesChangeListeners = (): void => {
  clm.addChangeListener(
    PROTECTED_ATTRIBUTES,
    CollectionChangeType.INSERT,
    (doc: ProtectedAttributesRecord) => {
      upsertProtectedAttributesInCache(doc);
    },
  );

  clm.addChangeListener(
    PROTECTED_ATTRIBUTES,
    CollectionChangeType.UPDATE,
    (doc: ProtectedAttributesRecord) => {
      upsertProtectedAttributesInCache(doc);
    },
  );

  clm.addChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.DELETE, (docId: string) => {
    deleteProtectedAttributesDocByIdFromCache(docId);
  });
};

/**
 * Removes protected-attributes change listeners.
 */
const removeProtectedAttributesChangeListeners = (): void => {
  clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.INSERT);
  clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.UPDATE);
  clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.DELETE);
};

export { setupProtectedAttributesChangeListeners, removeProtectedAttributesChangeListeners };
