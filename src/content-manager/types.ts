/**
 * Base fields that are always present on a just-in content record.
 *
 * These fields are reserved and must not be supplied inside `value` when
 * creating or updating content.
 */
type BaseJContent = {
  id: string;
  uniqueIdentifier: string;
  type: string;
};

/**
 * A just-in content record.
 *
 * The `type` field categorises the record (e.g. `'gif'`, `'message'`,
 * `'push-notification'`, `'questionnaire'`). The `value` object holds the
 * actual content payload — its shape is determined by the type and is
 * intentionally open-ended so different content shapes can live in the same
 * collection without a fixed schema.
 *
 * @example
 * ```ts
 * // A gif content record
 * const gif: JContent = {
 *   id: 'abc123',
 *   uniqueIdentifier: 'gif-walking-1',
 *   type: 'gif',
 *   value: { url: 'https://...', altText: 'Person walking' },
 * };
 *
 * // A push notification record
 * const push: JContent = {
 *   id: 'def456',
 *   uniqueIdentifier: 'push-morning-1',
 *   type: 'push-notification',
 *   value: { title: 'Time to move!', body: 'You have been sitting for an hour.' },
 * };
 * ```
 */
type JContent = BaseJContent & {
  /** Open-ended payload whose shape is defined by the content `type`. */
  value: Record<string, unknown>;
};

/**
 * Input shape for creating a new content record.
 *
 * - `uniqueIdentifier` must be unique across all content records — it is the
 *   human-readable slug used to reference the content (e.g. `'gif-walking-1'`).
 * - `type` categorises the record for filtering via {@link ContentManager.getContentByType}.
 * - `value` is the open-ended payload. Reserved keys (`id`, `uniqueIdentifier`,
 *   `type`) are rejected.
 */
type NewContentRecord = {
  uniqueIdentifier: string;
  type: string;
  value: Record<string, unknown>;
};

/**
 * Input shape for updating an existing content record.
 *
 * All fields are optional — only the provided fields are updated. Reserved
 * keys (`id`, `uniqueIdentifier`, `type`) are rejected.
 */
type ContentUpdateRecord = {
  /** New human-readable slug. Must remain unique if changed. */
  uniqueIdentifier?: string;
  /** Replacement `value` payload. Fully replaces the existing value. */
  value?: Record<string, unknown>;
};

export type { BaseJContent, JContent, NewContentRecord, ContentUpdateRecord };
