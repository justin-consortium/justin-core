import { ChangeListenerManager, CollectionChangeTypeEnum } from '../../data-manager';
import { PROTECTED_ATTRIBUTES } from '../constants';
import type { ProtectedAttributesRecord } from '../types';
import { deleteProtectedAttributesByIdFromCache, upsertProtectedAttributesInCache } from './cache';
import { createLogger } from '../../logger';

const Log = createLogger({
  context: { package: '@just-in/core', source: 'protected-attributes-listeners' },
});

const clm = ChangeListenerManager.getInstance();

/**
 * Sets up change listeners for protected-attributes database changes.
 */
const setupProtectedAttributesChangeListeners = (): void => {
  clm.addChangeListener(
    PROTECTED_ATTRIBUTES,
    CollectionChangeTypeEnum.INSERT,
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
    CollectionChangeTypeEnum.UPDATE,
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

  clm.addChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeTypeEnum.DELETE, (docId: string) => {
    try {
      deleteProtectedAttributesByIdFromCache(docId);
    } catch (error) {
      Log.error('Failed to delete protected attributes from cache on DELETE', { error, docId });
    }
  });
};

/**
 * Removes protected-attributes change listeners.
 * Awaits each removal to ensure underlying streams are fully closed.
 */
const removeProtectedAttributesChangeListeners = async (): Promise<void> => {
  await clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeTypeEnum.INSERT);
  await clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeTypeEnum.UPDATE);
  await clm.removeChangeListener(PROTECTED_ATTRIBUTES, CollectionChangeTypeEnum.DELETE);
};

export { setupProtectedAttributesChangeListeners, removeProtectedAttributesChangeListeners };
