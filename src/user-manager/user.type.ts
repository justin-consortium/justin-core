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
export type JUser<
  TUserData extends Record<string, any> = Record<string, any>,
> = BaseJUser & TUserData;


export type NewUserRecord<
  TUserData extends Record<string, any> = Record<string, any>,
> = {
  uniqueIdentifier: string;
  initialAttributes?: Omit<TUserData, keyof BaseJUser>;
};
