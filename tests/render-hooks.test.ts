import { expect, test } from 'bun:test';
import { createFilesystem } from '../src/filesystem';
import { createShell } from '../src/shell';

const index = '---\non_render: "cat ~/ABOUT.md | render"\n---\n\n# Blog\n';
test('render metadata executes after the document but plain cat never triggers it', async () => {
  const shell = createShell(
    await createFilesystem({ '/home/web/blog/INDEX.md': index, '/home/web/ABOUT.md': '# About\n' }),
  );
  expect((await shell.exec('cat ~/blog/INDEX.md')).renderCommands).toEqual([]);
  for (const command of ['render ~/blog', 'cat ~/blog/INDEX.md | render']) {
    const result = await shell.exec(command);
    expect(result.documents[0].path).toBe('/home/web/blog/INDEX.md');
    expect(result.renderCommands).toHaveLength(1);
    expect(result.renderCommands[0].command).toBe('cat ~/ABOUT.md | render');
    expect(result.renderCommands[0].result.documents[0].text).toBe('# About\n');
  }
});

test('render hooks use the sandbox and return plain output and errors', async () => {
  const shell = createShell(
    await createFilesystem({
      '/home/web/test.md': '---\non_render: "echo hook-output"\n---\n# Test',
    }),
  );
  expect((await shell.exec('render test.md')).renderCommands[0].result.stdout).toBe(
    'hook-output\n',
  );
  await shell.fs.writeFile(
    '/home/web/test.md',
    '---\non_render: "cat missing.md | render"\n---\n# Test',
  );
  expect((await shell.exec('render test.md')).renderCommands[0].result.stderr).toContain(
    'missing.md',
  );
});

test('recursive render hooks stop and invalid metadata preserves the document', async () => {
  const shell = createShell(
    await createFilesystem({
      '/home/web/ABOUT.md': '---\non_render: "render ~/ABOUT.md"\n---\n# About',
    }),
  );
  const result = await shell.exec('render ABOUT.md');
  expect(result.renderCommands).toHaveLength(1);
  expect(result.renderCommands[0].result.renderCommands).toEqual([]);
  expect(result.renderCommands[0].result.stderr).toContain('recursive');
  await shell.fs.writeFile('/home/web/ABOUT.md', '---\non_render: [not, a, command]\n---\n# About');
  const invalid = await shell.exec('render ABOUT.md');
  expect(invalid.documents).toHaveLength(1);
  expect(invalid.stderr).toContain('on_render');
});

test('a chain of distinct documents is bounded to eight hook commands', async () => {
  const files = Object.fromEntries(
    Array.from({ length: 12 }, (_, n) => [
      `/home/web/${n}.md`,
      `---\non_render: "render ~/${n + 1}.md"\n---\n# Page ${n}`,
    ]),
  );
  const shell = createShell(await createFilesystem(files));
  let result = await shell.exec('render ~/0.md');
  let commands = 0;
  while (result.renderCommands.length) {
    commands++;
    result = result.renderCommands[0].result;
  }
  expect(commands).toBe(8);
  expect(result.stderr).toContain('execution limit');
});
