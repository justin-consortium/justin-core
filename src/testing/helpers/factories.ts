import type { JUser, NewUserRecord } from '../../user-manager/types';

/**
 * Creates a test JUser with optional overrides.
 *
 * Notes:
 * - JUser has no nested `attributes` field; application data is flattened.
 * - Reserved fields (`id`, `uniqueIdentifier`) are set explicitly, and any
 *   other override keys are spread onto the returned object.
 */
export function makeTestJUser(overrides: Partial<JUser> = {}): JUser {
  const id = overrides.id ?? 'u1';
  const uniqueIdentifier = overrides.uniqueIdentifier ?? id;

  const { id: _id, uniqueIdentifier: _uid, ...rest } = overrides as Record<string, any>;

  return {
    id,
    uniqueIdentifier,
    ...rest,
  } as JUser;
}

/**
 * Creates a test NewUserRecord with optional overrides.
 *
 * Notes:
 * - NewUserRecord is now:
 *   { uniqueIdentifier, attributes, protectedAttributes? }
 * - `protectedAttributes` is an array of { namespace, protectedAttributes } objects.
 */
export function makeTestNewUserRecord(overrides: Partial<NewUserRecord> = {}): NewUserRecord {
  return {
    uniqueIdentifier: overrides.uniqueIdentifier ?? 'u1',
    attributes: overrides.attributes ?? {},
    protectedAttributes: overrides.protectedAttributes,
  };
}
