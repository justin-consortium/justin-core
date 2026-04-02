# Testing Practices for @just-in/core

This document extends the **Justin Testing Philosophy** with package-specific
guidance for `@just-in/core`. It is written to serve both human developers
and as authoritative context for an AI agent writing or reviewing tests.

---

## Package Architecture

```
UserManager              ← public API (e2e layer)
  ├─ users/crud.ts       ┐
  ├─ users/cache.ts      ├─ internal components (integration + unit layer)
  ├─ users/listeners.ts  ┘
  ├─ pa/crud.ts          ┐
  ├─ pa/cache.ts         ├─ internal components (integration + unit layer)
  ├─ pa/listeners.ts     ┘
DataManager              ← infrastructure adapter (integration + unit layer)
ChangeListenerManager    ← change stream wiring (integration + unit layer)
lifecycle/               ← shutdown/registration (integration + unit layer)
```

---

## Layer Map — What Goes Where

### Unit layer

| File                         | Test file                      | What to test                                  |
| ---------------------------- | ------------------------------ | --------------------------------------------- |
| `users/cache.ts`             | `user.cache.unit.test.ts`      | cache reads/writes, index lookups             |
| `users/crud.ts`              | `user.crud.unit.test.ts`       | validation, DM call args, result shaping      |
| `users/listeners.ts`         | `user.listeners.unit.test.ts`  | callback wiring, cache mutations on event     |
| `pa/cache.ts`                | `pa.cache.unit.test.ts`        | same as users/cache                           |
| `pa/crud.ts`                 | `pa.crud.unit.test.ts`         | same as users/crud                            |
| `pa/listeners.ts`            | `pa.listeners.unit.test.ts`    | same as users/listeners                       |
| `user-manager.ts`            | `user-manager.unit.test.ts`    | uid resolution, delegation, error propagation |
| `data-manager.ts`            | `data-manager.unit.test.ts`    | adapter delegation, CoreResult shaping        |
| `change-listener.manager.ts` | `change-listener.unit.test.ts` | stream lifecycle, deduplication               |
| `lifecycle/index.ts`         | `lifecycle.unit.test.ts`       | registration, shutdown ordering               |

### Integration layer

| Test file                          | What it covers                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `user-manager.integration.test.ts` | cache refresh from DB, PA crud DB+cache agreement, change stream pipeline, shutdownCore wiring |
| `data-manager.integration.test.ts` | full DataManager adapter surface against real Mongo                                            |

### E2E layer

| Test file                  | What it covers                                          |
| -------------------------- | ------------------------------------------------------- |
| `user-manager.e2e.test.ts` | full `UserManager` public API as a third-party consumer |

---

## What Is and Is Not Allowed at Each Layer

### Unit tests — ALLOWED imports

```ts
// The module under test
import { createUserRecord } from '../crud';

// Testing infrastructure
import { makeCoreManagersSandbox } from '../../testing';
import type { CoreManagersSandbox } from '../../testing';
import { loggerSpies, resetGlobalLoggerState } from '../../testing';
import type { LoggerSpies } from '../../testing';
import { makeTestJUser, makeTestNewUserRecord } from '../../testing';

// Types and error codes
import { JustinErrorCode } from '../../errors';
import type { JUser } from '../types';

// Cache helpers (for seeding state before a test)
import { clearUsersCache, upsertUserInCache } from '../cache';
```

### Unit tests — NEVER

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server'; // ← no real DB
import { DataManager } from '../../data-manager'; // ← use sandbox
import { UserManager } from '../user-manager'; // ← use the module directly
// Any real network, real timer, real file system
```

---

### Integration tests — ALLOWED imports

```ts
// Infrastructure setup
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import sinon from 'sinon';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import { configureDB, shutdownCore, clearManagerRegistry } from '../../lifecycle';
import {
  DataManager,
  DBType,
  ChangeListenerManager,
  CollectionChangeTypeEnum,
} from '../../data-manager';

