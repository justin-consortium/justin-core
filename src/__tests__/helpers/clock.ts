export function withFakeTimers<T>(fn: () => T | Promise<T>) {
  return async () => {
    jest.useFakeTimers({ legacyFakeTimers: false });
    try {
      await Promise.resolve(fn());
    } finally {
      jest.useRealTimers();
    }
  };
}

export function advance(ms: number): void {
  jest.advanceTimersByTime(ms);
}

export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}
