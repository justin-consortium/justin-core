
# Testing Standards for @just-in/core

This document is the “how we actually do it” companion to the main testing README.

The goal: **tests that both prove behavior and explain the codebase to future developers**—including Future You.

---

## 1. Test Philosophy (Short Version)

1. **Behavior over implementation.**  
   Assert *what* the module promises, not *how* it’s wired internally.

2. **Readable first, clever second.**  
   A new dev should be able to skim tests and immediately understand:
    - What the module is for
    - How it behaves on the happy path
    - How it reacts when things go sideways

3. **Tests as documentation.**  
   Think of each `describe` block as a mini guide:
    - “Here’s what this unit does.”
    - “Here’s how it interacts with its neighbors.”

4. **Stable tests, swappable internals.**  
   We lean on public APIs, logger helpers, and mocks that survive refactors.

---

## 2. Test Types and When to Use Them

We mostly write three kinds of tests:

### 2.1 Unit Tests

**Scope:** one module, with dependencies mocked or stubbed.

Use when:
- The module has clear inputs/outputs
- We want fast feedback and tight error messages

Patterns:
- Use **Jest + Sinon** together:
    - Jest for `describe/it/expect`
    - Sinon for spies/stubs/sandbox in more complex cases
- Prefer local helpers from `src/__tests__/` for logger, DataManager, Mongo, etc.

Example of a “good” unit test:
- Arranges a fake dependency via helper
- Calls a single public function
- Asserts:
    - return value
    - side effects (logger calls, event emission, etc.)
    - error handling when dependencies misbehave

### 2.2 Integration Tests

**Scope:** a small cluster of real modules working together, with minimal mocking.

Use when:
- You want to confirm the wiring between related pieces (e.g., `DataManager` + `MongoDBManager`)
- You care about real IO-ish behavior (mongodb-memory-server, change streams, etc.)

Patterns:
- Use `MongoMemoryReplSet` for Mongo-backed flows
- Use real instances of managers (UserManager, DataManager) where possible
- Only stub where it would be painful or flaky to use the real thing

### 2.3 System / Sanity Tests (Lightweight)

We don’t have a huge suite of these, but the idea is:
- Bring up enough of the stack to simulate a real use case
- Prove that the “happy path” still works after structural refactors

These are more expensive and should stay small and focused.

---

## 3. Logger Testing Standards

The logger is central to observability, so we treat it as a first-class test target.

### 3.1 Use `loggerSpies` for Most Tests

We have a shared helper (from `src/__tests__/mocks` / `helpers`) that gives you:

- A sandboxed logger setup using Sinon
- Capture of all emitted log entries
- Convenience assertions like `expectLast(message, severity)`

**Rules:**

1. **One logger sandbox per test (or per suite).**
    - Call `loggerSpies()` in the test or `beforeEach`.
    - Always call `logs.restore()` in `afterEach` or at the end of the test.

2. **Assert shape, not exact detail.**
    - Check `message`, `severity`, and key context fields.
    - Don’t rely on full stack traces or exact error shapes.

3. **Let `normalizeExtraArg` do its thing.**
    - When logging errors or complex objects, assert on normalized forms
      (e.g., `error.message`, `event.eventId`) rather than raw instances.

### 3.2 When to Assert Logs

Assert logging when:
- A function is explicitly responsible for error reporting (e.g. `handleDbError`)
- A branch exists primarily to log something (e.g., “listener already registered”, “invalid payload”)
- The log message conveys key domain behavior (e.g., “Added user: X”, “Created collection users”)

Don’t assert logging for every single `debug` call unless it’s important for understanding.

---

## 4. Mocking and Stubbing Standards

### 4.1 Preferred Tools

- **Jest** for module mocking, test structure, and expectations
- **Sinon** for:
    - `sandbox.stub(...)`
    - `sandbox.spy(...)`
    - Cleaner teardown via `sandbox.restore()`

### 4.2 Patterns We Prefer

1. **Centralized helpers for common fakes.**
    - `makeLoggerSandbox` + `loggerSpies`
    - `makeFakeMongo` (client, db, collection with typed mocks)
    - `createMongoManagerMock` / `mockDataManager`

2. **Avoid hoisted `jest.mock(...)` whenever possible.**
    - They’re sometimes necessary, but they make tests harder to follow.
    - Prefer explicit stubs against imported modules:
      ```ts
      const sb = sinon.createSandbox();
      sb.stub(DataManager, 'getInstance').returns(fakeDm);
      ```