// Testing helpers
import { waitForMongoReady, silenceLogger, expectOk, waitForCondition } from '../../testing';

// Internal modules under test — import directly
import { refreshUsersCache, clearUsersCache, getAllUsersFromCache } from '../users/cache';
import { setProtectedAttributes, deleteAllProtectedAttributes } from '../pa/crud';
import { setupUserChangeListeners, removeUserChangeListeners } from '../users/listeners';

// Error codes and types
import { JustinErrorCode } from '../../errors';
import type { JUser } from '../types';
```

### Integration tests — NEVER

```ts
import { UserManager } from '../user-manager'; // ← use internal functions directly
// (Exception: shutdownCore tests may import UserManager.init() to exercise
// the registration + shutdown lifecycle end-to-end)
```

---

### E2E tests — ALLOWED imports

```ts
// Infrastructure setup
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import sinon from 'sinon';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import { configureDB } from '../../lifecycle';
import { DBType } from '../../data-manager';

// The public API — the ONLY entry point
import { UserManager, TestingUserManager } from '../user-manager';

// Testing helpers
import {
  waitForMongoReady,
  silenceLogger,
  expectOk,
  expectFailed,
  expectFailedWithCode,
} from '../../testing';

// Types the consumer would use
import type { JUser } from '../types';
import { JustinErrorCode } from '../../errors';
```

### E2E tests — NEVER

```ts
// Any of these is a violation — move the test to integration instead:
import { DataManager } from '../../data-manager'; // ← internal
import { ChangeListenerManager } from '../../data-manager'; // ← internal
import { shutdownCore } from '../../lifecycle'; // ← internal
import { refreshUsersCache } from '../users/cache'; // ← internal
import { setProtectedAttributes } from '../pa/crud'; // ← internal
import { USERS, PROTECTED_ATTRIBUTES } from '../constants'; // ← internal

// Direct DB access
await dm.getAllInCollection(USERS); // ← internal
await dm.clearCollection(PROTECTED_ATTRIBUTES); // ← use UserManager.deleteAllUsers()

// Direct cache access for assertions (seeding in beforeEach is acceptable)
getAllUsersFromCache(); // ← use UserManager.getAllUsers() instead
```

---

## Complete Available Testing API

Everything below is importable from `'../../testing'` (or `'@just-in/core/testing'`).

### Assertion helpers — `testing/helpers/assertions.ts`

```ts
// Assert CoreResult succeeded; returns successes[0]
expectOk<T>(result: CoreResult<T>): T

// Assert CoreResult failed; returns failures[0]
expectFailed<T>(result: CoreResult<T>): FailureEntry

// Assert CoreResult failed with specific code; returns failures[0]
expectFailedWithCode<T>(result: CoreResult<T>, code: string): FailureEntry

// Assert properties of a captured log entry
expectLog(log: CapturedEmit | undefined, opts: { severity?: string; messageSubstr?: string }): void
```

### Async helpers — `testing/helpers/async.ts`

```ts
// Poll a condition until true — use for change stream assertions in integration tests
waitForCondition(
  check: () => boolean,
  options?: { attempts?: number; delayMs?: number }
): Promise<void>
// Default: 40 attempts × 50ms = 2 seconds total
```

### Clock helpers — `testing/helpers/clock.ts`

```ts
// Run a block with Sinon fake timers; restores automatically
withFakeTimers<T>(fn: (clock: SinonFakeTimers) => T | Promise<T>): Promise<T>

// Advance the fake clock
advance(clock: SinonFakeTimers, ms: number): void

// Flush the microtask queue
flushMicrotasks(): Promise<void>
```

### Stream helpers — `testing/helpers/streams.ts`

```ts
// Create a readable object-mode stream (for change listener unit tests)
makeStream(): Readable

// Emit a data event on the stream
push<T>(stream: Readable, value: T): void

