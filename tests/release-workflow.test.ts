import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';

test('release step publishes only the current master and stops on API errors', async () => {
  const workflow = parse(
    await Bun.file(join(import.meta.dir, '../.github/workflows/build.yml')).text(),
  );
  const step = workflow.jobs.publish.steps.find(
    (step: { name?: string }) => step.name === 'Publish current master build',
  );
  const cwd = await mkdtemp(join(tmpdir(), 'release-workflow-'));
  try {
    const gh = join(cwd, 'gh');
    await Bun.write(
      gh,
      `#!/bin/sh
if [ "$1" = api ]; then
  printf '%s\\n' "$CURRENT_SHA"
  exit "$API_STATUS"
fi
printf '%s\\n' "$@" > "$RELEASE_LOG"
`,
    );
    await chmod(gh, 0o755);
    for (const [current, status, publishes] of [
      ['current', '0', true],
      ['newer', '0', false],
      ['current', '1', false],
    ] as const) {
      const log = join(cwd, `release-${current}-${status}`);
      const result = Bun.spawnSync(['bash', '-e', '-c', step.run], {
        cwd,
        env: {
          ...process.env,
          PATH: cwd + ':' + process.env.PATH,
          CURRENT_SHA: current,
          API_STATUS: status,
          RELEASE_LOG: log,
          GITHUB_REPOSITORY: 'example/site',
          GITHUB_SHA: 'current',
          RELEASE_TAG: 'master-123-1',
        },
      });
      expect(result.exitCode).toBe(Number(status));
      expect(await Bun.file(log).exists()).toBe(publishes);
      if (publishes) {
        const args = (await Bun.file(log).text()).trim().split('\n');
        expect(args.slice(0, 4)).toEqual([
          'release',
          'create',
          'master-123-1',
          '.artifacts/portfolio.zip',
        ]);
        expect(args[args.indexOf('--target') + 1]).toBe('current');
      }
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
