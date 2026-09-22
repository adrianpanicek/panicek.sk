import { firefox } from 'playwright';
import { strict as assert } from 'node:assert';

const browser = await firefox.launch();
const base = process.env.TEST_URL || 'http://127.0.0.1:4321';
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(
    () => document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.locator('.crt-viewport').evaluate((node) => getComputedStyle(node).filter),
    'none',
    'Firefox must not filter the full viewport on every scroll or caret blink',
  );
  assert.equal(await page.locator('.crt-screen').isVisible(), true);
  assert.equal(
    await page
      .locator('.crt-screen')
      .evaluate((node) => getComputedStyle(node, '::after').animationName),
    'none',
    'the Firefox CRT overlay must stay idle',
  );
  await page.mouse.move(640, 450);
  assert.notEqual(
    await page.locator('main').evaluate((node) => getComputedStyle(node).cursor),
    'none',
  );
  assert.equal(await page.locator('.crt-pointer').isVisible(), false);
  await page.locator('#command').fill('seq 1 100');
  await page.locator('#command').press('Enter');
  await page.waitForFunction(() =>
    document.querySelector('#transcript .entry:last-child .output')?.textContent?.endsWith('100\n'),
  );
  await page.evaluate(() => window.scrollTo(0, 200));
  assert.equal(await page.evaluate(() => window.scrollY), 200);
  const toggle = page.getByRole('button', { name: 'CRT effect' });
  // Programmatic clicks preserve the scroll position being tested.
  await toggle.evaluate((node) => (node as HTMLButtonElement).click());
  assert.equal(await page.locator('html').getAttribute('data-crt'), 'off');
  assert.ok(
    await page.evaluate(() => window.scrollY > 0),
    'turning CRT off must not jump to the top',
  );
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
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
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(
    'PASS Firefox lightweight CRT, scrolling, toggle persistence, native cursor, and shell',
  );
} finally {
  await browser.close();
}
