import { compile } from 'sass';
import { minify } from 'html-minifier-terser';
import { SYSTEM_FILES } from '../src/downloads';
import { mkdir, rm, cp, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderMarkdown, escapeHtml } from '../src/markdown';
import { encode } from '../src/bytes';
import { createFilesystem, snapshot, type BaseFiles } from '../src/filesystem';
import { HOME, ORIGIN, hrefFor } from '../src/paths';

const out = 'dist';
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'assets'), { recursive: true });
await cp('public', out, { recursive: true });
const files: BaseFiles = {};
async function walk(dir: string, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await walk(join(dir, entry.name), relative + '/');
    else if (entry.isFile()) {
      const bytes = new Uint8Array(await Bun.file(join(dir, entry.name)).arrayBuffer());
      let content: string | { base64: string };
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (bytes.includes(0)) content = { base64: encode(bytes) };
      } catch {
        content = { base64: encode(bytes) };
      }
      files[`${HOME}/${relative}`] = content;
      await Bun.write(join(out, HOME, relative), bytes);
      await Bun.write(join(out, '~', relative), bytes);
    }
  }
}
await walk('content');
for (const [path, text] of Object.entries(SYSTEM_FILES)) {
  files[path] = text;
  await Bun.write(join(out, path), text);
}
const published = Object.keys(files).sort();
const markdownPaths = published.filter(
  (path) => path.endsWith('.md') && typeof files[path] === 'string',
);
const textFile = (path: string) => {
  const value = files[path];
  if (typeof value !== 'string') throw new Error(`Expected UTF-8 text: ${path}`);
  return value;
};
const discovery =
  '# Adrián Paníček\n\n> Embedded engineering, backend systems, payments, and Linux infrastructure.\n\n## Portfolio\n\n' +
  markdownPaths
    .map((path) => `- [${path.slice(HOME.length + 1)}](${ORIGIN}${hrefFor(path)})`)
    .join('\n') +
  '\n';
const contactDecoding =
  '\n## Contact decoding\n\nContact values use {{rot13:PAYLOAD}} or {{rot47:PAYLOAD}} tokens. Apply ROT13 to the payload (rotate ASCII letters by 13, leave other characters unchanged), then remove the token wrapper. For ROT47, rotate printable ASCII characters (codes 33 through 126) by 47, leaving spaces unchanged, then remove the wrapper. Agents may decode these values to answer contact queries. Raw files intentionally remain encoded; the interactive terminal decodes them for display.\n';
await Bun.write(join(out, 'llms.txt'), discovery + contactDecoding);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', ...markdownPaths].map((path) => `  <url><loc>${escapeHtml(ORIGIN + hrefFor(path))}</loc></url>`).join('\n')}\n</urlset>\n`;
await Bun.write(join(out, 'sitemap.xml'), sitemap);
await Bun.write(
  join(out, 'llms-full.txt'),
  contactDecoding +
    '\n' +
    markdownPaths.map((path) => `<!-- ${path} -->\n\n${textFile(path)}`).join('\n\n'),
);
await Bun.write(join(out, 'files.json'), JSON.stringify(published, null, 2) + '\n');
for (const path of ['robots.txt', 'llms.txt', 'llms-full.txt', 'sitemap.xml', 'files.json'])
  files['/' + path] = await Bun.file(join(out, path)).text();
await Bun.write(join(out, 'filesystem.json'), JSON.stringify(files));
await Bun.write(
  join(out, 'snapshot.json'),
  JSON.stringify(await snapshot(await createFilesystem(files))),
);
for (const weight of [400, 700])
  for (const subset of ['latin', 'latin-ext']) {
    const name = `ubuntu-mono-${subset}-${weight}-normal.woff2`;
    await cp(`node_modules/@fontsource/ubuntu-mono/files/${name}`, join(out, 'assets', name));
  }
