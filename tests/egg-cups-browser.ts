import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { staticHandler } from '../scripts/static-handler';

const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: staticHandler('dist') });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const route of [
    '/blog/computers-are-just-egg-cups/',
    '/home/web/blog/computers-are-just-egg-cups/',
  ]) {
    await page.goto(new URL(route, server.url).href);
    await page.waitForFunction(
      () => document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
    );
    const calculator = page.locator('[data-egg-cups]').first();
    const cups = calculator.getByRole('button');
    const result = calculator.locator('output');
    assert.equal(await cups.count(), 4);
    assert.equal(await result.textContent(), '5');
    // Exercise every value; this catches reversed bit weights and incorrect toggles.
    for (let value = 0; value < 16; value++) {
      const bits = value.toString(2).padStart(4, '0');
      for (let i = 0; i < 4; i++) {
        if (((await cups.nth(i).getAttribute('aria-pressed')) === 'true') !== (bits[i] === '1'))
          await cups.nth(i).click();
      }
      assert.equal(await result.textContent(), String(value));
    }
    await cups.nth(0).focus();
    await page.keyboard.press('Space');
    assert.equal(await result.textContent(), '7');
    await page.keyboard.press('Enter');
    assert.equal(await result.textContent(), '15');
    assert.match(
      await cups
        .first()
        .locator('span')
        .evaluate((element) => getComputedStyle(element).backgroundImage),
      /egg-cup-full\.svg/,
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#animations-toggle').evaluate((button) => {
      if (button.getAttribute('aria-pressed') !== 'true') (button as HTMLButtonElement).click();
    });
    assert.match(
      await cups
        .first()
        .locator('span')
        .evaluate((element) => getComputedStyle(element).backgroundImage),
      /egg-cup-full\.gif/,
    );
    await page.locator('#animations-toggle').click();
    assert.match(
      await cups
        .first()
        .locator('span')
        .evaluate((element) => getComputedStyle(element).backgroundImage),
      /egg-cup-full\.svg/,
    );
    // A second article rendered by the shell must get its own working calculator.
    await page.locator('#command').fill('cat ~/blog/computers-are-just-egg-cups/INDEX.md | render');
    await page.locator('#command').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-egg-cups]').length === 2);
    const second = page.locator('[data-egg-cups]').last();
    await second.getByRole('button').first().click();
    assert.equal(await second.locator('output').textContent(), '13');
    assert.equal(await result.textContent(), '15');
    await page.setViewportSize({ width: 375, height: 812 });
    const bounds = await second.boundingBox();
    assert.ok(
      bounds &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.x >= 0 &&
        bounds.x + bounds.width <= 375,
      `calculator must have a visible box within the mobile viewport: ${JSON.stringify(bounds)}`,
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await second.screenshot({ path: '/tmp/egg-cups-calculator.png' });
  }
  for (const name of ['empty', 'full']) {
    const response = await context.request.get(
      new URL(`/home/web/blog/computers-are-just-egg-cups/egg-cup-${name}.gif`, server.url).href,
    );
    assert.equal(response.status(), 200);
    assert.equal((await response.body()).subarray(0, 6).toString(), 'GIF89a');
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS all 16 values, keyboard controls, independent dynamic instances, both routes, motion settings, mobile layout, and GIF delivery',
  );
  await context.close();
} finally {
  await browser.close();
  await server.stop(true);
}
