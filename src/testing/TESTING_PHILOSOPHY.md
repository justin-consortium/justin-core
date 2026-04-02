# Justin Testing Philosophy (All Packages)

This document defines **shared testing philosophy, patterns, and expectations**
across the Justin ecosystem. It is written to be useful both for human
developers and as context for an AI agent writing tests.

Each package adds **package-specific guidance** in its own `TESTING_<PACKAGE>.md`
file, but this file is the common baseline.

---

## Test Layers — The Core Definition

Justin uses exactly three test layers. Each has a single job. Do not mix them.

---

### Unit Tests — isolate one function or module

**Job:** Verify that a single function or module does what it claims,
with all dependencies mocked or stubbed.

**Rules:**

- Every external dependency is replaced with a Sinon stub
- No real I/O — no real DB, no real network, no real timers
- Fast: a full unit suite should run in seconds
- One top-level `describe` block per source file under test

**Decision check:**

> "If I change only the code in this one file, and nothing else, does
> this test break?"

If the answer requires reasoning about any other file's real behavior,
it is not a unit test.

**File naming:** `<module>.unit.test.ts`
**Location:** `src/<module>/__tests__/<module>.unit.test.ts`

---

### Integration Tests — verify collaboration between internal components

**Job:** Verify that two or more internal components produce the correct
combined result when wired together with real infrastructure.

**Rules:**

- Uses real infrastructure (real Mongo via `MongoMemoryReplSet`)
- Imports and calls internal functions directly — not through the public API
- Asserts on both the DB state and the in-memory cache state
- Covers things unit tests cannot: cache/DB agreement, change stream
  callbacks updating the cache, lifecycle wiring, cache refresh from DB

**Decision check:**

> "Am I testing how component A and component B work together, using
> real infrastructure?"

If yes, this is an integration test.

**File naming:** `<module>.integration.test.ts`
**Location:** `src/<module>/__tests__/<module>.integration.test.ts`

---

### E2E Tests — verify the public API as a black box

**Job:** Verify the public API exactly as a third-party consumer would use it.
The test should make sense to someone who has never read the source code.

**Rules:**

- Only calls functions exported from the public API surface
- Never imports from internal modules
- Never accesses the DB directly
- Never reads internal cache state directly
- Treats the system as a black box: inputs go in, observable outputs come out

**Decision check:**

> "Would a developer who only has the package's README write this test?"

If not, it belongs in integration tests instead.

**File naming:** `<module>.e2e.test.ts`
**Location:** `src/<module>/__tests__/<module>.e2e.test.ts`

---

## Layer Decision Tree

When writing a new test, walk this tree:

```
Does it call only the public API and assert only through the public API?
├─ YES → e2e test
└─ NO
   └─ Does it call internal functions directly with real infrastructure?
      ├─ YES → integration test
      └─ NO (all deps mocked/stubbed)
         └─ unit test
```

---

## Core Principles

### 1) Tests Explain Intent

Test names should read like sentences:

> "Given this scenario, what should happen?"

**Good**

- `returns null when identifier is invalid`
- `logs and rethrows the same Error instance`
- `cache is updated after change stream fires`

**Bad**

- `test update`
- `misc edge case`
- `works fine`

If a test name doesn't explain behavior, rewrite it.

---

### 2) Behavior Over Implementation

Tests should assert **observable behavior**, not internal structure.

Avoid:

```ts
expect(ctx.error.stack).toBeDefined();
```

Prefer:

```ts
expect(ctx.error).toMatchObject({ message: 'boom' });
```

---

### 3) Shared Helpers Over Ad-Hoc Mocking

If you copy/paste test setup more than once, extract it to a helper.

Helpers should **prepare inputs or infrastructure** — not perform assertions
or decide what "passed" means. Tests own their assertions.

**Discouraged pattern** — helper that bundles assertions:

```ts
async function runAndExpectSuccess(rule) {
  const result = await execute(rule);
  expect(result.ok).toBe(true); // ← assertion in helper
  expectLastLog('executed', 'INFO'); // ← assertion in helper
  return result;
}
```

**Preferred pattern** — helper that prepares, test that asserts:

```ts
async function createUser(uid: string) {
  return expectOk(await UserManager.createUser({ uniqueIdentifier: uid, attributes: {} }));
}

it('returns the created user', async () => {
  const user = await createUser('alice');
  expect(user.uniqueIdentifier).toBe('alice'); // ← assertion in test
});
```

---

### 4) Structure Tells the Story

```ts
describe('<module or public method>', () => {
  describe('<behavior group>', () => {
    it('<specific scenario>', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

---

## Tooling Standards

### Sinon for Mocks / Spies / Stubs

Justin standardizes on **Sinon** for all test doubles.

**Never use:**

- `jest.fn()`
- `jest.spyOn()`
- `jest.mock()`
- `jest.useFakeTimers()`

Jest is the **test runner and assertion library only**.

---

## Helpers vs Testkits

| Category   | Location               | Purpose                                         |
| ---------- | ---------------------- | ----------------------------------------------- |
| `helpers/` | `src/testing/helpers/` | Small utilities, assertion wrappers, factories  |
| `testkit/` | `src/testing/testkit/` | Sandboxes, mock factories, coordinated stubbing |

Rule: _utility → helper_, _environment / sandbox → testkit_

---

## Final Rule

If a test fails and the failure message does not immediately explain
_what broke and where_, the test is not done yet.
