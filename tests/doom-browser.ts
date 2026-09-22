import { chromium, type Page } from 'playwright';
import { strict as assert } from 'node:assert';
import { doomBrowserFixture } from './fixtures/doom';

const base = process.env.TEST_URL || 'http://127.0.0.1:4321';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const fixture = doomBrowserFixture();

async function ready(page: Page) {
  await page.waitForFunction(
    () => !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
  );
}

async function command(page: Page, text: string) {
  await page.locator('#command').fill(text);
  await page.locator('#command').press('Enter');
}

async function quit(page: Page, code = 0) {
  await page.evaluate((code) => (window as any).doomFixture.quit(code), code);
  await ready(page);
}

async function geometry(page: Page) {
  const game = await page.locator('#doom-game').boundingBox();
  const canvas = await page.locator('#doom-game canvas').boundingBox();
  const overlay = await page.locator('.crt-screen').boundingBox();
  assert.ok(game && canvas && overlay);
  assert.ok(Math.abs(game.width - (game.height * 4) / 3) <= 1);
  for (const bounds of [canvas, overlay]) {
    for (const key of ['x', 'y', 'width', 'height'] as const)
      assert.ok(
        Math.abs(bounds[key] - game[key]) <= 1,
        `${key} aligns with the game: ${JSON.stringify({ game, canvas, overlay })}`,
      );
  }
  assert.equal(
    await page.locator('.crt-viewport').evaluate((node) => getComputedStyle(node).filter),
    'none',
  );
  assert.equal(
    await page.locator('.crt-screen').evaluate((node) => getComputedStyle(node).pointerEvents),
    'none',
  );
  assert.ok(
    await page.evaluate(
      () =>
        Number(getComputedStyle(document.querySelector('.crt-screen')!).zIndex) >
        Number(getComputedStyle(document.querySelector('#doom-game')!).zIndex),
    ),
  );
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const state = window as any;
    state.doomFrames = 0;
    state.doomTicks = 0;
    state.doomProgress = [];
    const instantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = (async (bytes: BufferSource, imports: any) => {
      if (imports?.lifecycle) {
        const draw = imports.ui.drawFrame;
        imports.ui.drawFrame = (...args: number[]) => {
          state.doomTicks++;
          return draw(...args);
        };
      }
      const result = (await instantiate(
        bytes,
        imports,
      )) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
      if (imports?.lifecycle) state.doomFixture = result.instance.exports;
      return result;
    }) as typeof WebAssembly.instantiate;
    const draw = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      state.doomFrames++;
      const program = this.getParameter(this.CURRENT_PROGRAM);
      state.lastEffects = [
        ...this.getUniform(program, this.getUniformLocation(program, 'u_effects')!),
      ];
      if (!state.firstCurve) {
        state.firstCurve = [
          ...this.getUniform(program, this.getUniformLocation(program, 'u_curve')!),
        ];
      }
      return draw.apply(this, args);
    };
    new MutationObserver(() => {
      const text = document.querySelector('#doom-game [role="status"]')?.textContent;
      if (text) state.doomProgress.push(text);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
}

try {
  const colorPage = await browser.newPage();
  await colorPage.goto(base);
  const compositorBuild = await Bun.build({
    entrypoints: ['src/doom/compositor.ts'],
    target: 'browser',
  });
  assert.equal(compositorBuild.success, true);
  const pixels = await colorPage.evaluate(
    async (source) => {
      const { createDoomCompositor } = await import(
        URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      );
      const canvas = document.createElement('canvas');
      const compositor = createDoomCompositor(canvas);
      compositor.resize(640, 480);
      const memory = new WebAssembly.Memory({ initial: 1 });
      const samples = [];
      for (const bgra of [
        [0, 0, 255, 255],
        [255, 0, 0, 255],
      ]) {
        new Uint8Array(memory.buffer, 0, 4).set(bgra);
        compositor.draw(memory, 0, 1, 1);
        await new Promise(requestAnimationFrame);
        const gl = canvas.getContext('webgl')!;
        const pixel = new Uint8Array(4);
        gl.readPixels(320, 240, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        samples.push([...pixel]);
      }
      compositor.dispose();
      return samples;
    },
    await compositorBuild.outputs[0].text(),
  );
  assert.deepEqual(
    pixels,
    [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ],
    'BGRA game pixels retain their red and blue channels',
  );
  const effects = await colorPage.evaluate(
    async (source) => {
      const { createDoomCompositor } = await import(
        URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      );
      const canvas = document.createElement('canvas');
      const compositor = createDoomCompositor(canvas, { crt: true, reducedMotion: () => true });
      compositor.resize(640, 480);
      const memory = new WebAssembly.Memory({ initial: 1 });
      new Uint8Array(memory.buffer, 0, 4).set([128, 128, 128, 255]);
      compositor.draw(memory, 0, 1, 1);
      const gl = canvas.getContext('webgl')!;
      const pixel = (x: number, y: number) => {
        const value = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
        return [...value];
      };
      const samples = { corner: pixel(2, 2), clear: pixel(320, 239), scanline: pixel(320, 240) };
      compositor.dispose();
      return samples;
    },
    await compositorBuild.outputs[0].text(),
  );
  assert.deepEqual(effects.corner, [0, 0, 0, 255]);
  assert.ok(
    effects.clear[0] > effects.scanline[0] + 10,
    'CRT scanlines are drawn inside the curved WebGL pass',
  );
  await colorPage.close();
  console.log('PASS Doom BGRA framebuffer colors and CRT effects through the real WebGL shader');

  const pointerless = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await pointerless.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = matchMedia(query);
      if (query === '(pointer: fine)' || query === '(pointer: coarse)')
        Object.defineProperty(result, 'matches', { value: false });
      return result;
    };
  });
  let pointerlessAssets = 0;
  pointerless.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/assets/doom/')) pointerlessAssets++;
  });
  await pointerless.goto(base);
  await ready(pointerless);
  await command(pointerless, './DOOM');
  await pointerless.waitForFunction(
    () => document.querySelector('#exit-status')?.textContent === '[1] ',
    undefined,
    { timeout: 5000 },
  );
  assert.match(
    await pointerless.locator('#transcript').innerText(),
    /DOOM: a computer with a physical keyboard is required/,
  );
  assert.equal(pointerlessAssets, 0);
  assert.equal(await pointerless.locator('#command').isDisabled(), false);
  await pointerless.close();
  console.log('PASS Doom pointerless eligibility rejects before loading assets');

  const cachePage = await browser.newPage();
  await cachePage.goto(base);
  const cached = await cachePage.evaluate(async () => {
    performance.clearResourceTimings();
    const bodies: Uint8Array[] = [];
    for (let i = 0; i < 2; i++) {
      const bytes = new Uint8Array(await (await fetch('/assets/doom/doom.wasm')).arrayBuffer());
      bodies.push(bytes);
    }
    return {
      lengths: bodies.map((body) => body.byteLength),
      identical:
        bodies[0].length === bodies[1].length &&
        bodies[0].every((byte, index) => byte === bodies[1][index]),
      transfers: performance
        .getEntriesByType('resource')
        .filter((entry) => entry.name.endsWith('/doom.wasm'))
        .map((entry) => ({
          transfer: (entry as PerformanceResourceTiming).transferSize,
          body: (entry as PerformanceResourceTiming).encodedBodySize,
        })),
    };
  });
  const artifactLength = Bun.file('vendor/doom/doom.wasm').size;
  assert.deepEqual(
    cached.lengths,
    [artifactLength, artifactLength],
    'both requests return the full WebAssembly body',
  );
  assert.equal(cached.identical, true, 'cached WebAssembly bytes match the first response exactly');
  assert.equal(cached.transfers.length, 2);
  assert.ok(cached.transfers[0].body > 4_000_000);
  assert.ok(
    cached.transfers[1].transfer < 1000,
    'repeat Doom downloads revalidate the cached body',
  );
  await cachePage.close();
  console.log('PASS Doom HTTP cache avoids a second full WebAssembly transfer');

  const page = await browser.newPage({ viewport: { width: 1600, height: 600 } });
  await instrument(page);
  let requests = 0;
  let assets = 0;
  let release!: () => void;
  const download = new Promise<void>((resolve) => (release = resolve));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/assets/doom/')) assets++;
  });
  await page.route('**/assets/doom/doom.wasm', async (route) => {
    requests++;
    await download;
    await route.fulfill({
      body: Buffer.from(fixture),
      contentType: 'application/wasm',
      headers: { 'Content-Length': String(fixture.length) },
    });
  });
  await page.goto(base);
  await ready(page);
  assert.equal(assets, 0, 'startup does not load any Doom assets');
  await command(page, 'mkdir -p /tmp/game; cp ~/DOOM /tmp/game/DOOM; cd /tmp/game');
  await page.waitForFunction(() => document.querySelector('#cwd')?.textContent === '/tmp/game');
  await command(page, './DOOM');
  await page.locator('[data-doom-state="loading"]').waitFor({ timeout: 5000 });
  assert.match(await page.locator('#doom-game').innerText(), /Loading DOOM.*0 B/s);
  assert.equal(await page.locator('#command').isDisabled(), true);
  await page.evaluate(() => {
    (document.querySelector('#command') as HTMLTextAreaElement).value = './DOOM';
    document
      .querySelector('#command-form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    (document.querySelector('#command') as HTMLTextAreaElement).value = '';
  });
  release();
  await page.locator('[data-doom-state="running"]').waitFor();
  assert.equal(requests, 1);
  assert.equal(await page.locator('#doom-game').count(), 1);
  assert.equal(await page.locator('main').isVisible(), false);
  assert.equal(await page.locator('main').evaluate((node) => (node as HTMLElement).inert), true);
  assert.equal(await page.locator('#command').isDisabled(), true);
  assert.equal(
    await page.locator('#doom-game canvas').evaluate((node) => document.activeElement === node),
    true,
  );
  const transcript = await page.locator('#transcript').textContent();
  await geometry(page);
  const curve = await page.evaluate(() => (window as any).firstCurve);
  assert.ok(
    Math.abs(curve[0] - 0.0525) < 0.0001,
    'first frame curvature uses fitted 800x600 boundary',
  );
  assert.ok(Math.abs(curve[1] - 0.07) < 0.0001);
  assert.ok(
    (await page.evaluate(() => (window as any).doomProgress)).some((text: string) =>
      /\d+ B \/ \d+ B/.test(text),
    ),
  );
  assert.equal(
    await page.locator('#doom-game button').count(),
    0,
    'running games have no external close control',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+c');
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#stop')!.click());
  assert.equal(await page.locator('[data-doom-state="running"]').count(), 1);
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.waitForFunction(
    () => document.querySelector('#doom-game')?.getBoundingClientRect().width === 900,
  );
  await geometry(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => (window as any).lastEffects[1] === -96);
  assert.equal(
    await page
      .locator('.crt-screen')
      .evaluate((node) => getComputedStyle(node, '::after').animationName),
    'none',
  );
  await page.evaluate(() => {
    history.pushState({}, '', '#one');
    history.pushState({}, '', '#two');
  });
  await page.goBack();
  assert.equal(await page.locator('[data-doom-state="running"]').count(), 1);
  await page.goForward();
  assert.equal(await page.locator('[data-doom-state="running"]').count(), 1);
  await quit(page);
  const stoppedFrames = await page.evaluate(() => (window as any).doomFrames);
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => (window as any).doomFrames),
    stoppedFrames,
    'quit stops compositor presentation',
  );
  assert.equal(await page.locator('#doom-game').count(), 0);
  assert.equal(await page.locator('html').getAttribute('data-application'), null);
  assert.equal(await page.locator('main').evaluate((node) => (node as HTMLElement).inert), false);
  assert.equal(await page.locator('#transcript').textContent(), transcript);
  assert.equal(await page.locator('#cwd').textContent(), '/tmp/game');
  assert.equal(await page.locator('#exit-status').textContent(), '');
  assert.equal(
    await page.locator('#command').evaluate((node) => document.activeElement === node),
    true,
  );
  await page.locator('#command').press('ArrowUp');
  assert.equal(await page.locator('#command').inputValue(), './DOOM');
  await command(page, 'pwd');
  await page.waitForFunction(
    () =>
      document.querySelector('#transcript .entry:last-child .output')?.textContent ===
      '/tmp/game\n',
  );
  console.log(
    'PASS Doom lazy loading, first-frame geometry, input ownership, history and lifecycle quit',
  );

  const failure = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await instrument(failure);
  let mode: '404' | 'invalid' | 'trap' | 'exit' | 'valid' = '404';
  let attempts = 0;
  await failure.route('**/assets/doom/doom.wasm', (route) => {
    attempts++;
    return route.fulfill({
      status: mode === '404' ? 404 : 200,
      contentType: 'application/wasm',
      body:
        mode === 'valid'
          ? Buffer.from(fixture)
          : mode === 'trap' || mode === 'exit'
            ? Buffer.from(doomBrowserFixture(mode))
            : 'invalid wasm',
    });
  });
  await failure.goto(base);
  await ready(failure);
  await command(failure, './DOOM');
  await failure.locator('[data-doom-state="failed"]').waitFor();
  assert.match(await failure.locator('#doom-game').innerText(), /404/);
  assert.equal(await failure.locator('#command').isDisabled(), true);
  mode = 'invalid';
  await failure.getByRole('button', { name: 'Retry', exact: true }).click();
  await failure.locator('[data-doom-state="failed"]').waitFor();
  assert.equal(attempts, 2);
  mode = 'trap';
  await failure.getByRole('button', { name: 'Retry', exact: true }).click();
  await failure.locator('[data-doom-state="failed"]').waitFor();
  assert.match(await failure.locator('#doom-game').innerText(), /unreachable/);
  mode = 'valid';
  await failure.getByRole('button', { name: 'Retry', exact: true }).click();
  await failure.locator('[data-doom-state="running"]').waitFor();
  assert.equal(attempts, 4);
  await quit(failure, 1);
  assert.equal(await failure.locator('#exit-status').textContent(), '[1] ');
  await command(failure, './DOOM');
  await failure.locator('[data-doom-state="running"]').waitFor();
  await failure.evaluate(() => {
    const canvas = document.querySelector('#doom-game canvas')!;
    const createShader = WebGLRenderingContext.prototype.createShader;
    WebGLRenderingContext.prototype.createShader = () => null;
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    WebGLRenderingContext.prototype.createShader = createShader;
  });
  await ready(failure);
  assert.equal(await failure.locator('#doom-game').count(), 0);
  assert.equal(await failure.locator('#exit-status').textContent(), '[1] ');
  const ticks = await failure.evaluate(() => (window as any).doomTicks);
  await failure.waitForTimeout(100);
  assert.equal(
    await failure.evaluate(() => (window as any).doomTicks),
    ticks,
    'fatal compositor failure stops the runtime',
  );
  await command(failure, './DOOM');
  await failure.locator('[data-doom-state="running"]').waitFor();
  await failure.clock.install();
  await failure.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#doom-game canvas')!;
    const lost = new Promise<void>((resolve) =>
      canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }),
    );
    canvas.getContext('webgl')!.getExtension('WEBGL_lose_context')!.loseContext();
    await lost;
  });
  assert.equal(await failure.locator('[data-doom-state="running"]').count(), 1);
  await failure.clock.fastForward(6000);
  assert.equal(
    await failure.locator('#doom-game').count(),
    0,
    'unrestored context loss returns to the terminal within a bounded recovery period',
  );
  assert.equal(await failure.locator('#command').isDisabled(), false);
  assert.equal(await failure.locator('#exit-status').textContent(), '[1] ');
  const stoppedTicks = await failure.evaluate(() => (window as any).doomTicks);
  await failure.clock.fastForward(6000);
  assert.equal(
    await failure.evaluate(() => (window as any).doomTicks),
    stoppedTicks,
    'context recovery expiry stops Doom ticking',
  );
  await failure.clock.resume();
  mode = '404';
  await command(failure, './DOOM');
  await failure.locator('[data-doom-state="failed"]').waitFor();
  await failure.getByRole('button', { name: 'Return to terminal', exact: true }).click();
  await ready(failure);
  assert.equal(await failure.locator('#exit-status').textContent(), '[1] ');
  mode = 'exit';
  await command(failure, './DOOM');
  await failure.waitForFunction(
    () => document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await failure.locator('#doom-game').count(),
    0,
    'an exit during init cannot revive a completed game',
  );
  assert.equal(await failure.locator('#exit-status').textContent(), '');
  console.log(
    'PASS Doom download/start failures, retries, nonzero exit and compositor failure recovery',
  );

  const missingEntry = await browser.newPage();
  let prematureWasm = 0;
  missingEntry.on('request', (request) => {
    if (request.url().endsWith('/doom.wasm')) prematureWasm++;
  });
  await missingEntry.route('**/assets/doom/app.js', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await missingEntry.goto(base);
  await ready(missingEntry);
  await command(missingEntry, './DOOM');
  await missingEntry.locator('#transcript .entry:last-child .error').waitFor();
  assert.equal(await missingEntry.locator('#command').isDisabled(), false);
  assert.equal(await missingEntry.locator('#exit-status').textContent(), '[1] ');
  assert.equal(prematureWasm, 0);
  console.log('PASS Doom entry download failure and synchronous initialization exit');

  const response = await fetch(`${base}/assets/doom/doom.wasm`, { method: 'HEAD' });
  assert.equal(response.headers.get('content-type'), 'application/wasm');
} finally {
  await browser.close();
}
