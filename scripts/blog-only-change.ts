// Unknown baselines (for example a new branch) must keep the full test suite.
const base = process.argv[2] || '';
let blogOnly = false;
if (/^[a-f0-9]{40,64}$/.test(base) && !/^0+$/.test(base)) {
  const diff = Bun.spawnSync([
    'git',
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    base,
    'HEAD',
    '--',
  ]);
  if (diff.exitCode === 0) {
    const paths = diff.stdout.toString().split('\0').filter(Boolean);
    blogOnly =
      paths.length > 0 && paths.every(path => path.startsWith('content/blog/'));
  }
}
console.log(String(blogOnly));

export {};
