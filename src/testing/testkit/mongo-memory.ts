import { MongoClient } from 'mongodb';

/**
 * TEST-ONLY helper.
 *
 * MongoMemoryReplSet can report "ready" before the replica set
 * has fully elected a primary, especially in CI.
 *
 * This helper waits until a connection can be established and
 * a ping succeeds, preventing flaky integration/system tests.
 *
 */
export async function waitForMongoReady(
  uri: string,
  options?: {
    attempts?: number;
    delayMs?: number;
    clientOptions?: ConstructorParameters<typeof MongoClient>[1];
  },
): Promise<void> {
  const attempts = options?.attempts ?? 20;
  const delayMs = options?.delayMs ?? 150;

  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      const client = new MongoClient(uri, options?.clientOptions);
      await client.connect();
      await client.db('admin').command({ ping: 1 });
      await client.close();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastErr ?? new Error('Mongo did not become ready in time');
}
