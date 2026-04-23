
/** The type of write operation that produced a {@link LedgerEntry}. */
type LedgerOperation = 'ADD' | 'UPDATE' | 'DELETE';

/**
 * A deep, path-keyed diff between two record snapshots.
 *
 * Keys use dot notation for nested fields: `"address.city"`, `"tags.0"`, etc.
 * Only leaf-level changes are recorded — intermediate path segments are not
 * emitted on their own.
 *
 * - **ADD**    — all fields appear in `added`; `changed` and `removed` are empty.
 * - **UPDATE** — only the fields that actually changed appear, across all three buckets.
 * - **DELETE** — all fields appear in `removed`; `added` and `changed` are empty.
 *
 * @example
 * ```ts
 * // UPDATE: name changed, role removed, score added
 * {
 *   added:   { score: 42 },
 *   changed: { name: { from: 'Alice', to: 'Alicia' } },
 *   removed: { role: 'admin' },
 * }
 * ```
 */
type LedgerDiff = {
  /** Fields that did not exist in the previous snapshot. */
  added: Record<string, unknown>;
  /** Fields whose value changed between snapshots. */
  changed: Record<string, { from: unknown; to: unknown }>;
  /** Fields that existed in the previous snapshot but are no longer present. */
  removed: Record<string, unknown>;
};

/**
 * A single version of a record as captured by the ledger.
 *
 * Each entry represents one validity interval for a given `recordId`. When a
 * record is updated the previous entry's `validTo` is closed and a new entry
 * is opened with `validFrom = committedAt` and `validTo = null`.
 *
 * A version is **active at time T** when:
 * ```
 * validFrom <= T  AND  (validTo IS NULL OR validTo > T)
 * ```
 */
type LedgerEntry = {
  /** Collection name — corresponds to a DataManager collection. */
  entity: string;
  /** The `id` of the record in the underlying collection. */
  recordId: string;
  /**
   * Start of this version's validity interval (inclusive).
   * Set to `committedAt` at the time the write was processed.
   */
  validFrom: Date;
  /**
   * End of this version's validity interval (exclusive).
   * `null` means this is the current open version.
   * Closed when a subsequent UPDATE or DELETE arrives.
   */
  validTo: Date | null;
  /** The write operation that created this version. */
  operation: LedgerOperation;
  /**
   * Full post-image of the record after the write.
   *
   * For DELETE entries this carries the last known snapshot sourced directly
   * from the most recent open ledger entry — no extra DB round-trip is needed.
   */
  snapshot?: Record<string, unknown>;
  /**
   * Deep diff between the previous snapshot and this version.
   *
   * - ADD    → all fields in `added`; `changed` and `removed` empty
   * - UPDATE → only fields that changed, across all three buckets
   * - DELETE → all fields in `removed`; `added` and `changed` empty
   */
  diff: LedgerDiff;
  /**
   * Sortable commit identifier (ULID-lite format).
   * Shared across all entries produced within the same {@link LedgerCommitContext}.
   */
  commitId: string;
  /** Wall-clock time the commit was initiated. Shared within a commit group. */
  committedAt: Date;
  /** Optional metadata forwarded from the originating write call. */
  metadata?: {
    /** Identity of the actor that initiated the write, if known. */
    initiatedBy?: string;
    [k: string]: unknown;
  };
};

/**
 * Payload delivered to every registered {@link LedgerWriteHook} after a
 * successful DataManager write operation.
 */
type LedgerWriteEvent = {
  /** Collection that was written to. */
  entity: string;
  /** ID of the affected record. */
  recordId: string;
  /** The write operation type. */
  operation: LedgerOperation;
  /**
   * Post-image snapshot for ADD / UPDATE.
   * Omitted for DELETE — {@link LedgerManager} sources it from the open ledger
   * entry so no DB round-trip is required.
   */
  snapshot?: Record<string, unknown>;
  /** Active commit context at the time of the write. */
  commit: LedgerCommitContext;
};

/**
 * A function registered with DataManager that receives every successful write
 * event and is responsible for persisting the audit entry.
 *
 * Hooks must never throw — failures should be logged and swallowed so that
 * business operations are never blocked by audit failures.
 */
type LedgerWriteHook = (event: LedgerWriteEvent) => Promise<void>;

/**
 * Groups multiple write operations under a single logical commit.
 *
 * All entries produced while a `LedgerCommitContext` is active share the same
 * `commitId` and `committedAt`, enabling atomic reconstruction of a
 * multi-record change at a specific point in time.
 */
type LedgerCommitContext = {
  /** ULID-lite sortable commit identifier. */
  commitId: string;
  /** Wall-clock time the commit was created. */
  committedAt: Date;
  /** Optional metadata forwarded to each {@link LedgerEntry}. */
  metadata?: LedgerEntry['metadata'];
};

/**
 * The full reconstructed database state at a specific point in time.
 *
 * Each key is an entity (collection) name; the value is the array of record
 * snapshots that were active at the requested timestamp.
 */
type DatabaseSnapshot = Record<string, Array<Record<string, unknown>>>;

export type {
  LedgerOperation,
  LedgerDiff,
  LedgerEntry,
  LedgerWriteEvent,
  LedgerWriteHook,
  LedgerCommitContext,
  DatabaseSnapshot,
};
