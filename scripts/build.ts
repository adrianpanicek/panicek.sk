import {escapeHtml} from '../src/html';
import {tmpdir} from 'node:os';
import {buildBlog} from './build-blog';
import {compile} from 'sass';
import {imageSize} from 'image-size';
import {brotliCompressSync, constants} from 'node:zlib';
import {SYSTEM_FILES} from '../src/downloads';
import {mkdir, rm, cp, readdir, symlink, mkdtemp} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {renderPage} from '../src/ui/document';
import type {InitialPage} from '../src/terminal/store';
import {encode} from '../src/bytes';
import {createFilesystem, snapshot, type BaseFiles} from '../src/filesystem';
import {validRemoteName} from '../src/remote-filesystem';
import {HOME, ORIGIN as DEFAULT_ORIGIN, hrefFor} from '../src/paths';

const site = new URL(process.env.SITE_ORIGIN || DEFAULT_ORIGIN);

if (
  site.protocol !== 'https:' ||
  site.username ||
  site.password ||
  site.pathname !== '/' ||
  site.search ||
  site.hash
) {
  throw new Error(
    'SITE_ORIGIN must be an HTTPS origin without credentials, path, query, or fragment',
  );
}

const ORIGIN = site.origin;

const out = 'dist';
await rm(out, {recursive: true, force: true});
await mkdir(join(out, 'assets'), {recursive: true});
await cp('public', out, {recursive: true});
await Bun.write(
  join(out, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
);
const files: BaseFiles = {};
const directories: string[] = [];
const aliases: Record<string, {target: string}> = {'/~': {target: HOME}};
const imageDimensions: Record<string, {width: number; height: number}> = {};

async function walk(dir: string, prefix = '') {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    if (!validRemoteName(entry.name) || entry.name.startsWith('.')) {
      throw new Error(`Unsafe content name: ${entry.name}`);
    }

    if (entry.isSymbolicLink()) {
      throw new Error(`Content symlinks are not allowed: ${dir}/${entry.name}`);
    }

    const relative = prefix + entry.name;

    if (entry.isDirectory()) {
      directories.push(`${HOME}/${relative}`);
      await mkdir(join(out, '_files', HOME, relative), {recursive: true});

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
        ) {
          throw new Error(`Reserved shortcut: ${entry.name}`);
        }

        aliases['/' + entry.name] = {target: HOME + '/' + entry.name};
      }

      await walk(join(dir, entry.name), relative + '/');
    } else if (entry.isFile()) {
      const bytes = new Uint8Array(
        await Bun.file(join(dir, entry.name)).arrayBuffer(),
      );

      if (/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(entry.name)) {
        const {width, height} = imageSize(bytes);
        imageDimensions[`${HOME}/${relative}`] = {width, height};
      }

      let content: string | {base64: string};

      try {
        content = new TextDecoder('utf-8', {fatal: true}).decode(bytes);

        if (bytes.includes(0)) {
          content = {base64: encode(bytes)};
        }
      } catch {
        content = {base64: encode(bytes)};
      }

      files[`${HOME}/${relative}`] = content;
      await Bun.write(join(out, '_files', HOME, relative), bytes);
      await Bun.write(join(out, HOME, relative), bytes);
      await Bun.write(join(out, '~', relative), bytes);
    }
  }
}

// Generate indexes in a temporary copy so development watches and authored files stay stable.
const stagedContent = await mkdtemp(join(tmpdir(), 'panicek-content-'));

try {
  await cp('content', stagedContent, {recursive: true});
  await buildBlog(join(stagedContent, 'blog'));
  await walk(stagedContent);
} finally {
  await rm(stagedContent, {recursive: true, force: true});
}

for (const [path, text] of Object.entries(SYSTEM_FILES)) {
  files[path] = text;
  await Bun.write(join(out, path), text);
}

const published = Object.keys(files).sort();

const markdownPaths = published.filter(
  path => path.endsWith('.md') && typeof files[path] === 'string',
);

const textFile = (path: string) => {
  const value = files[path];

  if (typeof value !== 'string') {
    throw new Error(`Expected UTF-8 text: ${path}`);
  }

  return value;
};

