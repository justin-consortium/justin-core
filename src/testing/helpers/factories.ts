import type { JUser, NewUserRecord } from '../../user-manager/user.type';

export function makeUser(overrides: Partial<JUser> = {}): JUser {
  const id = overrides.id ?? 'u1';
  const uniqueIdentifier = overrides.uniqueIdentifier ?? id;

  const { id: _id, uniqueIdentifier: _uid, ...rest } = overrides as Record<string, any>;

  return {
    id,
    uniqueIdentifier,
    ...rest,
  } as JUser;
}

export function makeNewUserRecord(overrides: Partial<NewUserRecord> = {}): NewUserRecord {
  return {
    uniqueIdentifier: overrides.uniqueIdentifier ?? 'u1',
    initialAttributes: overrides.initialAttributes ?? {},
  };
}
