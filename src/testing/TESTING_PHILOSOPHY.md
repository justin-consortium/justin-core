# Justin Testing Philosophy (All Packages)

This document defines **shared testing philosophy, patterns, and expectations**
across the Justin ecosystem.

Each package may add **package‑specific guidance**, but this file establishes the
common baseline so tests feel familiar no matter which Justin package you are in.

---

## Why We Test

Justin tests serve **three purposes**:

1. **Correctness** – the code does what it claims
2. **Design documentation** – tests explain intent and contracts
3. **Refactoring safety** – behavior can evolve without fear

A good Justin test teaches a future contributor _how the system works_.

---

## Core Principles

### 1) Tests Explain Intent

Test names should read like sentences:

> “Given this scenario, what should happen?”

**Good**

- `returns null when identifier is invalid`
- `logs and rethrows the same Error instance`
- `emits userUpdated after successful update`

**Bad**

- `test update`
- `misc edge case`
- `works fine`

If a test name doesn’t explain behavior, rewrite it.

---

### 2) Behavior Over Implementation

Tests should assert **observable behavior**, not internal structure.

Avoid brittle assertions like:

```ts
expect(ctx.error.stack).toBeDefined();
```

Prefer contract‑level assertions:

```ts
expect(ctx.error).toMatchObject({ message: 'boom' });
```

Internals may change — behavior should not.

---

### 3) Prefer Shared Helpers Over Ad‑Hoc Mocking

If you copy/paste test setup more than once, stop and ask:

> “Should this be a helper?”

Helpers improve:

- readability
- consistency
- long‑term maintainability
- reduces duplicate code

---

### 4) Unit Tests First, Integration Tests Intentionally

**Unit tests**

- Define intent
- Mock dependencies
- Fast, deterministic

**Integration / system tests**

- Validate assumptions
- Use real infrastructure _only when needed_
- Fewer in number, higher signal

---

### 5) Structure Tells the Story

Use a predictable structure:

1. **Top‑level `describe`** → module / class
2. **Nested `describe`s** → grouped behaviors
3. **Arrange → Act → Assert**

Example:

```ts
describe('findById', () => {
  it('returns null when the id is invalid', async () => {
    // arrange
    // act
    // assert
  });
});
```

---

## Tooling Standards (All Packages)

### Sinon for Mocks / Spies / Stubs

Justin standardizes on **Sinon**.

Avoid:

- `jest.fn()`
- `jest.spyOn()`
- `jest.useFakeTimers()`

Jest remains the **test runner and assertion library**.

---

## Helpers vs Testkits

Across Justin packages:

- **helpers/**
  - small utilities
  - assertion helpers
  - no global side effects

- **testkit/**
  - sandboxes
  - mock factories
  - coordinated stubbing of subsystems

Rule of thumb:

- _Utility → helper_
- _Environment / sandbox → testkit_

---

## When to Add a Helper

#### Add a helper when:

- setup repeats across multiple tests
- intent becomes clearer, not hidden

#### When Not to Add a Helper

- Do not add helpers that bundle assertions or define success.
- Helpers should prepare inputs or infrastructure — not decide what “passed” means.
- A helper that performs assertions: hides which behaviors matter in a given test
  forces all callers to agree on a single definition of success
  makes failures harder to interpret turns tests into opaque one-liners

This pattern is discouraged:

```ts
export async function runDecisionRuleAndExpectSuccess(rule: DecisionRule) {
  const result = await executeDecisionRule(rule);

  expect(result.shouldActivate).toBe(true);
  expect(result.selectedAction).toBeDefined();
  expectLastLog('decision rule executed', 'INFO');

  return result;
}
```

While convenient, this helper bundles execution, assertions, and logging expectations into a single abstraction.

As a result, tests that use it often look like this:

```ts
it('activates when step count exceeds threshold', async () => {
  await runDecisionRuleAndExpectSuccess(stepRule);
});
```

This test no longer communicates:

- which outcomes matter for this scenario

- why those outcomes are important

- what would be acceptable to change during refactoring

The reader must now inspect the helper to understand the test.
Prefer helpers that execute or construct, and let each test explicitly assert the behaviors it cares about.
Tests should own their assertions — helpers should not.

---

## Final Rule

If a test fails and the failure message does not immediately explain _what broke_,
the test is not done yet.