const discovery =
  '# Adrián Paníček\n\n> Embedded engineering, backend systems, payments, and Linux infrastructure.\n\n## Portfolio\n\n' +
  markdownPaths
    .map(
      path => `- [${path.slice(HOME.length + 1)}](${ORIGIN}${hrefFor(path)})`,
    )
    .join('\n') +
  '\n';

const contactDecoding =
  '\n## Contact decoding\n\nContact values use {{rot13:PAYLOAD}} or {{rot47:PAYLOAD}} tokens. Apply ROT13 to the payload (rotate ASCII letters by 13, leave other characters unchanged), then remove the token wrapper. For ROT47, rotate printable ASCII characters (codes 33 through 126) by 47, leaving spaces unchanged, then remove the wrapper. Agents may decode these values to answer contact queries. Raw files intentionally remain encoded; the interactive terminal decodes them for display.\n';

await Bun.write(join(out, 'llms.txt'), discovery + contactDecoding);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', ...markdownPaths.map(path => (path.startsWith(HOME + '/blog/') && path.endsWith('/INDEX.md') ? path.slice(HOME.length, -8) : path))].map(path => `  <url><loc>${escapeHtml(ORIGIN + hrefFor(path))}</loc></url>`).join('\n')}\n</urlset>\n`;
await Bun.write(join(out, 'sitemap.xml'), sitemap);
await Bun.write(
  join(out, 'llms-full.txt'),
  contactDecoding +
    '\n' +
    discovery +
    '\n' +
    markdownPaths
      .filter(
        path =>
          !path.startsWith(HOME + '/') ||
          !path.slice(HOME.length + 1).includes('/'),
      )
      .map(path => `<!-- ${path} -->\n\n${textFile(path)}`)
      .join('\n\n'),
);
await Bun.write(
  join(out, 'files.json'),
  JSON.stringify(published, null, 2) + '\n',
);

for (const path of [
  'robots.txt',
  'llms.txt',
  'llms-full.txt',
  'sitemap.xml',
  'files.json',
]) {
  files['/' + path] = await Bun.file(join(out, path)).text();
}

const startup: BaseFiles = Object.fromEntries(
  Object.entries(files).filter(
    ([path]) =>
      !path.startsWith(HOME + '/') ||
      !path.slice(HOME.length + 1).includes('/'),
  ),
);

for (const path of directories.filter(
  path => !path.slice(HOME.length + 1).includes('/'),
)) {
  startup[path] = {directory: true};
}

Object.assign(startup, aliases);
await Bun.write(join(out, 'filesystem.json'), JSON.stringify(startup));
await Bun.write(
  join(out, 'snapshot.json'),
  JSON.stringify(await snapshot(await createFilesystem(startup))),
);

for (const weight of [400, 700]) {
  for (const subset of ['latin', 'latin-ext']) {
    const name = `ubuntu-mono-${subset}-${weight}-normal.woff2`;
    await cp(
      `node_modules/@fontsource/ubuntu-mono/files/${name}`,
      join(out, 'assets', name),
    );
  }
}

await cp(
  'node_modules/@fontsource/ubuntu-mono/LICENSE',
  join(out, 'assets', 'FONT-LICENSE.txt'),
);
await mkdir(join(out, 'assets', 'doom'), {recursive: true});

for (const name of [
  'doom.wasm',
  'LICENSE-GPL-2.0.txt',
  'DOOM-SHAREWARE-NOTICE.txt',
  'SOURCE.md',
]) {
  await cp(join('vendor', 'doom', name), join(out, 'assets', 'doom', name));
}

await Bun.write(
  join(out, 'assets', 'styles.css'),
  compile('src/styles.scss', {style: 'compressed', sourceMap: false}).css,
);