// End the stream
end(stream: Readable): void
```

### Factory helpers — `testing/helpers/factories.ts`

```ts
// Create a test JUser with optional overrides (defaults: id='u1', uniqueIdentifier='u1')
makeTestJUser(overrides?: Partial<JUser>): JUser

// Create a test NewUserRecord with optional overrides
makeTestNewUserRecord(overrides?: Partial<NewUserRecord>): NewUserRecord
```

### Singleton reset — `testing/helpers/reset-singleton.ts`

```ts
// Call killInstance() on a singleton if it exists (no-op if not)
resetSingleton(constructor: any): void
```

### Unit test sandbox — `testing/testkit/core-managers.sandbox.ts`

```ts
// Create a Sinon sandbox with DataManager and ChangeListenerManager stubbed
makeCoreManagersSandbox(): CoreManagersSandbox

// Type for the sandbox
type CoreManagersSandbox = {
  sb: SinonSandbox;
  dm: DataManager;       // real instance, methods stubbed
  clm: ChangeListenerManager; // real instance, methods stubbed
  handleErrorStub: SinonStub;
  restore(): void;
}

// Cast dm/clm to any when accessing stubs:
(t.dm as any).findItemsInCollection.resolves([...]);
(t.clm as any).addChangeListener.callsFake(...);
```

### Logger testkit — `testing/testkit/logger.spies.ts` and `logger.silence.ts`

```ts
// Capture log output through the real logger pipeline
loggerSpies(options?: LoggerSandboxOptions): LoggerSpies
// LoggerSpies has: captured, emitSpy, restore(), last(), findByMessage(substr)

// Silence all logs (no capture) — use in integration and e2e tests
silenceLogger(sb?: SinonSandbox): { restore: () => void }
```

### Mongo memory — `testing/testkit/mongo-memory.ts`

```ts
// Wait for MongoMemoryReplSet to elect a primary before running tests
waitForMongoReady(uri: string, options?: { attempts?: number; delayMs?: number }): Promise<void>
```

---

## Standard Test File Templates

### Unit test template

```ts
import { makeCoreManagersSandbox, loggerSpies, resetGlobalLoggerState } from '../../testing';
import type { CoreManagersSandbox, LoggerSpies } from '../../testing';
import { expectOk, expectFailed, expectFailedWithCode } from '../../testing';
import { JustinErrorCode } from '../../errors';
// Import the module under test directly
import { myFunction } from '../my-module';
// Import cache helpers only for seeding state
import { clearUsersCache, upsertUserInCache } from '../users/cache';

