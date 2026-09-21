import { watch } from 'node:fs';
let running = false;
let pending = false;
async function build() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const result = Bun.spawn([process.execPath, 'scripts/build.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exit = await result.exited;
  if (exit !== 0) console.error('Build failed; fix the error and save again.');
  running = false;
  if (pending) {
    pending = false;
    await build();
  }
}
await build();
await import('./serve');
let timer: ReturnType<typeof setTimeout>;
for (const path of ['content', 'public', 'src', 'scripts'])
  watch(path, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => void build(), 120);
  });
console.log('Watching source and content. Refresh your browser after changes.');