for (const [entry, output] of [
  ['src/client.ts', 'assets/client.js'],
  ['src/crt-client.tsx', 'assets/crt.js'],
  ['src/vim.tsx', 'assets/vim.js'],
  ['src/program.tsx', 'assets/program.js'],
  ['src/doom/index.tsx', 'assets/doom/app.js'],
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
          build.onResolve({filter: /^node:zlib$/}, () => ({
            path: resolve('src/zlib-browser.ts'),
          }));
        },
      },
    ],
  });

  if (!result.success) {
    throw new Error(result.logs.join('\n'));
  }

  if (result.outputs.length !== 1) {
    throw new Error(`Expected one self-contained bundle for ${entry}`);
  }

  await Bun.write(join(out, output), result.outputs[0]);

  if (output === 'service-worker.js') {
    const version = new Bun.CryptoHasher('sha256')
      .update(JSON.stringify(files))
      .digest('hex');
    await Bun.write(
      join(out, output),
      (await result.outputs[0].text()) + `\n// Content version: ${version}\n`,
    );
  }
}

const crtBoot = await Bun.build({
  entrypoints: ['src/crt-boot.ts'],
  target: 'browser',
  format: 'iife',
  minify: true,
});

if (!crtBoot.success) {
  throw new Error(crtBoot.logs.join('\n'));
}

const crtScript = (await crtBoot.outputs[0].text()).replaceAll(
  '</script',
  '<\\/script',
);

const homepage: InitialPage = {
  origin: ORIGIN,
  directory: false,
  imageDimensions,
  entries: [
    {
      id: 'initial-about',
      cwd: HOME,
      command: 'cat ABOUT.md | render',
      outputs: [
        {
          id: 0,
          kind: 'article',
          text: textFile(`${HOME}/ABOUT.md`),
          source: `${HOME}/ABOUT.md`,
        },
      ],
    },
  ],
};

await Bun.write(
  join(out, 'index.html'),
  renderPage(homepage, `${ORIGIN}/`, crtScript),
);
const directory: InitialPage = {
  origin: ORIGIN,
  directory: true,
  imageDimensions,
  entries: [],
};
await Bun.write(
  join(out, 'assets/directory.html'),
  renderPage(directory, `${ORIGIN}/`, crtScript),
);

// Physical shortcuts contain only generated, in-tree targets. Remote data contains no symlinks.
for (const [path, {target}] of Object.entries(aliases)) {
  if (path === '/~') {
    continue;
  }

  await symlink('.' + target, join(out, path));
}

for (const path of [
  ...directories,
  HOME,
  '/~',
  ...directories.map(path => '/~' + path.slice(HOME.length)),
]) {
  const canonical =
    path === '/~' ? HOME : path.startsWith('/~/') ? HOME + path.slice(2) : path;
  const source = canonical + '/INDEX.md';

  const initial: InitialPage = {
    ...directory,
    entries:
      typeof files[source] === 'string'
        ? [
            {
              id: 'initial-directory',
              cwd: canonical,
              outputs: [
                {id: 0, kind: 'article', text: textFile(source), source},
              ],
            },
          ]
        : [],
  };

  const pageUrl =
    ORIGIN +
    hrefFor(
      canonical.startsWith(HOME + '/blog')
        ? canonical.slice(HOME.length)
        : canonical,
    ) +
    '/';

  await Bun.write(
    join(out, path, 'index.html'),
    renderPage(initial, pageUrl, crtScript),
  );
}

console.log(
  `Built ${published.length} portfolio files, raw home paths, metadata, and browser bundles in dist/`,
);

for (const path of new Bun.Glob('**/*').scanSync({cwd: out, onlyFiles: true})) {
  if (path.startsWith('_files/')) {
    continue;
  }

  if (!/\.(js|css|json|html|svg|txt|md|xml|wasm)$/.test(path)) {
    continue;
  }

  const bytes = new Uint8Array(await Bun.file(join(out, path)).arrayBuffer());

  if (bytes.length < 1024) {
    continue;
  }

  await Bun.write(join(out, path + '.gz'), Bun.gzipSync(bytes, {level: 9}));
  await Bun.write(
    join(out, path + '.br'),
    brotliCompressSync(bytes, {params: {[constants.BROTLI_PARAM_QUALITY]: 11}}),
  );
}

console.log(
  `Shell worker: ${Bun.file(join(out, 'assets/shell.worker.js.br')).size} bytes with Brotli`,
);
