/** Returns false when cancelled; cancellation never runs the command. */
export async function typeText(
  text: string,
  update: (value: string) => void,
  options: { delay?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  const { signal, delay = 35 } = options;
  let value = '';
  for (const character of text) {
    if (signal?.aborted) return false;
    value += character;
    update(value);
    if (delay > 0)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, delay);
        signal?.addEventListener('abort', done, { once: true });
      });
  }
  return !signal?.aborted;
}
