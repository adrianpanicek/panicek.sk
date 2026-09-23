import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://127.0.0.1:4321';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
await mkdir('.artifacts', { recursive: true });
try {
  const startup = await browser.newPage();
  await startup.route('**/assets/client.js', (route) => route.abort());
  await startup.goto(base);
  assert.equal(await startup.locator('html').getAttribute('data-crt-curved'), 'ready');
  assert.match(
    await startup.locator('.crt-viewport').evaluate((node) => getComputedStyle(node).filter),
    /crt-curve/,
  );
  assert.equal(await startup.locator('#crt-curve').count(), 1);
  assert.equal(await startup.locator('body > .crt-filter #crt-curve').count(), 1);
  await startup.evaluate(() => localStorage.setItem('portfolio:crt', 'off'));
  await startup.reload();
  assert.equal(await startup.locator('html').getAttribute('data-crt'), 'off');
  await startup.close();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  let releaseImage!: () => void;
  const imageReady = new Promise<void>((resolve) => (releaseImage = resolve));
  await page.route('**/portrait.png', async (route) => {
    await imageReady;
    await route.continue();
  });
  await page.goto(base);
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLTextAreaElement>('#command')?.disabled &&
      document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
  );
  const toggle = page.getByRole('button', { name: 'CRT effect' });
  await page.evaluate(() => document.fonts.ready);
  const portrait = page.locator('.markdown img').first();
  const reserved = await portrait.boundingBox();
  assert.ok(reserved && reserved.height > 200);
  releaseImage();
  await portrait.evaluate((node) => (node as HTMLImageElement).decode());
  assert.deepEqual(await portrait.boundingBox(), reserved);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(
    await page.locator('.crt-screen').evaluate((node) => getComputedStyle(node).pointerEvents),
    'none',
  );
  await page.screenshot({ path: '.artifacts/crt-on.png', fullPage: true });
  assert.equal(
    await page.locator('.crt-refresh-overlay').isVisible(),
    false,
    'Chromium must not show a second refresh band',
  );
  const screen = page.locator('.crt-screen');
  const screenBefore = await screen.boundingBox();
  const contentBefore = await page.locator('#transcript').boundingBox();
  await page.locator('main').evaluate((node) => (node.scrollTop = 300));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.deepEqual(await screen.boundingBox(), screenBefore);
  assert.ok((await page.locator('#transcript').boundingBox())!.y < contentBefore!.y);
  assert.equal(
    await screen.evaluate((node) => getComputedStyle(node, '::before').animationName),
    'none',
  );
  assert.equal(
    await screen.evaluate((node) => getComputedStyle(node, '::after').animationName),
    'crt-refresh',
  );
  assert.ok(
    await screen.evaluate((node) => {
      const animation = node
        .getAnimations({ subtree: true })
        .find((item) => (item as CSSAnimation).animationName === 'crt-refresh')!;
      animation.pause();
      animation.currentTime = 2000;
      const first = new DOMMatrix(getComputedStyle(node, '::after').transform).m42;
      animation.currentTime = 4000;
      const second = new DOMMatrix(getComputedStyle(node, '::after').transform).m42;
      animation.play();
      return second > first;
    }),
    'refresh band travels downward',
  );
  await page.locator('main').evaluate((node) => (node.scrollTop = 0));
  await toggle.click();
  assert.equal(await page.locator('html').getAttribute('data-crt'), 'off');
  assert.equal(
    await page
      .locator('.markdown')
      .first()
      .evaluate((node) => getComputedStyle(node).filter),
    'none',
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLTextAreaElement>('#command')?.disabled &&
      document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
  );
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await page.screenshot({ path: '.artifacts/crt-off.png', fullPage: true });
  await toggle.click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page
      .locator('.crt-screen')
      .evaluate((node) => getComputedStyle(node, '::after').animationName),
    'none',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('#command').fill('echo crt-ready');
  await page.locator('#command').press('Enter');
  await page.waitForFunction(
    () =>
      document.querySelector('#transcript .entry:last-child .output')?.textContent ===
      'crt-ready\n',
  );
  await page.screenshot({ path: '.artifacts/crt-mobile.png', fullPage: true });
  const input = page.locator('#command');
  for (const field of [input, page.locator('#command-form')]) {
    assert.equal(await field.getAttribute('autocapitalize'), 'none');
    assert.equal(await field.getAttribute('autocorrect'), 'off');
    assert.equal(await field.getAttribute('spellcheck'), 'false');
  }
  await input.fill('echo ABOUT.md');
  assert.equal(await input.inputValue(), 'echo ABOUT.md');
  await input.fill('sleep 1');
  await input.evaluate((node) => {
    node.dataset.blurCount = '0';
    node.addEventListener('blur', () => {
      node.dataset.blurCount = String(Number(node.dataset.blurCount) + 1);
    });
  });
  await input.press('Enter');
  await page.waitForFunction(
    () => document.querySelector('#command-form')?.getAttribute('aria-busy') === 'true',
  );
  assert.equal(await input.isDisabled(), false);
  assert.equal(await input.evaluate((node) => (node as HTMLTextAreaElement).readOnly), false);
  await input.pressSequentially('echo next');
  await page.waitForFunction(
    () => document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
  );
  assert.equal(await input.inputValue(), 'echo next');
  assert.equal(await input.getAttribute('data-blur-count'), '0');
  assert.equal(await input.evaluate((node) => document.activeElement === node), true);
  console.log(
    'PASS CRT toggle, persistence, pointer transparency, reduced motion, and mobile input',
  );
  const mousePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await mousePage.goto(base);
  await mousePage.locator('.crt-pointer').waitFor({ state: 'attached' });
  await mousePage.mouse.move(640, 450);
  await mousePage.waitForFunction(
    () =>
      document.documentElement.dataset.crtPointer === 'visible' &&
      document.querySelector<HTMLElement>('.crt-pointer')?.style.transform ===
        'translate(640px, 450px)',
  );
  const pointer = mousePage.locator('.crt-pointer');
  assert.equal(await pointer.evaluate((node) => getComputedStyle(node).pointerEvents), 'none');
  assert.equal(
    await mousePage.locator('main').evaluate((node) => getComputedStyle(node).cursor),
    'none',
  );
  assert.equal(await pointer.evaluate((node) => node.parentElement?.className), 'crt-viewport');
  assert.equal(
    await pointer.evaluate((node) => getComputedStyle(node).transform),
    'matrix(1, 0, 0, 1, 640, 450)',
  );
  await mousePage.screenshot({ path: '.artifacts/crt-pointer.png' });
  await mousePage.locator('main').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await mousePage.mouse.move(1000, 850);
  await mousePage.waitForFunction(
    () =>
      document.querySelector<HTMLElement>('.crt-pointer')?.style.transform ===
      'translate(1000px, 850px)',
  );
  assert.equal(
    await pointer.evaluate((node) => getComputedStyle(node).transform),
    'matrix(1, 0, 0, 1, 1000, 850)',
    'pointer and hit targets must enter the same distortion at the same coordinates',
  );
  await mousePage.getByRole('button', { name: 'CRT effect' }).click();
  assert.equal(await pointer.isVisible(), false);
  assert.notEqual(
    await mousePage.locator('main').evaluate((node) => getComputedStyle(node).cursor),
    'none',
  );
  await mousePage.getByRole('button', { name: 'CRT effect' }).click();
  await mousePage.mouse.move(600, 400);
  await mousePage.waitForFunction(() => document.documentElement.dataset.crtPointer === 'visible');
  await mousePage.evaluate(() =>
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' })),
  );
  assert.equal(await pointer.isVisible(), false);
  await mousePage.mouse.move(620, 410);
  await mousePage.waitForFunction(() => document.documentElement.dataset.crtPointer === 'visible');
  await mousePage.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await pointer.isVisible(), false);
  console.log('PASS CRT mouse pointer, native-cursor restoration, touch and blur handling');
} finally {
  await browser.close();
}
