/**
 * Tiny polite concurrency pool: at most `concurrency` tasks in flight, and task starts spaced
 * at least `gapMs` apart. Tasks start in the order they were queued.
 */
export function createPool(concurrency: number, gapMs: number, opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let active = 0;
  let nextStart = 0;
  const queue: (() => void)[] = [];
  const pump = () => { while (active < concurrency && queue.length) { active++; queue.shift()!(); } };
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(async () => {
        const start = Math.max(now(), nextStart);
        nextStart = start + gapMs;
        try {
          if (start > now()) await sleep(start - now());
          resolve(await task());
        } catch (e) { reject(e); } finally { active--; pump(); }
      });
      pump();
    });
  };
}
