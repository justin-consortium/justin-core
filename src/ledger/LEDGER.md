# Ledger

The Ledger is the audit system for `@just-in/core`. Every time a record is
created, updated, or deleted, the Ledger captures it — what the record looked
like, exactly what changed, and when. That history is permanent and immutable.

The result is a system where you can ask "what did this look like at 9:47am on
March 1st?" and get a correct answer, for any record or the entire database.

---

## What you can do with it

### Ask what a single record looked like at any point in time

```ts
const snap = await ledger.getRecordAsOf('users', userId, new Date('2024-03-01'));
```

Returns the full record as it existed on March 1st. Returns `null` if it
didn't exist yet or had already been deleted.

```ts
// Result
{
  id:     'abc123',
    name:   'Alice',
  status: 'active',
  score:  42,
}
```

### Ask what a whole collection looked like at any point in time

```ts
// All users at that moment
const everyone = await ledger.queryAsOf('users', new Date('2024-03-01'));

// Only active users at that moment
const active = await ledger.queryAsOf(
  'users',
  new Date('2024-03-01'),
  (snap) => snap.status === 'active',
);
```

The filter is optional — leave it out to get everything that was live.

```ts
// Result
[
  { id: 'abc123', name: 'Alice',  status: 'active', score: 42 },
  { id: 'def456', name: 'Carlos', status: 'active', score: 18 },
]
```

### Reconstruct the entire database at any point in time

```ts
const db = await ledger.getDatabaseAsOf(new Date('2024-03-01'));
```

Every collection is included. If all records in a collection had been deleted
by that point, it comes back as an empty array.

```ts
// Result
{
  users: [
    { id: 'abc123', name: 'Alice',  status: 'active' },
    { id: 'def456', name: 'Carlos', status: 'active' },
  ],
    protected_attributes: [
  {
    id: 'pa1',
    uniqueIdentifier: 'alice',
    namespace: 'health',
    protectedAttributes: { steps: 8000 },
  },
],
  interventions: [],
}
```

---

## What each ledger row looks like

Every write produces a row in `ledger_history`. Here is what a full history
looks like for a single user that was created, updated, then deleted.

```ts
// Created at 9:00
{
  entity:      'users',
    recordId:    'abc123',
  operation:   'ADD',
  validFrom:   '2024-03-01T09:00:00Z',
  validTo:     '2024-03-01T09:30:00Z',
  snapshot: {
  id:     'abc123',
    name:   'Alice',
    status: 'active',
},
  diff: {
    added:   { id: 'abc123', name: 'Alice', status: 'active' },
    changed: {},
    removed: {},
  },
  commitId:    'c1',
    committedAt: '2024-03-01T09:00:00Z',
}

// Name updated at 9:30
{
  entity:      'users',
    recordId:    'abc123',
  operation:   'UPDATE',
  validFrom:   '2024-03-01T09:30:00Z',
  validTo:     '2024-03-01T10:00:00Z',
  snapshot: {
  id:     'abc123',
    name:   'Alicia',
    status: 'active',
},
  diff: {
    added:   {},
    changed: { name: { from: 'Alice', to: 'Alicia' } },
    removed: {},
  },
  commitId:    'c2',
    committedAt: '2024-03-01T09:30:00Z',
}

// Deleted at 10:00
{
  entity:      'users',
    recordId:    'abc123',
  operation:   'DELETE',
  validFrom:   '2024-03-01T10:00:00Z',
  validTo:     null,
  snapshot: {
  id:     'abc123',
    name:   'Alicia',
    status: 'active',
},
  diff: {
    added:   {},
    changed: {},
    removed: { id: 'abc123', name: 'Alicia', status: 'active' },
  },
  commitId:    'c3',
    committedAt: '2024-03-01T10:00:00Z',
}
```

Query at `9:15` → row 1 matches → `{ name: 'Alice' }`
Query at `9:45` → row 2 matches → `{ name: 'Alicia' }`
Query at `10:30` → row 3 matches → `null` (deleted)

The `diff` field tracks changes at the field level, including nested fields
using dot notation. If `address.city` changed from Detroit to Dearborn, the
diff shows `'address.city': { from: 'Detroit', to: 'Dearborn' }` — not just
"the address changed."

---

## Grouping related writes

Every write gets its own `commitId` by default. If two writes belong to the
same logical operation — say creating a user and their profile together — and
you don't group them, a reconstruction query landing between the two writes
will see a half-created state that never actually existed.

Group them with a commit context and both rows share the same `commitId` and
`committedAt`:

```ts
const ctx = beginLedgerCommit({ initiatedBy: 'onboarding-flow' });

await dm.addItemToCollection('users',    newUser,    ctx);
await dm.addItemToCollection('profiles', newProfile, ctx);
```

Any `getDatabaseAsOf` query will now see both writes or neither.

---

## What gets tracked and what doesn't

The Ledger captures everything written through `DataManager`. That's it.

The logger is separate. Log entries go to console (or wherever you wire them)
and never pass through `DataManager`. You cannot accidentally get log entries
in the ledger.

If a third-party developer routes writes through `DataManager` — for example
storing their own log entries via `dm.addItemToCollection('logs', entry)` —
those will appear in the ledger. That's by design. The rule is simple:
DataManager in, ledger sees it. Everything else, ledger does not.

---

## How it works

Every successful write through `DataManager` fires a hook. The hook calls
`LedgerManager`, which computes a diff and writes to `ledger_history` via
`MongoLedgerStore`. No manager needs to know any of this exists.

```
UserManager / ContentManager / any manager
        |
        v
  DataManager  ->  writes to main collection
        |  (on success)
        v
  registerLedgerHook
        |
        v
  LedgerManager  ->  computes diff, writes to ledger_history
```

Each row in `ledger_history` has a `validFrom` and `validTo` date. When a
record is updated, the old row's `validTo` is closed and a new row opens.
When deleted, the last row is closed and a tombstone row is written. Point-in-
time queries find the row whose window contains the requested time.

Deletes are handled without an extra database call — the tombstone snapshot
comes from the most recent open ledger entry, which always has the last known
state of the record.

---

## Open concerns

- **Always-on vs opt-in** — the ledger currently starts automatically inside
  `DataManager.init()`. Whether consumers can opt out has not been decided.

- **Bulk write coverage** — `clearCollection` and bulk remove variants do not
  currently fire hooks. This should be reviewed before shipping.

- **Future database support** — the current wiring in `DataManager.init()` is
  Mongo-specific. When a second adapter is added, the ledger store factory
  pattern will need to be introduced. No action needed until then.
