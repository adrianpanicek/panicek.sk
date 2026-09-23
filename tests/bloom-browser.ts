import { chromium, firefox } from 'playwright';
import { strict as assert } from 'node:assert';

for (const engine of [chromium, firefox]) {
  const browser = await engine.launch(
    engine === chromium
      ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
      : {},
  );
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const idle = () =>
      page.waitForFunction(
        () =>
          document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false' &&
          !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
      );
    await page.route('**/api/visit', (route) => route.fulfill({ json: { visitors: 42 } }));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4321');
    const toggle = page.locator('#bloom-toggle');
    await toggle.waitFor();
    await idle();
    await page.locator('#visitor-count').waitFor();
    const home = page.getByRole('link', { name: 'home', exact: true });
    assert.equal(await home.getAttribute('href'), 'https://panicek.sk/');
    const controls = page.locator('.footer-controls');
    const homeBox = (await home.boundingBox())!;
    const controlBox = (await controls.boundingBox())!;
    const footerBox = (await page.locator('footer').boundingBox())!;
    assert.ok(homeBox.x < controlBox.x);
    assert.ok(Math.abs(controlBox.x + controlBox.width - footerBox.x - footerBox.width) < 2);
    for (const id of ['visitor-count', 'crt-toggle', 'bloom-toggle', 'animations-toggle'])
      assert.ok(
        (
          await page
            .locator('#' + id)
            .evaluate((node) => getComputedStyle(node, '::before').content)
        ).includes('|'),
      );
    assert.deepEqual(
      await page.locator('footer button').evaluateAll((nodes) => nodes.map((n) => n.id)),
      ['reset-filesystem', 'crt-toggle', 'bloom-toggle', 'animations-toggle'],
    );
    assert.equal(await page.locator('footer #status, footer #stop').count(), 0);
    assert.equal(await toggle.textContent(), `bloom: ${engine === firefox ? 'off' : 'on'}`);
    for (const enabled of [true, false, true, false]) {
      if ((await toggle.getAttribute('aria-pressed')) !== String(enabled)) await toggle.click();
      assert.equal(await page.locator('#crt-curve feGaussianBlur').count(), enabled ? 1 : 0);
      assert.equal(await page.locator('#crt-curve feComposite').count(), enabled ? 1 : 0);
      assert.equal(await page.locator('#crt-curve feDisplacementMap').count(), 1);
      assert.equal(
        await page
          .locator('#transcript')
          .evaluate((n) => getComputedStyle(n).textShadow === 'none'),
        enabled,
      );
      const copy = page.locator('.crt-image-bloom').first();
      const portrait = page.locator('.markdown img').first();
      await portrait.scrollIntoViewIfNeeded();
      await portrait.evaluate((n) => (n as HTMLImageElement).decode());
      assert.equal(await copy.isVisible(), !enabled);
      await page.reload();
      await toggle.waitFor();
      await idle();
      assert.equal(await toggle.getAttribute('aria-pressed'), String(enabled));
    }
    await page.locator('#crt-toggle').click();
    assert.equal(await page.locator('.crt-image-bloom').first().isVisible(), false);
    assert.equal(
      await page.locator('.crt-viewport').evaluate((n) => getComputedStyle(n).filter),
      'none',
    );
    await page.reload();
    await toggle.waitFor();
    await idle();
    assert.equal(await page.locator('html').getAttribute('data-crt'), 'off');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    const reopened = await page.context().newPage();
    await reopened.goto(process.env.TEST_URL || 'http://127.0.0.1:4321');
    await reopened.locator('#bloom-toggle').waitFor();
    assert.equal(await reopened.locator('html').getAttribute('data-crt'), 'off');
    assert.equal(await reopened.locator('html').getAttribute('data-bloom'), 'off');
    await reopened.close();
    // The saved mode also applies before the main client bundle executes.
    await page.evaluate(() =>
      localStorage.setItem('portfolio:config', JSON.stringify({ crt: false, bloom: true })),
    );
    await page.route('**/assets/client.js', (route) => route.abort());
    await page.reload();
    assert.equal(await page.locator('#crt-curve feGaussianBlur').count(), 1);
    console.log(
      `PASS ${engine.name()} footer and bloom comparison, persistence, CRT off and early boot`,
    );
  } finally {
    await browser.close();
  }
}
