export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  iterator: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error(`Invalid concurrency value: ${concurrency}`);
  }

  if (items.length === 0) {
    return [];
  }

  const cappedConcurrency = Math.min(Math.floor(concurrency), items.length);
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= items.length) {
        break;
      }
      nextIndex += 1;

      const value = await iterator(items[currentIndex] as T, currentIndex);
      results[currentIndex] = value;
    }
  }

  const workers = Array.from({ length: cappedConcurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function forEachWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  iterator: (item: T, index: number) => Promise<void>,
): Promise<void> {
  await mapWithConcurrency(items, concurrency, iterator);
}
