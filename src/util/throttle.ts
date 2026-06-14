/**
 * Leading + trailing throttle. The returned function invokes `fn` immediately
 * on the first call of a burst, then at most once per `delayMs` while calls keep
 * coming, and always once more with the final arguments after the burst ends.
 */
export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Args | null = null;
  const flush = () => {
    timer = null;
    if (pending === null) return;
    const args = pending;
    pending = null;
    lastRun = Date.now();
    fn(...args);
  };
  return (...args: Args) => {
    pending = args;
    const wait = delayMs - (Date.now() - lastRun);
    if (wait <= 0) {
      flush();
    } else if (timer === null) {
      timer = setTimeout(flush, wait);
    }
  };
}
