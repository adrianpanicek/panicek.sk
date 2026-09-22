import { describe, expect, test } from 'bun:test';
import { createFilesystem } from '../src/filesystem';
import { createShell } from '../src/shell';

const launcher = '#!/usr/bin/env portfolio-app\ndoom\n';

async function createDoomShell() {
  return createShell(await createFilesystem({ '/home/web/DOOM': launcher }));
}

describe('virtual executable applications', () => {
  test('launches Doom from relative and absolute virtual paths', async () => {
    const shell = await createDoomShell();

    expect((await shell.exec('./DOOM')).application).toEqual({
      name: 'doom',
      executablePath: '/home/web/DOOM',
      args: [],
    });
    expect((await shell.exec('/home/web/DOOM')).application?.name).toBe('doom');
  });

  test('resolves copied and renamed launchers from their virtual contents', async () => {
    const shell = await createDoomShell();

    await shell.exec('cp ~/DOOM /tmp/game');
    await shell.exec('chmod +x /tmp/game');
    expect((await shell.exec('/tmp/game')).application?.name).toBe('doom');

    await shell.exec('mv /tmp/game /tmp/renamed-game');
    expect((await shell.exec('/tmp/renamed-game')).application).toEqual({
      name: 'doom',
      executablePath: '/tmp/renamed-game',
      args: [],
    });
  });

  test('reports permission and argument errors without launching', async () => {
    const shell = await createDoomShell();

    expect((await shell.exec('chmod -x ~/DOOM; ./DOOM')).stderr).toContain('Permission denied');
    await shell.exec('chmod -x ~/DOOM');
    const nonExecutable = await shell.exec('./DOOM');
    expect(nonExecutable.application).toBeUndefined();
    expect(nonExecutable.stderr).toContain('Permission denied');
    await shell.exec('chmod +x ~/DOOM');
    expect((await shell.exec('./DOOM extra')).stderr).toContain('does not accept arguments');
  });

  test('requires an exact launcher file in a standalone foreground command', async () => {
    const shell = await createDoomShell();
    await shell.exec('mkdir /tmp/directory');
    await shell.exec("printf '#!/usr/bin/env portfolio-app\\nother\\n' > /tmp/replacement");
    await shell.exec('chmod +x /tmp/replacement');

    for (const command of [
      '/tmp/replacement',
      '/tmp/directory',
      'DOOM',
      './DOOM | cat',
      './DOOM < /dev/null',
      './DOOM > /tmp/output',
      'time ./DOOM',
      './DOOM &',
      './DOOM; true',
      './DOOM && true',
    ]) {
      expect((await shell.exec(command)).application, command).toBeUndefined();
    }

    await shell.exec("printf 'replacement\\n' > ~/DOOM");
    expect((await shell.exec('./DOOM')).application).toBeUndefined();
  });

  test('a removed launcher falls through to the shell not-found error', async () => {
    const shell = await createDoomShell();
    const result = await shell.exec('rm ~/DOOM; ./DOOM');

    expect(result.application).toBeUndefined();
    expect(result.stderr).toContain('No such file or directory');
  });
});