describe('my-module unit tests', () => {
  let t: CoreManagersSandbox;
  let lg: LoggerSpies;

  beforeEach(() => {
    t?.restore();
    lg?.restore();
    t = makeCoreManagersSandbox();
    lg = loggerSpies();
    clearUsersCache();
  });

  afterEach(() => {
    t?.restore();
    lg?.restore();
    resetGlobalLoggerState();
    clearUsersCache();
  });

  describe('myFunction', () => {
    it('returns VALIDATION_ERROR for empty input', async () => {
      const result = await myFunction('');
      expectFailedWithCode(result, JustinErrorCode.VALIDATION_ERROR);
    });

    it('calls dm.findItemsInCollection with correct args', async () => {
      (t.dm as any).findItemsInCollection.resolves([]);
      await myFunction('alice');
      expect((t.dm as any).findItemsInCollection.calledWith('users')).toBe(true);
    });
  });
});
```

---

### Integration test template

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import sinon from 'sinon';
import { configureDB } from '../../lifecycle';
import { DataManager, DBType } from '../../data-manager';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import { waitForMongoReady, silenceLogger, expectOk, waitForCondition } from '../../testing';
import { USERS, PROTECTED_ATTRIBUTES } from '../constants';
// Import internal modules directly
import { refreshUsersCache, clearUsersCache, getAllUsersFromCache } from '../users/cache';
import { setProtectedAttributes } from '../pa/crud';

jest.setTimeout(120_000);

describe('<component> integration tests', () => {
  let repl: MongoMemoryReplSet;
  let dm: DataManager;
  let sb: sinon.SinonSandbox;
  let silenceLogs: { restore: () => void };

  beforeAll(async () => {
    silenceLogs = silenceLogger();
    sb = sinon.createSandbox();

    repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = repl.getUri();
    await waitForMongoReady(uri);

    const realInit = MongoDBManager.init.bind(MongoDBManager);
    sb.stub(MongoDBManager, 'init').callsFake(() => realInit(uri, 'my-test-db'));

    configureDB({ dbType: DBType.MONGO, uri });
    dm = DataManager.getInstance();
    await dm.init();

    await dm.ensureStore(USERS);
    await dm.ensureStore(PROTECTED_ATTRIBUTES);
  });

  afterAll(async () => {
    try {
      await dm.close();
    } catch {}
    try {
      await repl.stop();
    } catch {}
    try {
      sb.restore();
    } catch {}
    silenceLogs.restore();
  });

  beforeEach(async () => {
    clearUsersCache();
    await dm.clearCollection(USERS);
    await dm.clearCollection(PROTECTED_ATTRIBUTES);
  });

  describe('refreshUsersCache', () => {
    it('loads users from DB into cache', async () => {
      await dm.addItemToCollection(USERS, { uniqueIdentifier: 'alice' });

      await refreshUsersCache();

      expect(getAllUsersFromCache()).toHaveLength(1);
    });
  });
});
```

---

### E2E test template

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import sinon from 'sinon';
import { configureDB } from '../../lifecycle';
import { DBType } from '../../data-manager';
import { MongoDBManager } from '../../data-manager/mongo/mongo-data-manager';
import { UserManager, TestingUserManager } from '../user-manager';
import {
  waitForMongoReady,
  silenceLogger,
  expectOk,
  expectFailed,
  expectFailedWithCode,
} from '../../testing';
import type { JUser } from '../types';
import { JustinErrorCode } from '../../errors';

jest.setTimeout(120_000);

describe('UserManager public API — e2e', () => {
  let repl: MongoMemoryReplSet;
  let sb: sinon.SinonSandbox;
  let silenceLogs: { restore: () => void };

  beforeAll(async () => {
    silenceLogs = silenceLogger();
    sb = sinon.createSandbox();

    repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = repl.getUri();
    await waitForMongoReady(uri);

    const realInit = MongoDBManager.init.bind(MongoDBManager);
    sb.stub(MongoDBManager, 'init').callsFake(() => realInit(uri, 'e2e-test-db'));

    configureDB({ dbType: DBType.MONGO, uri });
    await UserManager.init();
  });

  afterAll(async () => {
    try {
      await UserManager.shutdown();
    } catch {}
    try {
      await repl.stop();
    } catch {}
    try {
      sb.restore();
    } catch {}
    silenceLogs.restore();
  });

  beforeEach(async () => {
    await UserManager.deleteAllUsers();
    await TestingUserManager.refreshUsersCache();
    await TestingUserManager.refreshProtectedAttributesCache();
  });

  // Helper: create a user through the public API
  async function createUser(uid: string, attrs: Record<string, any> = {}): Promise<JUser> {
    return expectOk(await UserManager.createUser({ uniqueIdentifier: uid, attributes: attrs }));
  }

  describe('createUser', () => {
    it('returns ok:true with the created user', async () => {
      const result = await UserManager.createUser({
        uniqueIdentifier: 'u1',
        attributes: { name: 'Alice' },
      });

      expect(result.ok).toBe(true);
      const user = expectOk(result);
      expect(user.uniqueIdentifier).toBe('u1');
      expect(user.name).toBe('Alice');
    });

    it('returns VALIDATION_ERROR for duplicate uniqueIdentifier', async () => {
      await createUser('u1');
      expectFailedWithCode(
        await UserManager.createUser({ uniqueIdentifier: 'u1', attributes: {} }),
        JustinErrorCode.VALIDATION_ERROR,
      );
    });
  });
});
```

---

## Mongo Infrastructure Notes

Both integration and e2e tests use `MongoMemoryReplSet` (not `MongoMemoryServer`).
A **replica set** is required because MongoDB change streams only work on replica
sets or sharded clusters.

`waitForMongoReady` must be called after `repl.getUri()` — the replica set can
report "ready" before a primary has been elected, causing flaky failures in CI.

The `MongoDBManager.init` stub redirects the real initializer to the in-memory
instance so no config changes are needed in production code:

```ts
const realInit = MongoDBManager.init.bind(MongoDBManager);
sb.stub(MongoDBManager, 'init').callsFake(() => realInit(uri, 'my-test-db'));
```

---

## Change Stream Tests

Change stream callbacks fire asynchronously. Use `waitForCondition` — never
use a fixed `setTimeout` delay.

```ts
import { waitForCondition } from '../../testing';

