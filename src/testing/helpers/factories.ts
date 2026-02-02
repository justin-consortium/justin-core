import {JUser, NewUserRecord} from "../../user-manager/user.type";

export function makeUser(
  overrides: Partial<JUser> = {},
): JUser {
  const id = overrides.id ?? 'u1';
  const uniqueIdentifier = overrides.uniqueIdentifier ?? id;

  return {
    id,
    uniqueIdentifier,
    attributes: overrides.attributes ?? {},
  };
}

export function makeNewUserRecord(
  overrides: Partial<NewUserRecord> = {},
): NewUserRecord {
  return {
    uniqueIdentifier: overrides.uniqueIdentifier ?? 'u1',
    initialAttributes: overrides.initialAttributes ?? {},
  };
}