3. **Use `jest.isolateModules` only when needed.**
    - Use it when the module under test captures singletons or logger instances at import time.
    - The pattern:
      ```ts
      jest.isolateModules(() => {
        const { Something } = require('../something');
        // use Something in this block or export via a local variable
      });
      ```

4. **Reset behavior between tests.**
    - Always clean up:
      ```ts
      afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
        sb.restore(); // if using sinon sandbox
      });
      ```

### 4.3 What’s Okay to Mock

- Database adapters (Mongo, DataManager) in **unit** tests
- Logger plumbing (`getGlobalEmitFn`, `defaultEmit`) in **logger** tests
- External integrations in everything except their own integration tests

### 4.4 What We Avoid Mocking

- Core business logic in the same module
- Pure helpers that are easy to exercise directly
- Everything at once—keep the mock surface as small as possible

---

## 5. DataManager / Mongo Testing Patterns

These are foundational pieces, so their tests are a bit more structured.

### 5.1 `DataManager` Unit Tests

- Mock `MongoDBManager` via a helper or module stub.
- Assert that:
    - `init` delegates correctly and enforces the DB type
    - `ensureStore` / `ensureIndexes` only work after init
    - CRUD methods:
        - Call the right adapter methods
        - Emit the expected events (e.g., `userAdded`, `userUpdated`, `userDeleted`)
        - Call `handleDbError` with the right context on failure

### 5.2 `MongoDBManager` Unit Tests

- Use `makeFakeMongo` to provide:
    - `db.listCollections`, `db.createCollection`, `db.command`, `db.collection`
    - `collection.watch`, `collection.insertOne`, `collection.findOne`, etc.
- Stub helpers:
    - `toObjectId`, `transformId`, `asIndexKey`, `normalizeIndexKey`
- Assert that:
    - Collections are only created when needed
    - Validators and indexes are applied correctly
    - IDs are transformed from `_id` to `id`
    - `handleDbError` is called with `message`, `functionName`, and the error

### 5.3 Integration Tests with MongoMemoryServer

Use these when you want to make sure “the whole pipeline works”:

- Spin up `MongoMemoryReplSet`
- Point `MongoDBManager.init` or `DataManager.init` at the URI
- Run real `insert/find/update/delete` or `ensureIndexes` calls
- Tear down cleanly in `afterAll`

Keep these tests small and focused to avoid slow feedback.

---

## 6. UserManager Testing Patterns

User caching and uniqueness logic are easy to break accidentally, so tests here do double duty: they verify behavior and explain the design.

Key behaviors we always cover:

1. **Initialization (init/shutdown):**
    - Ensures stores + indexes
    - Refreshes the cache from the DB
    - Registers and removes change listeners for users

2. **Cache Refresh:**
    - Clears the old cache
    - Transforms `_id` → `id`
    - Stores users keyed by `id`

3. **Add User / Add Users:**
    - Validates payload shapes
    - Enforces unique `uniqueIdentifier`
    - Writes through to DataManager
    - Updates cache
    - Calls `handleDbError` on DB failures

4. **Lookups:**
    - `getAllUsers` returns cache contents
    - `getUserByUniqueIdentifier` scans cache

5. **Updates and Deletes:**
    - Merge attributes and write via DataManager
    - Keep cache in sync
    - Handle not-found cases with clear errors

Tests here should read like a narrative of how the user lifecycle works.

---

## 7. Writing New Tests

When adding a new module or feature:

1. **Decide what kind of test you’re writing.**
    - Pure logic? → unit test
    - Wiring between managers? → integration-ish unit test
    - Real IO? → integration test with MongoMemoryServer

2. **Use the shared helpers.**
    - Need logging? → `loggerSpies()`
    - Need Mongo fakes? → `makeFakeMongo()`
    - Need a DM mock? → `createMongoManagerMock()` or `mockDataManager()`

3. **Name your tests in plain language.**
    - `it('rejects invalid payloads with a clear error', ...)`
    - `it('logs and rethrows when the DB call fails', ...)`

4. **Assert what matters.**
    - The return value or thrown error
    - The logs that explain what happened
    - Any events or side effects that external code relies on

5. **Keep one behavior per test.**
    - If you find yourself asserting 10 different things, you probably have multiple behaviors hiding in one test.

