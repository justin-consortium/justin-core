/**
 * Base fields that are always present on a just-in user record.
 *
 * These fields are reserved and must not be overridden by application-level
 * user data passed through `attributes`.
 */
export type BaseJUser = {
  id: string;
  uniqueIdentifier: string;
};

/**
 * A just-in user record.
 *
 * Application-level data is flattened onto the record alongside the reserved
 * base fields — there is no nested `attributes` object on the persisted shape.
 *
 * @typeParam TUserData - Additional fields the application stores per user.
 */
export type JUser<TUserData extends Record<string, any> = Record<string, any>> = BaseJUser &
  TUserData;

/**
 * Namespaced protected attributes payload for a user.
 *
 * Each namespace produces one isolated document in the protected-attributes
 * collection. Use separate namespaces to partition sensitive data by concern
 * (e.g. `'pii'`, `'fitbit'`, `'health'`).
 */
export type NamespacedAttributes = {
  namespace: string;
  protectedAttributes: Record<string, any>;
};

/**
 * Input shape for creating a new user.
 *
 * - `attributes` is flattened onto the persisted record alongside
 *   `uniqueIdentifier`. Reserved keys (`id`, `uniqueIdentifier`) are rejected.
 * - `protectedAttributes` is optional — one protected-attributes document is
 *   created per namespace entry.
 */
export type NewUserRecord = {
  uniqueIdentifier: string;
  attributes: Record<string, any>;
  protectedAttributes?: NamespacedAttributes[];
};

/**
 * Base fields that are always present on a protected-attributes record.
 *
 * Reserved — must not be overridden by application-level data.
 */
export type BaseProtectedAttributes = {
  id: string;
  uniqueIdentifier: string;
  namespace: string;
};

/**
 * A protected-attributes record.
 *
 * The payload lives under the `protectedAttributes` key to avoid field
 * collisions with the base fields.
 *
 * @typeParam TProtectedData - Shape of the protected payload.
 */
export type ProtectedAttributesRecord<
  TProtectedData extends Record<string, any> = { protectedAttributes: Record<string, any> },
> = BaseProtectedAttributes & TProtectedData;
