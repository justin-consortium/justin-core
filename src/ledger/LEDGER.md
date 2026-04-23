# Ledger

The Ledger is the audit system for `@just-in/core`. Every time a record is
created, updated, or deleted through the system, the Ledger writes down what
happened, what the record looked like before, what it looks like after, and
exactly when it happened. That history never changes and never gets deleted.

The goal is simple: given any point in time, you should be able to ask
"what did this record look like then?" or "what did the entire database look
like then?" and get a correct answer.

---

## How to use it

### Querying a single record at a point in time

```ts
const snap = await ledger.getRecordAsOf('users', userId, new Date('2024-03-01'));
```

This returns the full record as it existed on March 1st, or `null` if it
didn't exist yet or had already been deleted by then.

### Querying all records in a collection at a point in time

```ts
const activeUsers = await ledger.queryAsOf(
  'users',
  (snap) => snap.status === 'active',
  new Date('2024-03-01'),
);
```

Pass `() => true` as the filter to get everything that was live at that moment.

### Reconstructing the entire database at a point in time

```ts
const db = await ledger.getDatabaseAsOf(new Date('2024-03-01'));
// {
//   users:                [ { id: '...', name: 'Alice', ... }, ... ],
//   protected_attributes: [ { id: '...', ... }, ... ],
// }
```

Every collection that has ever been written is included. Collections where all
records had been deleted by that point come back as empty arrays.

### What a ledger record looks like

Each row in `ledger_history` looks like this:

```ts
{
  entity:      'users',
    recordId:    'abc123',
    operation:   'UPDATE',
    validFrom:   2024-03-01T09:30:00Z,
    validTo:     2024-03-01T10:00:00Z,
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
  commitId:    '01hv3m...',
    committedAt: 2024-03-01T09:30:00Z,
    metadata: {
    initiatedBy: 'admin-script',
  },
}
```

The `diff` field breaks changes down to the field level, including nested
fields using dot notation — so `address.city` changing shows up as
`'address.city': { from: 'Detroit', to: 'Dearborn' }` rather than the whole
address object being replaced.

### Grouping writes together

By default every write gets its own `commitId` and `committedAt`. That works
fine for independent operations. The problem is when two writes are part of
the same logical operation — say creating a user and their profile at the same
time. Without grouping, those two writes get different timestamps. If you call
`getDatabaseAsOf` at a moment that lands between them, you will see a
half-created state that never actually existed in your application.

To prevent this, group the writes under a single commit context. Both rows in
the ledger will share the same `commitId` and `committedAt`, so any
reconstruction query will see both writes or neither:

```ts
const ctx = beginLedgerCommit({ initiatedBy: 'onboarding-flow' });

await dm.addItemToCollection('users', newUser, ctx);
await dm.addItemToCollection('profiles', newProfile, ctx);
```

The `initiatedBy` field is optional but useful for audit trails — it records
who or what triggered the change. You can put anything in metadata that helps
you understand the history later.

### What the Ledger does and does not track

The Ledger tracks everything written through `DataManager`. If a write goes
through `DataManager`, it will appear in `ledger_history`. If it doesn't, it
won't.

The logger is completely separate. The logger has its own output path —
console by default, or whatever a third-party developer wires it to. Log
entries never pass through `DataManager`, so they never appear in the ledger
regardless of where you direct log output. You cannot accidentally pollute the
ledger with log entries.

The one thing to be aware of: if a third-party developer stores log entries in
their own collection _through DataManager_ — say they call
`dm.addItemToCollection('logs', entry)` — those writes will be tracked by the
ledger just like any other write. That is working as designed, since they made
an explicit choice to route through `DataManager`, but they should know it will
be captured.

The rule is simple: DataManager in, ledger sees it. Everything else, ledger
does not.

---

## How it works under the hood

### One table for everything

There is one `ledger_history` collection in MongoDB. Every collection — users,
interventions, protected attributes, anything — shares it. Each row knows
which collection it belongs to via the `entity` field.

This is a deliberate choice. The whole point of the Ledger is cross-collection
reconstruction. One table makes `getDatabaseAsOf` straightforward. Separate
tables per collection would require N queries and a registry of what collections
exist.

### Validity intervals

Every row has a `validFrom` and `validTo` date. Together they describe the
window of time when that version of the record was the current version.

When a record is created, it gets a row with `validFrom = now` and
`validTo = null`. The null means "this is the current version."

When the record is updated, the old row gets its `validTo` filled in and a new
row is written with the updated data and `validTo = null`.

When the record is deleted, the same thing happens — the last open row is
closed and a final tombstone row is written marking the deletion.

To find what a record looked like at time T, the query is:

```
validFrom <= T  AND  (validTo IS NULL OR validTo > T)
```

### How the delete pre-image works

When a record is deleted, the Ledger still needs to record what the record
looked like at the moment of deletion. Rather than fetching it from the main
database (which may have already removed it), the Ledger looks up the most
recent open row in `ledger_history` for that record. That row already has the
last known snapshot. No extra database call is needed.

This is only possible because the Ledger has been capturing every write — if a
write ever bypassed the Ledger, the open row might be missing or stale.

### How writes are captured

The Ledger hooks into `DataManager` at startup. Every successful write that
passes through `DataManager` — from any manager, first-party or third-party —
fires the hook. The hook then writes to `ledger_history`. No manager needs to
know the Ledger exists.

### The storage layer

`LedgerStore` is an interface. The production implementation is
`MongoLedgerStore`, which writes to the `ledger_history` collection. The
testing package provides `InMemoryLedgerStore`, which holds entries in memory
and is used in tests. The two are interchangeable — `LedgerManager` only
depends on the interface.

---

## What is still needed

The Ledger logic is complete. What is not built yet:

- **`MongoLedgerStore`** — writes to and reads from the real `ledger_history`
  collection in MongoDB. Tests currently use `InMemoryLedgerStore` as a
  stand-in.

- **DataManager wiring** — the hook registration point inside `DataManager`
  that fires after every successful write, plus the optional commit context
  parameter on write methods. Until this is in place the Ledger receives
  nothing.

Once those two pieces are in place, the Ledger is production-ready.
