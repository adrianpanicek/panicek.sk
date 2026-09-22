import { compile } from 'sass';
import { imageSize } from 'image-size';
import { brotliCompressSync, constants } from 'node:zlib';
import { minify } from 'html-minifier-terser';
import { SYSTEM_FILES } from '../src/downloads';
import { mkdir, rm, cp, readdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderMarkdown, escapeHtml } from '../src/markdown';
import { encode } from '../src/bytes';
import { createFilesystem, snapshot, type BaseFiles } from '../src/filesystem';
import { validRemoteName } from '../src/remote-filesystem';
import { HOME, ORIGIN as DEFAULT_ORIGIN, hrefFor } from '../src/paths';

const site = new URL(process.env.SITE_ORIGIN || DEFAULT_ORIGIN);
if (
  site.protocol !== 'https:' ||
  site.username ||
  site.password ||
  site.pathname !== '/' ||
  site.search ||
  site.hash
)
  throw new Error(
    'SITE_ORIGIN must be an HTTPS origin without credentials, path, query, or fragment',
  );
const ORIGIN = site.origin;

const out = 'dist';
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'assets'), { recursive: true });
await cp('public', out, { recursive: true });
await Bun.write(
  join(out, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
);
const files: BaseFiles = {};
const directories: string[] = [];
const aliases: Record<string, { target: string }> = { '/~': { target: HOME } };
const imageDimensions: Record<string, { width: number; height: number }> = {};
async function walk(dir: string, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!validRemoteName(entry.name) || entry.name.startsWith('.'))
      throw new Error(`Unsafe content name: ${entry.name}`);
    if (entry.isSymbolicLink())
      throw new Error(`Content symlinks are not allowed: ${dir}/${entry.name}`);
    const relative = prefix + entry.name;
    if (entry.isDirectory()) {
      directories.push(`${HOME}/${relative}`);
      await mkdir(join(out, '_files', HOME, relative), { recursive: true });
      if (!prefix) {
        if (
          [
            'assets',
            'api',
            'home',
            'usr',
            'bin',
            'etc',
            'dev',
            'proc',
            'sys',
            'tmp',
            'temp',
            'mqtt',
            '_files',
            '~',
            '.well-known',
          ].includes(entry.name)
        )
          throw new Error(`Reserved shortcut: ${entry.name}`);
        aliases['/' + entry.name] = { target: HOME + '/' + entry.name };
      }
      await walk(join(dir, entry.name), relative + '/');
    } else if (entry.isFile()) {
      const bytes = new Uint8Array(await Bun.file(join(dir, entry.name)).arrayBuffer());
      if (/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(entry.name)) {
        const { width, height } = imageSize(bytes);
        imageDimensions[`${HOME}/${relative}`] = { width, height };
      }
      let content: string | { base64: string };
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (bytes.includes(0)) content = { base64: encode(bytes) };
      } catch {
        content = { base64: encode(bytes) };
      }
      files[`${HOME}/${relative}`] = content;
      await Bun.write(join(out, '_files', HOME, relative), bytes);
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
    discovery +
    '\n' +
    markdownPaths
      .filter((path) => !path.startsWith(HOME + '/') || !path.slice(HOME.length + 1).includes('/'))
      .map((path) => `<!-- ${path} -->\n\n${textFile(path)}`)
      .join('\n\n'),
);
await Bun.write(join(out, 'files.json'), JSON.stringify(published, null, 2) + '\n');
for (const path of ['robots.txt', 'llms.txt', 'llms-full.txt', 'sitemap.xml', 'files.json'])
  files['/' + path] = await Bun.file(join(out, path)).text();
const startup: BaseFiles = Object.fromEntries(
  Object.entries(files).filter(
    ([path]) => !path.startsWith(HOME + '/') || !path.slice(HOME.length + 1).includes('/'),
  ),
);
for (const path of directories.filter((path) => !path.slice(HOME.length + 1).includes('/')))
  startup[path] = { directory: true };
Object.assign(startup, aliases);
await Bun.write(join(out, 'filesystem.json'), JSON.stringify(startup));
await Bun.write(
  join(out, 'snapshot.json'),
  JSON.stringify(await snapshot(await createFilesystem(startup))),
);
for (const weight of [400, 700])
  for (const subset of ['latin', 'latin-ext']) {
    const name = `ubuntu-mono-${subset}-${weight}-normal.woff2`;
    await cp(`node_modules/@fontsource/ubuntu-mono/files/${name}`, join(out, 'assets', name));
  }
await cp('node_modules/@fontsource/ubuntu-mono/LICENSE', join(out, 'assets', 'FONT-LICENSE.txt'));
await mkdir(join(out, 'assets', 'doom'), { recursive: true });
for (const name of ['doom.wasm', 'LICENSE-GPL-2.0.txt', 'DOOM-SHAREWARE-NOTICE.txt', 'SOURCE.md'])
  await cp(join('vendor', 'doom', name), join(out, 'assets', 'doom', name));
await Bun.write(
  join(out, 'assets', 'styles.css'),
  compile('src/styles.scss', { style: 'compressed', sourceMap: false }).css,
);
for (const [entry, output] of [
  ['src/client.ts', 'assets/client.js'],
  ['src/vim.ts', 'assets/vim.js'],
  ['src/program.ts', 'assets/program.js'],
  ['src/doom/index.ts', 'assets/doom/app.js'],
  ['src/shell.worker.ts', 'assets/shell.worker.js'],
  ['src/service-worker.ts', 'service-worker.js'],
]) {
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: 'none',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      IMAGE_DIMENSIONS: JSON.stringify(imageDimensions),
    },
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
const title = 'Adrián Paníček — Software & Electronics';
const socialImage = `${ORIGIN}/assets/social-card.png`;
const socialImageAlt =
  'Adrián Paníček’s terminal-style portfolio, with his portrait and software and electronics focus.';
