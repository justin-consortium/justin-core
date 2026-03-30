import type { JUser, NewUserRecord } from '../../user-manager/types';

// ---------------------------------------------------------------------------
// User factories
// ---------------------------------------------------------------------------

/**
 * Creates a test {@link JUser} with optional field overrides.
 *
 * The `id` defaults to `'u1'` and `uniqueIdentifier` defaults to the `id`
 * value. Application-level fields can be added via the overrides object.
 *
 * @param overrides - Optional fields to merge onto the default user shape.
 */
export function makeTestJUser(overrides: Partial<JUser> = {}): JUser {
  const id = overrides.id ?? 'u1';
  const uniqueIdentifier = overrides.uniqueIdentifier ?? id;
  const { id: _id, uniqueIdentifier: _uid, ...rest } = overrides as Record<string, any>;
  return { id, uniqueIdentifier, ...rest } as JUser;
}

/**
 * Creates a test {@link NewUserRecord} with optional field overrides.
 *
 * @param overrides - Optional fields to merge onto the default record shape.
 */
export function makeTestNewUserRecord(overrides: Partial<NewUserRecord> = {}): NewUserRecord {
  return {
    uniqueIdentifier: overrides.uniqueIdentifier ?? 'u1',
    attributes: overrides.attributes ?? {},
    protectedAttributes: overrides.protectedAttributes,
  };
}
