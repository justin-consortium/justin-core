export type JUser = {
  id: string;
  uniqueIdentifier: string;
  attributes: Record<string, any>;
};

export type JUserProtectedAttributes = Record<string, any>;

export type NewUserRecord = {
  uniqueIdentifier: string;
  initialAttributes: Record<string, any>;
  protectedAttributes?: JUserProtectedAttributes;
};

export type JUserProtectedRecord = {
  id: string;
  userId: string;
  protectedAttributes: JUserProtectedAttributes;
};

export type JUserWithProtectedAttributes = JUser & {
  protectedAttributes: JUserProtectedAttributes;
};
