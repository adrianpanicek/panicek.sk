import { firefox } from 'playwright';
import { strict as assert } from 'node:assert';

const browser = await firefox.launch();
const base = process.env.TEST_URL || 'http://127.0.0.1:4321';
try {
  // Check rendered pixels, not just filter declarations: a straight source line
  // must visibly bend even before the client bundle loads.
  const visual = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await visual.route('**/assets/client.js', (route) => route.abort());
  await visual.goto(base);
  await visual.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.crt-viewport')!;
    viewport.style.background = '#000';
    const line = document.createElement('div');
    line.style.cssText = 'position:absolute;top:60px;left:0;width:100%;height:8px;background:#fff';
    viewport.replaceChildren(line);
  });
  const screenshot = await visual.screenshot();
  const edges = await visual.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const top = (x: number) => {
      const pixels = context.getImageData(x, 0, 1, 120).data;
      for (let y = 0; y < 120; y++) if (pixels[y * 4] > 200) return y;
      return -1;
    };
    return { left: top(64), middle: top(640), right: top(1216) };
  }, screenshot.toString('base64'));
  assert.ok(
    edges.middle >= 60 && edges.left > edges.middle + 5 && edges.right > edges.middle + 5,
    `Firefox must render a curved line: ${JSON.stringify(edges)}`,
  );
  await visual.close();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let releaseStartup!: () => void;
  const startupGate = new Promise<void>((resolve) => {
    releaseStartup = resolve;
  });
  await page.route('**/filesystem.json', async (route) => {
    await startupGate;
    await route.continue();
  });
  await page.goto(base);
  await page.locator('#command-form').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#command').isDisabled(), true);
  assert.equal(
    await page.locator('#command-form').getAttribute('aria-busy'),
    'true',
    'loading shell must not report idle',
  );
  releaseStartup();
  await page.waitForFunction(
    () =>
      document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false' &&
      !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
  );
  const portrait = page.locator('.markdown img').first();
  await portrait.scrollIntoViewIfNeeded();
  await portrait.evaluate((node) => (node as HTMLImageElement).decode());
  const imageBloom = page.locator('.crt-image-bloom').first();
  assert.ok(await imageBloom.count(), 'Firefox images need a colored bloom copy');
  await imageBloom.waitFor({ state: 'visible' });
  assert.equal(await portrait.evaluate((node) => getComputedStyle(node).filter), 'none');
  assert.equal(await imageBloom.getAttribute('aria-hidden'), 'true');
  assert.equal(await imageBloom.evaluate((node) => getComputedStyle(node).pointerEvents), 'none');
  assert.ok(
    await imageBloom.evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const style = getComputedStyle(canvas);
      return (
        canvas.width <= 256 &&
        canvas.height <= 256 &&
        style.filter === 'blur(5px)' &&
        style.maskImage !== 'none' &&
        new DOMMatrix(style.transform).a > 1
      );
    }),
    'bloom uses a small blurred, enlarged copy with faded edges',
  );
  const frame = portrait.locator('..');
  assert.equal(await frame.locator('img').count(), 1, 'keep a single semantic image');
  assert.equal(await frame.evaluate((node) => getComputedStyle(node).float), 'right');
  assert.match(
    await page.locator('.crt-viewport').evaluate((node) => getComputedStyle(node).filter),
    /crt-curve/,
    'Firefox must retain actual viewport distortion',
  );
  assert.equal(await page.locator('#crt-curve feDisplacementMap').count(), 1);
  assert.equal(
    await page.locator('#crt-curve feGaussianBlur, #crt-curve feComposite').count(),
    0,
    'Firefox must omit the expensive bloom pipeline',
  );
  assert.equal(await page.locator('.crt-screen').isVisible(), true);
  assert.equal(
    await page
      .locator('.crt-screen')
      .evaluate((node) => getComputedStyle(node, '::after').animationName),
    'none',
    'the Firefox CRT overlay must stay idle',
  );
  const refresh = page.locator('.crt-refresh-overlay');
  assert.equal(await refresh.count(), 1, 'Firefox must have a separate refresh overlay');
  assert.equal(await refresh.isVisible(), true);
  assert.equal(await refresh.evaluate((node) => getComputedStyle(node).pointerEvents), 'none');
  assert.equal(
    await refresh.evaluate((node) => {
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (getComputedStyle(parent).filter !== 'none') return false;
      }
      return !node.closest('.crt-viewport');
    }),
    true,
    'refresh animation must not invalidate the distorted viewport',
  );
  assert.ok(
    await refresh.evaluate((node) => {
      const animation = node
        .getAnimations({ subtree: true })
        .find((item) => (item as CSSAnimation).animationName === 'crt-refresh')!;
      if (!animation) return false;
      animation.pause();
      animation.currentTime = 2000;
      const first = new DOMMatrix(getComputedStyle(node, '::after').transform).m42;
      animation.currentTime = 4000;
      const second = new DOMMatrix(getComputedStyle(node, '::after').transform).m42;
      animation.play();
      return second > first;
    }),
    'independent refresh band travels downward',
  );
  const refreshBounds = await refresh.boundingBox();
  await page.mouse.move(640, 450);
  await page.waitForFunction(() => document.documentElement.dataset.crtPointer === 'visible');
  assert.equal(
    await page.locator('main').evaluate((node) => getComputedStyle(node).cursor),
    'none',
  );
  assert.equal(await page.locator('.crt-pointer').isVisible(), true);
  await page.locator('#command').fill('seq 1 100');
  await page.locator('#command').press('Enter');
  await page.waitForFunction(() =>
    document.querySelector('#transcript .entry:last-child .output')?.textContent?.endsWith('100\n'),
  );
  await page.locator('main').evaluate((node) => (node.scrollTop = 200));
  assert.equal(await page.locator('main').evaluate((node) => node.scrollTop), 200);
  assert.deepEqual(await refresh.boundingBox(), refreshBounds);
  const toggle = page.getByRole('button', { name: 'CRT effect' });
  // Programmatic clicks preserve the scroll position being tested.
  await toggle.evaluate((node) => (node as HTMLButtonElement).click());
  assert.equal(await page.locator('html').getAttribute('data-crt'), 'off');
  assert.equal(await refresh.isVisible(), false);
  assert.equal(await imageBloom.isVisible(), false);
  assert.equal(await page.locator('.crt-pointer').isVisible(), false);
  assert.ok(
    await page.evaluate(() => window.scrollY > 0),
    'turning CRT off must not jump to the top',
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false' &&
      !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
  );
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await toggle.evaluate((node) => (node as HTMLButtonElement).click());
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await page.locator('#command').fill('echo firefox-ready');
  await page.locator('#command').press('Enter');
  await page.waitForFunction(
    () =>
      document.querySelector('#transcript .entry:last-child .output')?.textContent ===
      'firefox-ready\n',
  );
  let imageRequests = 0;
  await page.route('**/bloom-fixture.svg', (route) => {
    imageRequests++;
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><path fill="red" d="M0 0h16v16H0z"/><path fill="blue" d="M16 0h16v16H16z"/></svg>',
    });
  });
  await page
    .locator('#command')
    .fill(`echo '![Bloom fixture](/home/web/bloom-fixture.svg "width=80 align=left")' | render`);
  await page.locator('#command').press('Enter');
  const addedImage = page.getByAltText('Bloom fixture');
  await addedImage.scrollIntoViewIfNeeded();
  await addedImage.evaluate((node) => (node as HTMLImageElement).decode());
  const addedBloom = addedImage.locator('..').locator('canvas[data-ready="true"]');
  await addedBloom.waitFor({ state: 'visible' });
  assert.deepEqual(
    await addedBloom.evaluate((node) => {
      const context = (node as HTMLCanvasElement).getContext('2d')!;
      return [
        [...context.getImageData(8, 8, 1, 1).data],
        [...context.getImageData(24, 8, 1, 1).data],
      ];
    }),
    [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ],
    'the glow carries the actual picture colors',
  );
  assert.equal(imageRequests, 1, 'the bloom must not fetch the image again');
  assert.equal(
    await addedImage.locator('..').evaluate((node) => getComputedStyle(node).float),
    'left',
  );
  assert.equal((await addedImage.boundingBox())?.width, 80);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page
      .locator('.crt-image')
      .first()
      .evaluate((node) => getComputedStyle(node).float),
    'none',
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await refresh.isVisible(), false);
  assert.equal(await refresh.evaluate((node) => node.getAnimations({ subtree: true }).length), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await refresh.isVisible(), true);
  await page.evaluate(() => (document.documentElement.dataset.application = 'doom'));
  assert.equal(await refresh.isVisible(), false, 'DOOM supplies its own shader refresh band');
  await page.evaluate(() => delete document.documentElement.dataset.application);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await refresh.isVisible(), false);
  assert.equal(await page.locator('.crt-image-bloom').first().isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS Firefox distortion without bloom, scrolling, toggle persistence, curved pointer, independent refresh overlay, and shell',
  );
} finally {
  await browser.close();
}
