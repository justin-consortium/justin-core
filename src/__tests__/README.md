# Testing Philosophy & Practices for @just-in/core

This document describes **how we test**, **why we test this way**, and **how you (a new contributor) can write tests that fit naturally into the Justin codebase**.

---

# Why We Test the Way We Do

Testing in Justin is not just about proving correctness.  
Our tests act as **living documentation**.

When a future developer reads a test file, they should walk away understanding:

- **What the function is supposed to do**
- **Why it does it that way**
- **How it behaves in edge cases**
- **Its contract with the rest of the system**
- **How data and logging are supposed to flow**

Good tests make subtle behavior obvious.

---

# Guiding Principles

## 1. Tests Should Explain Intent
A test name should read like a sentence (remember tests tend to start with the it() function:

> “Given this scenario, what should happen?”

Good examples:

- `returns null when toObjectId fails`
- `logs and rethrows the same Error instance`
- `caches user after successful insert`
- `pushes normalized doc on DELETE change stream`

Bad examples:

- `test findOne`
- `cache test`
- `misc logger test`

Each test is a short story.  
Future developers should infer the *spec* from the tests alone.

---

## 2. Avoid Internal Coupling

We assert **meaningful outcomes**, not internal structures.

Instead of checking exact nested structure of `ctx.error`, we use:

```ts
expect(logCtx.error).toMatchObject({ message: "boom" });
```

Why?

Because logging internals may evolve, but the *contract* stays stable.

---

## 3. Prefer Shared Helpers Over Ad‑Hoc Mocking

We use standardized helpers:

- `loggerSpies()` — capture real logs without stubbing the logger
- `makeFakeMongo()` — unit test MongoDBManager without a real Mongo server
- `makeDmMock()` — mock the DataManager singleton
- `sinon sandbox` — consistent stubbing and cleanup

Helpers make tests:

- Cleaner
- Consistent
- Easier to read
- Easier to maintain

If mocking becomes repetitive, **write a small helper**—it’s worth it.

---

## 4. Unit Tests First, Integration Tests When It Matters
Unit tests define the intent.  
Integration tests confirm our assumptions about processes.

### Unit tests
Mock everything. Fast and deterministic.

### Integration tests
When you want to see how the functions nteract together.
See that our database interactions work as intended

Only used when we need real Mongo semantics via `mongodb-memory-server`:

- Confirm Mongo index behavior
- Confirm query semantics
- Confirm change stream mechanics

---

## 5. Tests Should Tell the Story of the Module

Our structure:

1. **Top-level describe** — module or class
2. **Nested describes** — grouped behaviors
3. **Arrange → Act → Assert** clearly separated

Example:

```ts
describe("findItemByIdInCollection", () => {
  it("returns null if toObjectId fails", async () => {
    toObjectIdStub.returns(null);

    const result = await MongoDBManager.findItemByIdInCollection("users", "bad-id");

    expect(result).toBeNull();
  });
});
```

Readable, direct, minimal magic.

---

# Tools & Helpers

## loggerSpies()

Don’t mock the logger. Capture its behavior.

```ts
const logs = loggerSpies();
fn();
logs.expectLast("message text", "ERROR");
expect(logs.last()?.ctx.userId).toBe("123");
logs.restore();
```

This tests the **actual logger plumbing**, not the implementation.

---

## makeFakeMongo()

For unit testing `MongoDBManager`:

```ts
const mongo = makeFakeMongo();
TestingMongoDBManager._setDatabaseInstance(mongo.db);
TestingMongoDBManager._setClient(mongo.client);
TestingMongoDBManager._setIsConnected(true);
```

It provides:

- `collection()` mocks
- `findOne`, `insertOne`, `countDocuments`, etc.
- `watch()` implemented using `EventEmitter`

---

## sinon Sandbox

We standardize around sinon for:

- stub lifecycle
- safe restore
- consistent mocking
- clean test isolation

Pattern:

```ts
let sb: SinonSandbox;

beforeEach(() => {
  sb = sinon.createSandbox();
});
afterEach(() => {
  sb.restore();
});
```

We avoid Jest module hoisting entirely.

---

# How to Add New Tests

### Step 1 — Define behaviors
Before writing code, write down:

- what the function guarantees
- how it behaves on valid/invalid inputs
- what logs it emits
- what error paths exist

Each becomes a test.

---

### Step 2 — Use helpers
If your module interacts with:

| Dependency | Use this helper |
|-----------|-----------------|
| Logger | `loggerSpies()` |
| Mongo | `makeFakeMongo()` |
| DataManager | `makeDmMock()` |
| Time | sinon fake timers |
| Change streams | EventEmitter fake from makeFakeMongo |

---

### Step 3 — Assert behaviors, not implementation
We don’t check:

- property order
- exact object shapes
- stack traces

We *do* check:

- returned values
- thrown errors
- logs emitted
- transformations applied
- cache state modified

---

### Step 4 — Keep tests conversational
Write tests so anyone can read them and instantly understand the entire module.

This reduces onboarding time enormously.

---

# Prompting ChatGPT Using This README

You can paste this README into a new chat and ask:

- “Help me write tests for a new DataManager function using this style.”
- “Convert this test file to sinon + loggerSpies.”
- “Generate tests for my new function using Justin conventions.”
- “Rewrite these tests to be more self-documenting.”

This README defines the vocabulary and assumptions for ChatGPT to follow.

---

# Final Advice

- Tests should be **clear** more than “clever.”
- Tests should **document** the system.
- Helpers are your friend.
- If a behavior matters, **write a test that tells its story**.

Happy testing.  
— José
