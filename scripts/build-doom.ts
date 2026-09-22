import { assertDoomArtifact } from './doom-artifact';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

type PinnedDownload = {
  fileName: string;
  sha256: string;
  url: string;
};

const upstreamRevision = '31cc1af9656a8184830090c4e9f268383f5d7e15';
const upstreamDirectory = `doom.wasm-${upstreamRevision}`;
const repositoryRoot = resolve(import.meta.dir, '..');
const cacheRoot = join(repositoryRoot, '.cache', 'doom-build');
const archiveRoot = join(cacheRoot, 'archives');
const workRoot = join(cacheRoot, 'work');
const sourceRoot = join(workRoot, upstreamDirectory);
const vendorRoot = join(repositoryRoot, 'vendor', 'doom');

const upstream: PinnedDownload = {
  fileName: `${upstreamDirectory}.tar.gz`,
  sha256: 'e33a2b883cd2b4094c6ef326b7729517dda250836aa91652d7bf316051982f93',
  url: `https://github.com/jacobenget/doom.wasm/archive/${upstreamRevision}.tar.gz`,
};

const wasiSdk: PinnedDownload = {
  fileName: 'wasi-sdk-24.0-x86_64-linux.tar.gz',
  sha256: 'c6c38aab56e5de88adf6c1ebc9c3ae8da72f88ec2b656fb024eda8d4167a0bc5',
  url: 'https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-24/wasi-sdk-24.0-x86_64-linux.tar.gz',
};

const binaryen: PinnedDownload = {
  fileName: 'binaryen-version_119-x86_64-linux.tar.gz',
  sha256: '716bcf9f5f36a6f466239fbb09a925eeaf54c46411ccefac979ec649e7c06d2d',
  url: 'https://github.com/WebAssembly/binaryen/releases/download/version_119/binaryen-version_119-x86_64-linux.tar.gz',
};

const sharewareArchive: PinnedDownload = {
  fileName: 'doom-wad-shareware_1.9.fixed.orig.tar.gz',
  sha256: 'e02c8b5e01be7373d4c53f82556118e2aaaf8f83fa2af5eee1efadf9c55c4eb1',
  url: 'https://deb.debian.org/debian/pool/non-free/d/doom-wad-shareware/doom-wad-shareware_1.9.fixed.orig.tar.gz',
};

async function sha256(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

async function verifyDigest(path: string, expected: string): Promise<void> {
  const actual = await sha256(path);
  if (actual !== expected) {
    throw new Error(`SHA-256 mismatch for ${path}: expected ${expected}, received ${actual}`);
  }
}

async function download(input: PinnedDownload): Promise<string> {
  const destination = join(archiveRoot, input.fileName);
  if (await Bun.file(destination).exists()) {
    await verifyDigest(destination, input.sha256);
    return destination;
  }

  console.log(`Downloading ${input.url}`);
  const response = await fetch(input.url);
  if (!response.ok) {
    throw new Error(`Download failed for ${input.url}: ${response.status} ${response.statusText}`);
  }
  await Bun.write(destination, response);
  await verifyDigest(destination, input.sha256);
  return destination;
}

async function run(command: string[], cwd = repositoryRoot): Promise<void> {
  const process = Bun.spawn(command, {
    cwd,
    stderr: 'inherit',
    stdout: 'inherit',
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command.join(' ')}`);
  }
}

async function extract(archive: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  await run(['tar', '-xzf', archive, '-C', destination]);
}

await mkdir(archiveRoot, { recursive: true });
await mkdir(vendorRoot, { recursive: true });

const [upstreamArchive, wasiSdkArchive, binaryenArchive, wadArchive] = await Promise.all([
  download(upstream),
  download(wasiSdk),
  download(binaryen),
  download(sharewareArchive),
]);

await rm(workRoot, { force: true, recursive: true });
await mkdir(workRoot, { recursive: true });
await extract(upstreamArchive, workRoot);
await extract(wasiSdkArchive, workRoot);
await extract(binaryenArchive, workRoot);

const wadRoot = join(workRoot, 'shareware');
await extract(wadArchive, wadRoot);
await mkdir(join(sourceRoot, 'build'), { recursive: true });
const wadPath = join(wadRoot, 'doom-wad-shareware-1.9.fixed', 'doom1.wad');
await verifyDigest(wadPath, '1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771');
await copyFile(wadPath, join(sourceRoot, 'build', 'DOOM1.WAD'));

const patchPath = join(vendorRoot, 'doom-exit.patch');
await run(['patch', '--batch', '--forward', '-p1', '-i', patchPath], sourceRoot);

const wasiRoot = join(workRoot, 'wasi-sdk-24.0-x86_64-linux');
const binaryenRoot = join(workRoot, 'binaryen-version_119');
const compiler = join(wasiRoot, 'bin', 'clang');
const cFlags = [
  '--target=wasm32-unknown-wasi',
  '-Wall',
  '-g',
  '-Os',
  `-ffile-prefix-map=${sourceRoot}=.`,
].join(' ');

await run(
  [
    'make',
    'build/doom.wasm',
    `CC=${compiler}`,
    `CFLAGS=${cFlags}`,
    `WASM_AS=${join(binaryenRoot, 'bin', 'wasm-as')}`,
    `WASM_MERGE=${join(binaryenRoot, 'bin', 'wasm-merge')}`,
    `WASM_METADCE=${join(binaryenRoot, 'bin', 'wasm-metadce')}`,
    'DEV_PYTHON_VIRTUAL_ENV=/usr',
    'ACTIVATE_DEV_PYTHON_VIRTUAL_ENV=true',
  ],
  sourceRoot,
);

const builtArtifact = join(sourceRoot, 'build', 'doom.wasm');
const artifactBytes = new Uint8Array(await Bun.file(builtArtifact).arrayBuffer());
assertDoomArtifact(artifactBytes);
const destination = join(vendorRoot, 'doom.wasm');
await copyFile(builtArtifact, destination);
await copyFile(join(sourceRoot, 'LICENSE'), join(vendorRoot, 'LICENSE-GPL-2.0.txt'));

console.log(`Built ${destination}`);
console.log(`SHA-256: ${await sha256(destination)}`);
