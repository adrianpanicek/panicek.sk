// Extract the six vector drawings from the supplied PDF without redrawing them.
// Requires Poppler (pdftocairo) and ImageMagick (magick).
// Usage: bun scripts/generate-egg-cups.ts /path/to/Article.pdf
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const pdf = process.argv[2];
if (!pdf) {
  throw new Error('Pass the source PDF path');
}
const temporary = await mkdtemp(join(tmpdir(), 'egg-cups-'));
const destination = 'content/blog/computers-are-just-egg-cups';
async function run(command: string[]) {
  const process = Bun.spawn(command, {stdout: 'inherit', stderr: 'inherit'});
  if ((await process.exited) !== 0) {
    throw new Error(`Failed: ${command[0]}`);
  }
}
try {
  const source = join(temporary, 'source.svg');
  await run(['pdftocairo', '-svg', pdf, source]);
  const paths = [
    ...(await Bun.file(source).text()).matchAll(
      /<path\b[^>]*\bd="([^"]+)"[^>]*\/?\s*>/g,
    ),
  ]
    .map(match => {
      const coordinates = match[1].match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      const xs = coordinates.filter((_, i) => i % 2 === 0);
      const ys = coordinates.filter((_, i) => i % 2 === 1);
      return {
        d: match[1],
        left: Math.min(...xs),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      };
    })
    .filter(path => path.right - path.left > 20);
  if (paths.length !== 6) {
    throw new Error('Expected six cup drawings');
  }
  for (const [state, full] of [
    ['empty', false],
    ['full', true],
  ] as const) {
    const frames = paths
      .filter(path => path.left > 250 === full)
      .sort((a, b) => a.bottom - b.bottom);
    if (frames.length !== 3) {
      throw new Error(`Expected three ${state} cups`);
    }
    const pngs: string[] = [];
    for (const [i, path] of frames.entries()) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="192" viewBox="0 0 40 64"><path fill="white" fill-rule="evenodd" transform="translate(${20 - (path.left + path.right) / 2} ${60 - path.bottom})" d="${path.d}"/></svg>\n`;
      const frame = join(temporary, `${state}-${i}.svg`);
      await Bun.write(frame, svg);
      if (i === 0) {
        await Bun.write(`${destination}/egg-cup-${state}.svg`, svg);
      }
      const png = join(temporary, `${state}-${i}.png`);
      await run([
        'magick',
        '-background',
        'none',
        frame,
        '-channel',
        'A',
        '-threshold',
        '50%',
        '+channel',
        png,
      ]);
      pngs.push(png);
    }
    await run([
      'magick',
      '-delay',
      '24',
      '-dispose',
      'Background',
      ...pngs,
      '-loop',
      '0',
      `${destination}/egg-cup-${state}.gif`,
    ]);
  }
} finally {
  await rm(temporary, {recursive: true, force: true});
}
