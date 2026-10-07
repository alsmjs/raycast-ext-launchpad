/**
 * Run `fn` over `items` with at most `limit` in flight, preserving result order.
 *
 * Exists because each icon extraction is a `plutil` + `sips` pair: a hundred of
 * them unbounded is two hundred concurrent subprocesses on a cold cache. Eight
 * at a time extracts ~65 app icons in under half a second on the dev machine.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return results;
}
