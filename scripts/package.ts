import { zipSync } from 'fflate';
import { mkdir } from 'node:fs/promises';

const files: Record<string, Uint8Array> = {};
for (const path of new Bun.Glob('**/*').scanSync({
  cwd: 'dist',
  onlyFiles: true,
  followSymlinks: true,
})) {
  files[path] = new Uint8Array(await Bun.file(`dist/${path}`).arrayBuffer());
}
await mkdir('.artifacts', { recursive: true });
await Bun.write('.artifacts/portfolio.zip', zipSync(files, { level: 9 }));
