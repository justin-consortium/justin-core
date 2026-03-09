/**
 * Base fields that are always present on a Justin user.
 *
 * These fields are reserved and should not be overridden by
 * application-level user data.
 */
export type BaseJUser = {
  id: string;
  uniqueIdentifier: string;
};

/**
 * A Justin user record.
 *
 * TUserData represents all additional user fields.
 */
export type JUser<TUserData extends Record<string, any> = Record<string, any>> = BaseJUser &
  TUserData;

/**
 * Namespaced protected attributes payload for a user.
 */
export type NamespacedAttributes = {
  namespace: string;
  protectedAttributes: Record<string, any>;
};

/**
 * Shape used to create a new user.
 *
 * Notes:
 * - `attributes` is an input wrapper; on persistence, these fields are flattened
 *   onto the user record alongside `uniqueIdentifier` (with reserved fields protected).
 * - `protectedAttributes` is optional and creates one protected-attributes doc per namespace.
 */
export type NewUserRecord = {
  uniqueIdentifier: string;
  attributes: Record<string, any>;
  protectedAttributes?: NamespacedAttributes[];
};

/**
 * Base fields that are always present on a protected-attributes record.
 *
 * These fields are reserved and should not be overridden by
 * application-level protected attributes data.
 */
export type BaseProtectedAttributes = {
  id: string;
  uniqueIdentifier: string;
  namespace: string;
};

/**
 * A protected-attributes record.
 *
 * We store the payload under `protectedAttributes` to avoid field collisions.
 */
export type ProtectedAttributesRecord<
  TProtectedData extends Record<string, any> = { protectedAttributes: Record<string, any> },
> = BaseProtectedAttributes & TProtectedData;
