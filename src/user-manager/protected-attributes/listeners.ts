import { ChangeListenerManager } from '../../data-manager/change-listener.manager';
import { PROTECTED_ATTRIBUTES } from '../../data-manager/data-manager.constants';
import { CollectionChangeType } from '../../data-manager/data-manager.type';
import { ProtectedAttributesRecord } from '../types';
import {
  deleteProtectedAttributesDocByIdFromCache,
  upsertProtectedAttributesInCache,
} from './cache';
import { createLogger } from '../../logger';

const Log = createLogger({ context: { source: 'protected-attributes-listeners' } });

const clm = ChangeListenerManager.getInstance();

/**
 * Sets up change listeners for protected-attributes database changes.
 */
const setupProtectedAttributesChangeListeners = (): void => {
  clm.addChangeListener(
    PROTECTED_ATTRIBUTES,
    CollectionChangeType.INSERT,
    (doc: ProtectedAttributesRecord) => {
      try {
        upsertProtectedAttributesInCache(doc);
      } catch (error) {
        Log.error('Failed to upsert protected attributes in cache on INSERT', {
          error,
          docId: doc?.id,
        });
      }
    },
  );

  clm.addChangeListener(
    PROTECTED_ATTRIBUTES,
    CollectionChangeType.UPDATE,
    (doc: ProtectedAttributesRecord) => {
      try {
        upsertProtectedAttributesInCache(doc);
      } catch (error) {
        Log.error('Failed to upsert protected attributes in cache on UPDATE', {
          error,
          docId: doc?.id,
        });
      }
    },
  );

  clm.addChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeType.DELETE, (docId: string) => {
    try {
      deleteProtectedAttributesDocByIdFromCache(docId);
    } catch (error) {
      Log.error('Failed to delete protected attributes from cache on DELETE', { error, docId });
    }
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
