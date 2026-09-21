import { unzipSync } from 'fflate';
import { mkdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const MAX_ARCHIVE = 32 * 1024 * 1024;
const MAX_CONTENT = 64 * 1024 * 1024;
const REQUIRED = [
  'index.html',
  'filesystem.json',
  'snapshot.json',
  'robots.txt',
  'service-worker.js',
  'assets/client.js',
  'assets/shell.worker.js',
  'assets/styles.css',
  'assets/vim.js',
];

export function unpack(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > MAX_ARCHIVE) throw new Error('Archive exceeds size limit');
  let total = 0;
  let count = 0;
  const paths = new Set<string>();
  const files = unzipSync(bytes, {
    filter(entry) {
      const path = entry.name;
      if (++count > 2000 || paths.has(path))
        throw new Error('Too many or duplicate archive entries');
      paths.add(path);
      if (
        !path ||
        path.startsWith('/') ||
        path.includes('\\') ||
        /[\x00-\x1f]/.test(path) ||
        path.split('/').some((part) => part === '..' || part === '.')
      )
        throw new Error('Unsafe archive path');
      total += entry.originalSize;
      if (total > MAX_CONTENT || entry.originalSize > 16 * 1024 * 1024)
        throw new Error('Expanded archive exceeds size limit');
      return !path.endsWith('/');
    },
  });
  for (const path of REQUIRED)
    if (!files[path]?.length) throw new Error(`Missing required file: ${path}`);
  const html = new TextDecoder().decode(files['index.html']);
  if (!html.includes('id="transcript"') || !html.includes('/assets/client.js'))
    throw new Error('Invalid portfolio HTML');
  JSON.parse(new TextDecoder().decode(files['filesystem.json']));
  JSON.parse(new TextDecoder().decode(files['snapshot.json']));
  return files;
}

export async function activate(
  root: string,
  identity: string,
  files: Record<string, Uint8Array>,
  stillCurrent: () => Promise<boolean>,
) {
  if (!/^master-\d+-\d+$/.test(identity)) throw new Error('Invalid build identity');
  const stage = join(root, 'releases', `.staging-${identity}`);
  const release = join(root, 'releases', identity);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  try {
    for (const [path, bytes] of Object.entries(files)) {
      const destination = resolve(stage, path);
      if (!destination.startsWith(stage + '/')) throw new Error('Unsafe installation path');
      await Bun.write(destination, bytes);
    }
    if (!(await stillCurrent()))
      throw new Error('Master changed while downloading; retry next poll');
    let previous = '';
    try {
      previous = await readlink(join(root, 'current'));
    } catch {}
    if (previous === release) {
      await rm(stage, { recursive: true, force: true });
      return;
    }
    await rm(release, { recursive: true, force: true });
    await rename(stage, release);
    const next = join(root, '.current-next');
    await rm(next, { force: true });
    await symlink(release, next);
    await rename(next, join(root, 'current'));
    await Bun.write(
      join(root, '.deployed.json'),
      JSON.stringify({ identity, previous, deployedAt: new Date().toISOString() }) + '\n',
    );
    console.log(`Deployed ${identity}; previous release: ${previous}`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'panicek-artifact-updater' },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > MAX_ARCHIVE) {
      await response.body.cancel().catch(() => {});
      throw new Error('Download exceeds size limit');
    }
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function main() {
  const repo = process.env.PORTFOLIO_REPO || 'adrianpanicek/panicek.sk';
  const root = resolve(process.env.PORTFOLIO_ROOT || '/srv/http/panicek');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository');
  async function api(path: string): Promise<any> {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'panicek-artifact-updater',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`GitHub API failed: HTTP ${response.status}`);
    return response.json();
  }
  const result = await api(
    'actions/workflows/build.yml/runs?branch=master&event=push&status=success&per_page=1',
  );
  const run = result.workflow_runs?.[0];
  if (!run) {
    console.log('No successful master build yet');
    return;
  }
  if (
    run.head_branch !== 'master' ||
    run.event !== 'push' ||
    run.conclusion !== 'success' ||
    run.head_repository?.full_name !== repo
  )
    throw new Error('Unexpected workflow provenance');
  const identity = `master-${run.id}-${run.run_attempt}`;
  if (!/^master-\d+-\d+$/.test(identity)) throw new Error('Invalid workflow identity');
  let state: { identity?: string } = {};
  const stateFile = Bun.file(join(root, '.deployed.json'));
  if (await stateFile.exists()) state = await stateFile.json();
  if (state.identity === identity) {
    console.log(`Already deployed ${identity}`);
    return;
  }
  const stillCurrent = async () => (await api('commits/master')).sha === run.head_sha;
  if (!(await stillCurrent())) {
    console.log('Latest successful build is behind master; waiting');
    return;
  }
  const release = await api(`releases/tags/${identity}`);
  if (release.draft || release.target_commitish !== run.head_sha)
    throw new Error('Release does not match successful build');
  const asset = release.assets?.find((item: any) => item.name === 'portfolio.zip');
  if (
    !asset ||
    asset.state !== 'uploaded' ||
    asset.size > MAX_ARCHIVE ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')
  )
    throw new Error('Missing verified portfolio artifact');
  const expected = `https://github.com/${repo}/releases/download/${identity}/portfolio.zip`;
  if (asset.browser_download_url !== expected) throw new Error('Unexpected artifact URL');
  const bytes = await download(expected);
  const digest = 'sha256:' + new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  if (digest !== asset.digest) throw new Error('Artifact SHA-256 mismatch');
  await activate(root, identity, unpack(bytes), stillCurrent);
}

if (import.meta.main)
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
