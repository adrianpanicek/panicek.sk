const port = '4322';
const base = `http://127.0.0.1:${port}`;
const server = Bun.spawn([process.execPath, 'scripts/serve.ts'], {
  env: { ...process.env, PORT: port },
  stdout: 'inherit',
  stderr: 'inherit',
});

try {
  const deadline = Date.now() + 10000;
  while (true) {
    if (server.exitCode !== null) throw new Error('Preview server exited before becoming ready');
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(500) });
      if (response.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error('Preview server did not become ready');
    await Bun.sleep(100);
  }
  const tests = Bun.spawn([process.execPath, 'run', 'test:browser'], {
    env: { ...process.env, TEST_URL: base },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.exitCode = await tests.exited;
} finally {
  server.kill();
  await server.exited;
}

export {};