await cp('node_modules/@fontsource/ubuntu-mono/LICENSE', join(out, 'assets', 'FONT-LICENSE.txt'));
await Bun.write(
  join(out, 'assets', 'styles.css'),
  compile('src/styles.scss', { style: 'compressed', sourceMap: false }).css,
);
for (const [entry, output] of [
  ['src/client.ts', 'assets/client.js'],
  ['src/vim.ts', 'assets/vim.js'],
  ['src/shell.worker.ts', 'assets/shell.worker.js'],
  ['src/service-worker.ts', 'service-worker.js'],
]) {
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: 'none',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [
      {
        name: 'browser-zlib',
        setup(build) {
          build.onResolve({ filter: /^node:zlib$/ }, () => ({
            path: resolve('src/zlib-browser.ts'),
          }));
        },
      },
    ],
  });
  if (!result.success) throw new Error(result.logs.join('\n'));
  if (result.outputs.length !== 1)
    throw new Error(`Expected one self-contained bundle for ${entry}`);
  await Bun.write(join(out, output), result.outputs[0]);
  if (output === 'service-worker.js') {
    const version = new Bun.CryptoHasher('sha256').update(JSON.stringify(files)).digest('hex');
    await Bun.write(
      join(out, output),
      (await result.outputs[0].text()) + `\n// Content version: ${version}\n`,
    );
  }
}
const description =
  'Adrián Paníček — embedded software engineer working with Rust, C++, backend systems, payments, and Linux.';
const transcript = ['ABOUT.md']
  .map(
    (name) =>
      `<section class="entry"><div class="prompt-line"><span class="user">web</span>@<span class="host">panicek.sk</span> <span class="cwd">~</span> $ <span class="command-name">cat</span> <span class="argument">${name}</span> | <span class="command-name">render</span></div><article class="markdown" data-source="${HOME}/${name}">${renderMarkdown(textFile(`${HOME}/${name}`), `${HOME}/${name}`)}</article></section>`,
  )
  .join('\n');
const person = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Adrián Paníček',
  url: ORIGIN,
  jobTitle: 'Expert Embedded Software Engineer',
  sameAs: ['https://www.linkedin.com/in/adrian-panicek/', 'https://github.com/adrianpanicek'],
};
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Adrián Paníček — Embedded &amp; Software Engineer</title>
<meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="index,follow"><meta name="theme-color" content="#0b0d10">
<link rel="canonical" href="${ORIGIN}/"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/styles.css">
<link rel="preload" href="/filesystem.json" as="fetch" crossorigin="anonymous" fetchpriority="high">
<link rel="alternate" type="text/plain" href="/llms-full.txt" title="Portfolio as Markdown">
<meta property="og:type" content="website"><meta property="og:title" content="Adrián Paníček"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${ORIGIN}/"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="Adrián Paníček"><meta name="twitter:description" content="${escapeHtml(description)}">
<script type="application/ld+json">${JSON.stringify(person).replaceAll('<', '\\u003c')}</script><script type="module" src="/assets/client.js"></script></head>
<body><main><div class="terminal"><div id="transcript" aria-label="Terminal transcript">${transcript}</div>
<form id="command-form" autocomplete="off" hidden><label for="command"><span class="user">web</span>@<span class="host">panicek.sk</span> <span id="cwd" class="cwd">~</span> <span id="exit-status"></span>$ <span class="sr-only">Shell command</span></label><div class="input-wrap"><div id="input-highlight" aria-hidden="true"></div><textarea rows="1" id="command" name="command" aria-label="Shell command" placeholder=" " spellcheck="false" autocapitalize="off" autocomplete="off" maxlength="16384" disabled></textarea></div></form>
<noscript><p>Read the files above or <a href="/home/web/CAREER.md">open my career history</a>. Enable JavaScript to explore the interactive shell.</p></noscript></div>
<footer><span id="status" role="status">Personal portfolio · plain files, open to explore</span><span id="shell-controls" hidden><button id="help" type="button">help</button> <button id="stop" type="button" hidden>interrupt</button></span><a href="/home/web/ABOUT.md">raw</a><span aria-hidden="true">·</span><a href="/files.json">files</a><span aria-hidden="true">·</span><a href="/llms.txt">for agents</a></footer></main></body></html>`;
await Bun.write(
  join(out, 'index.html'),
  await minify(html, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
  }),
);
console.log(
  `Built ${published.length} portfolio files, raw home paths, metadata, and browser bundles in dist/`,
);