const transcript = ['ABOUT.md']
  .map(
    (name) =>
      `<section class="entry"><div class="prompt-line"><span class="user">web</span>@<span class="host">panicek.sk</span> <span class="cwd">~</span> $ <span class="command-name">cat</span> <span class="argument">${name}</span> | <span class="command-name">render</span></div><article class="markdown" data-source="${HOME}/${name}">${renderMarkdown(textFile(`${HOME}/${name}`), `${HOME}/${name}`, ORIGIN, imageDimensions)}</article></section>`,
  )
  .join('\n');
const person = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Adrián Paníček',
  url: ORIGIN,
  image: socialImage,
  description,
  jobTitle: 'Expert Embedded Software Engineer',
  sameAs: ['https://www.linkedin.com/in/adrian-panicek/', 'https://github.com/adrianpanicek'],
};
const crtBoot = await Bun.build({
  entrypoints: ['src/crt-boot.ts'],
  target: 'browser',
  format: 'iife',
  minify: true,
});
if (!crtBoot.success) throw new Error(crtBoot.logs.join('\n'));
const crtScript = (await crtBoot.outputs[0].text()).replaceAll('</script', '<\\/script');
const html = `<!doctype html>
<html lang="en" data-crt="on"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<script>${crtScript}</script>
<title>${escapeHtml(title)}</title>
<meta name="author" content="Adrián Paníček"><meta name="application-name" content="Adrián Paníček — Portfolio">
<meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="index,follow"><meta name="theme-color" content="#0b0d10">
<link rel="canonical" href="${ORIGIN}/"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/styles.css">
<link rel="preload" href="/filesystem.json" as="fetch" crossorigin="anonymous" fetchpriority="high">
<link rel="alternate" type="text/plain" href="/llms-full.txt" title="Portfolio as Markdown">
<meta property="og:type" content="website"><meta property="og:site_name" content="Adrián Paníček — Portfolio"><meta property="og:locale" content="en_GB"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${ORIGIN}/">
<meta property="og:image" content="${socialImage}"><meta property="og:image:secure_url" content="${socialImage}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(socialImageAlt)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${socialImage}"><meta name="twitter:image:alt" content="${escapeHtml(socialImageAlt)}">
<script type="application/ld+json">${JSON.stringify(person).replaceAll('<', '\\u003c')}</script><script type="module" src="/assets/client.js"></script></head>
<body><script>const crtFilter=document.querySelector(".crt-filter");if(crtFilter)document.body.prepend(crtFilter);</script><div class="crt-viewport"><div class="crt-screen" aria-hidden="true"></div><main><div class="terminal"><div id="transcript" aria-label="Terminal transcript">${transcript}</div>
<form id="command-form" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" hidden><label for="command"><span class="user">web</span>@<span class="host">panicek.sk</span> <span id="cwd" class="cwd">~</span> <span id="exit-status"></span>$ <span class="sr-only">Shell command</span></label><div class="input-wrap"><div id="input-highlight" aria-hidden="true"></div><textarea rows="1" id="command" name="command" aria-label="Shell command" placeholder=" " spellcheck="false" autocapitalize="none" autocorrect="off" autocomplete="off" maxlength="16384" disabled></textarea></div></form>
<noscript><p>Read the files above or <a href="/home/web/CAREER.md">open my career history</a>. Enable JavaScript to explore the interactive shell.</p></noscript></div>
<footer><span id="status" role="status">Personal portfolio · plain files, open to explore</span><span id="shell-controls" hidden><button id="help" type="button">help</button> <button id="stop" type="button" hidden>interrupt</button> <button id="reset-filesystem" type="button">reset filesystem</button></span><button id="crt-toggle" type="button" aria-label="CRT effect" aria-pressed="true" hidden>crt: on</button><a href="/home/web/ABOUT.md">raw</a><span aria-hidden="true">·</span><a href="/files.json">files</a><span aria-hidden="true">·</span><a href="/llms.txt">for agents</a></footer></main></div></body></html>`;
await Bun.write(
  join(out, 'index.html'),
  await minify(html, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
  }),
);
// Physical shortcuts contain only generated, in-tree targets. Remote data contains no symlinks.
for (const [path, { target }] of Object.entries(aliases)) {
  if (path === '/~') continue;
  await symlink('.' + target, join(out, path));
}
for (const path of [
  ...directories,
  HOME,
  '/~',
  ...directories.map((path) => '/~' + path.slice(HOME.length)),
]) {
  await Bun.write(join(out, path, 'index.html'), await Bun.file(join(out, 'index.html')).bytes());
}
console.log(
  `Built ${published.length} portfolio files, raw home paths, metadata, and browser bundles in dist/`,
);

for (const path of new Bun.Glob('**/*').scanSync({ cwd: out, onlyFiles: true })) {
  if (path.startsWith('_files/')) continue;
  if (!/\.(js|css|json|html|svg|txt|md|xml|wasm)$/.test(path)) continue;
  const bytes = new Uint8Array(await Bun.file(join(out, path)).arrayBuffer());
  if (bytes.length < 1024) continue;
  await Bun.write(join(out, path + '.gz'), Bun.gzipSync(bytes, { level: 9 }));
  await Bun.write(
    join(out, path + '.br'),
    brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
  );
}
console.log(
  `Shell worker: ${Bun.file(join(out, 'assets/shell.worker.js.br')).size} bytes with Brotli`,
);