// After writing to DB, wait for the change stream to update the cache
await waitForCondition(() => getUserByIdFromCache(userId) !== null);

// With custom timeout
await waitForCondition(
  () => getAllUsersFromCache().length === 3,
  { attempts: 60, delayMs: 100 }, // 6 second timeout
);
```

Always tear down listeners in `afterEach`:

```ts
afterEach(async () => {
  await removeUserChangeListeners();
  await removeProtectedAttributesChangeListeners();
});
```

---

## Resetting State Between Tests

### Unit tests

```ts
beforeEach(() => {
  t?.restore();
  lg?.restore();
  t = makeCoreManagersSandbox();
  lg = loggerSpies();
  clearUsersCache();
  clearProtectedAttributesCache();
});

afterEach(() => {
  t?.restore();
  lg?.restore();
  resetGlobalLoggerState();
  clearUsersCache();
  clearProtectedAttributesCache();
});
```

### Integration tests

```ts
beforeEach(async () => {
  clearUsersCache();
  clearProtectedAttributesCache();
  await dm.clearCollection(USERS);
  await dm.clearCollection(PROTECTED_ATTRIBUTES);
});
```

### E2E tests

```ts
beforeEach(async () => {
  await UserManager.deleteAllUsers(); // clears both users and PA collections
  await TestingUserManager.refreshUsersCache();
  await TestingUserManager.refreshProtectedAttributesCache();
});
```

---

## Handling `handleError` in Unit Tests

Import `handleError` from its source file directly — not from the barrel
re-export. Barrel re-exports create readonly bindings that Sinon cannot wrap:

```ts
// Correct
import * as Helpers from '../../utils/error.helpers';
const spy = sinon.spy(Helpers, 'handleError');

// Wrong — creates a readonly binding
import * as Helpers from '../../utils';
```

---

## Generating Valid-But-Nonexistent MongoDB IDs

Integration tests that assert `NOT_FOUND` on update/remove operations need a
valid ObjectId format. A plain string like `'nonexistent-id'` will cause a
cast error before the lookup, returning `VALIDATION_ERROR` instead:

```ts
import { ObjectId } from 'mongodb';

// Each call returns a unique valid ObjectId string that does not exist in DB
const nonExistentId = () => new ObjectId().toHexString();

it('returns NOT_FOUND for unknown id', async () => {
  expectFailedWithCode(
    await dm.updateItemByIdInCollection('items', nonExistentId(), { x: 1 }),
    JustinErrorCode.NOT_FOUND,
  );
});
```

Note: `DataManager` bulk operations (`updateItemsByIdInCollection`,
`removeItemsFromCollection`) use `bulkWrite` which does **not** surface
unmatched documents as errors — only real write errors appear. These
operations return `ok: true` even when no documents matched.

---

## Final Core Rule

Every test should answer:

> "If this breaks in production, would this test have caught it?"

If the answer is no, strengthen the test.
