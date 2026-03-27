/**
 * Base fields that are always present on a persisted just-in user record.
 *
 * These fields are reserved by the framework and must not be supplied inside
 * application-level user attributes.
 */
export type BaseJUser = {
  id: string;
  uniqueIdentifier: string;
};

/**
 * A persisted just-in user record.
 *
 * Application-level user data is flattened onto the top level of the stored
 * record alongside the reserved base fields. There is no nested `attributes`
 * object on the persisted shape.
 *
 * @typeParam TUserData - Additional application-defined fields stored for the user.
 */
export type JUser<TUserData extends Record<string, any> = Record<string, any>> = BaseJUser &
  TUserData;

/**
 * Maps protected-attribute namespaces to their payload shapes.
 *
 * Each key is a namespace name and each value is the payload shape stored for
 * that namespace.
 *
 * @example
 * type MyProtectedSchema = {
 *   fitbit: {
 *     token: string;
 *     deviceId: string;
 *   };
 *   pii: {
 *     ssnLast4: string;
 *     birthMonth: string;
 *   };
 * };
 */
export type ProtectedAttributesSchema = Record<string, Record<string, any>>;

/**
 * A single namespaced protected-attributes payload.
 *
 * Given a schema map, this type produces a discriminated union where the
 * `namespace` value determines the required shape of `protectedAttributes`.
 *
 * @typeParam TSchema - Map of namespace names to protected payload shapes.
 *
 * @example
 * type MyProtectedSchema = {
 *   fitbit: { token: string; deviceId: string };
 *   pii: { ssnLast4: string };
 * };
 *
 * type MyNamespacedAttributes = NamespacedAttributes<MyProtectedSchema>;
 * // becomes:
 * // | { namespace: "fitbit"; protectedAttributes: { token: string; deviceId: string } }
 * // | { namespace: "pii"; protectedAttributes: { ssnLast4: string } }
 */
export type NamespacedAttributes<
  TSchema extends ProtectedAttributesSchema = ProtectedAttributesSchema,
> = {
  [TNamespace in keyof TSchema]: {
    namespace: TNamespace;
    protectedAttributes: TSchema[TNamespace];
  };
}[keyof TSchema];

/**
 * Input shape for creating a new user.
 *
 * `attributes` contains application-level user fields that will be flattened
 * onto the persisted user record alongside `uniqueIdentifier`.
 *
 * `protectedAttributes` is optional. When provided, each entry produces one
 * protected-attributes document in the protected-attributes collection.
 *
 * Reserved user keys such as `id` and `uniqueIdentifier` should not be passed
 * inside `attributes` and are expected to be rejected by runtime validation.
 *
 * @typeParam TUserData - Application-defined user fields supplied at creation time.
 * @typeParam TProtectedSchema - Map of namespace names to protected payload shapes.
 */
export type NewUserRecord<
  TUserData extends Record<string, any> = Record<string, any>,
  TProtectedSchema extends ProtectedAttributesSchema = ProtectedAttributesSchema,
> = {
  uniqueIdentifier: string;
  attributes: TUserData;
  protectedAttributes?: NamespacedAttributes<TProtectedSchema>[];
};

/**
 * Base fields that are always present on a persisted protected-attributes record.
 *
 * These fields are reserved by the framework and must not be overridden by
 * application-level protected data.
 */
export type BaseProtectedAttributes = {
  id: string;
  uniqueIdentifier: string;
  namespace: string;
};

/**
 * A persisted protected-attributes record for a specific namespace and payload shape.
 *
 * The protected payload is always nested under `protectedAttributes` to avoid
 * collisions with reserved top-level fields.
 *
 * @typeParam TNamespace - Namespace name for the protected record.
 * @typeParam TProtectedData - Protected payload shape stored for that namespace.
 */
export type ProtectedAttributesRecord<
  TNamespace extends string = string,
  TProtectedData extends Record<string, any> = Record<string, any>,
> = BaseProtectedAttributes & {
  namespace: TNamespace;
  protectedAttributes: TProtectedData;
};

/**
 * A union of persisted protected-attributes record shapes derived from a schema map.
 *
 * Given a schema map, this type produces a discriminated union where the
 * `namespace` value determines the required shape of `protectedAttributes`.
 *
 * @typeParam TSchema - Map of namespace names to protected payload shapes.
 *
 * @example
 * type MyProtectedSchema = {
 *   fitbit: { token: string; deviceId: string };
 *   pii: { ssnLast4: string };
 * };
 *
 * type MyProtectedRecord = ProtectedAttributesRecordFromSchema<MyProtectedSchema>;
 * // becomes:
 * // | {
 * //     id: string;
 * //     uniqueIdentifier: string;
 * //     namespace: "fitbit";
 * //     protectedAttributes: { token: string; deviceId: string };
 * //   }
 * // | {
 * //     id: string;
 * //     uniqueIdentifier: string;
 * //     namespace: "pii";
 * //     protectedAttributes: { ssnLast4: string };
 * //   }
 */
export type ProtectedAttributesRecordFromSchema<
  TSchema extends ProtectedAttributesSchema = ProtectedAttributesSchema,
> = {
  [TNamespace in keyof TSchema]: ProtectedAttributesRecord<
    Extract<TNamespace, string>,
    TSchema[TNamespace]
  >;
}[keyof TSchema];
