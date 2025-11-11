
import { Readable } from 'stream';
import {JUser, NewUserRecord} from "../../user-manager/user.type";
import {
  CollectionChangeListener,
  CollectionChangeNotifier,
  CollectionChangeType
} from "../../data-manager/data-manager.type";

export function createMockUser(
overrides: Partial<JUser & Record<string, unknown>> = {}
): JUser {
  const base: JUser = {
    id: 'user-123',
    uniqueIdentifier: 'test-user@example.com',
    attributes: {},
  };

  const { id, uniqueIdentifier, attributes, ...rest } = overrides;

  return {
    id: id ?? base.id,
    uniqueIdentifier: uniqueIdentifier ?? base.uniqueIdentifier,
    attributes: {
      ...base.attributes,
      ...(attributes ?? {}),
      ...rest, // any stray fields become attributes
    },
  };
}

/**
 * Create a mock NewUserRecord.
 *
 * Only `uniqueIdentifier` may be overridden at the top level.
 * Everything else becomes part of `initialAttributes`.
 */
export function createMockNewUserRecord(
  overrides: Partial<NewUserRecord & Record<string, unknown>> = {}
): NewUserRecord {
  const base: NewUserRecord = {
    uniqueIdentifier: 'new-user@example.com',
    initialAttributes: {},
  };

  const { uniqueIdentifier, initialAttributes, ...rest } = overrides;

  return {
    uniqueIdentifier: uniqueIdentifier ?? base.uniqueIdentifier,
    initialAttributes: {
      ...base.initialAttributes,
      ...(initialAttributes ?? {}),
      ...rest,
    },
  };
}

/**
 * Change listener factory.
 */
export function createMockCollectionChangeListener(
  impl?: CollectionChangeListener
): CollectionChangeListener {
  return impl ?? (async () => {});
}

/**
 * Notifier factory with shallow merge on criteria.
 */
export function createMockCollectionChangeNotifier(
  overrides: Partial<CollectionChangeNotifier> = {}
): CollectionChangeNotifier {
  const base: CollectionChangeNotifier = {
    stream: new Readable({
      read() {
        /* no-op */
      },
    }),
    criteria: {
      collectionName: 'test-collection',
      changeType: CollectionChangeType.INSERT,
    },
    listenerList: [],
  };

  return {
    ...base,
    ...overrides,
    criteria: {
      ...base.criteria,
      ...(overrides.criteria ?? {}),
    },
  };
}
