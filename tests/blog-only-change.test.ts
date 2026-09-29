import {expect, test} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const script = join(import.meta.dir, '../scripts/blog-only-change.ts');

test('CI exempts only nonempty blog-only diffs, including deletions and renames', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'blog-change-'));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], {cwd});
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString());
    }
    return result.stdout.toString().trim();
  };
  const classify = (base: string) => {
    const result = Bun.spawnSync([process.execPath, script, base], {cwd});
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  };
  const commit = () => {
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    git('config', 'user.name', 'CI Test');
    git('config', 'user.email', 'ci@example.invalid');
    await Bun.write(join(cwd, 'README.md'), 'Site\n');
    const base = commit();
    expect(classify(base)).toBe('false');
    expect(classify('0'.repeat(40))).toBe('false');
    expect(classify('f'.repeat(40))).toBe('false');
    await Bun.write(join(cwd, 'content/blog/post/INDEX.md'), '# Post\n');
    await Bun.write(join(cwd, 'content/blog/post/eggs.gif'), 'asset');
    const added = commit();
    expect(classify(base)).toBe('true');
    git('mv', 'content/blog/post/INDEX.md', 'content/blog/post/renamed.md');
    commit();
    expect(classify(added)).toBe('true');
    git('rm', 'content/blog/post/renamed.md');
    const removed = commit();
    expect(classify(added)).toBe('true');
    git('mv', 'content/blog/post/eggs.gif', 'eggs.gif');
    commit();
    expect(classify(removed)).toBe('false');
    await Bun.write(join(cwd, 'README.md'), 'Changed site\n');
    const mixed = commit();
    expect(classify(base)).toBe('false');
    await Bun.write(
      join(cwd, 'content/blogger/post.md'),
      '# Not the blog directory\n',
    );
    commit();
    expect(classify(mixed)).toBe('false');
  } finally {
    await rm(cwd, {recursive: true, force: true});
  }
});
