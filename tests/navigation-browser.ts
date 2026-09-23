import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';

const base = process.env.TEST_URL || 'http://127.0.0.1:4321';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
try {
  for (const [crt, width] of [
    [false, 1000],
    [true, 1000],
    [false, 390],
    [true, 390],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height: 700 } });
    await context.addInitScript((on) => {
      localStorage.setItem('portfolio:config', JSON.stringify({ crt: on, bloom: false }));
    }, crt);
    const page = await context.newPage();
    await page.route('**/filesystem.json', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    await page.goto(base + '/blog/');
    assert.equal(await page.locator('#transcript').isVisible(), false);
    await page.waitForFunction(() => {
      const value = document.querySelector<HTMLTextAreaElement>('#command')?.value;
      return value && value.length > 0;
    });
    assert.equal(await page.locator('#transcript article').count(), 0);
    const idle = () =>
      page.waitForFunction(
        () =>
          document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false' &&
          !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
      );
    await idle();
    assert.equal(await page.locator('#cwd').textContent(), '~/blog');
    assert.equal(
      await page.evaluate(() => window.scrollY + document.querySelector('main')!.scrollTop),
      0,
    );
    // Toggle explicitly so this test also exercises both scroll containers.
    const toggle = page.locator('#crt-toggle');
    if ((await toggle.getAttribute('aria-pressed')) !== String(crt)) await toggle.click();
    const url = page.url();
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const post = page.locator('a[data-file$="test-article/INDEX.md"]').first();
    assert.equal(await post.getAttribute('href'), base + '/blog/test-article/');
    await post.click();
    const settledPositions = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650));
      const samples: number[] = [];
      const deadline = performance.now() + 1800;
      while (performance.now() < deadline) {
        samples.push(window.scrollY + document.querySelector('main')!.scrollTop);
        await new Promise(requestAnimationFrame);
      }
      return samples;
    });
    assert.ok(
      Math.max(...settledPositions) - Math.min(...settledPositions) < 3,
      `scroll must remain settled while command finishes (crt=${crt}, width=${width}): ${Math.min(...settledPositions)}..${Math.max(...settledPositions)}`,
    );
    await idle();
    assert.equal(page.url(), base + '/blog/test-article/');
    assert.equal(await page.locator('#cwd').textContent(), '~/blog');
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
    assert.equal(await page.locator('#transcript article').count(), 2);
    assert.match(
      (await page.locator('#transcript .entry').last().textContent())!,
      /cat .*INDEX.md.*render/,
    );
    await page.waitForFunction(() => {
      const entries = document.querySelectorAll('#transcript .entry');
      const top = entries[entries.length - 1]!.getBoundingClientRect().top;
      return top >= -2 && top < 80;
    });
    const gap = await page.evaluate(() => {
      const entries = document.querySelectorAll('#transcript .entry');
      return (
        document.querySelector('#command-form')!.getBoundingClientRect().top -
        entries[entries.length - 1]!.getBoundingClientRect().bottom
      );
    });
    assert.ok(gap >= 0 && gap < 40, `next prompt should follow output, got gap ${gap}`);
    const layout = await page.evaluate(() => ({
      footer: document.querySelector('footer')!.getBoundingClientRect().bottom,
      prompt: document.querySelector('#command-form')!.getBoundingClientRect().bottom,
      height: innerHeight,
    }));
    if (layout.prompt < layout.height - 120) {
      assert.ok(
        layout.footer <= layout.height && layout.footer > layout.height - 85,
        `footer should remain at screen bottom: ${JSON.stringify(layout)}`,
      );
    }
    const top = await page
      .locator('#transcript .entry')
      .last()
      .evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(top >= -2 && top < 80, `command should stay at top, got ${top} (crt=${crt})`);
    await page.goBack();
    assert.equal(page.url(), url);
    await page.goForward();
    assert.equal(page.url(), base + '/blog/test-article/');
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
    assert.equal(await page.locator('#transcript article').count(), 2);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector('main')!.scrollTop = 0;
    });
    assert.equal(await page.locator('#transcript article').count(), 2, 'scrollback retained');
    await post.click();
    await page.waitForTimeout(100);
    await page.mouse.wheel(0, -10000);
    await page.waitForTimeout(150);
    const manualPosition = await page.evaluate(
      () => window.scrollY + document.querySelector('main')!.scrollTop,
    );
    await idle();
    await page.waitForTimeout(500);
    const cancelledPosition = await page.evaluate(
      () => window.scrollY + document.querySelector('main')!.scrollTop,
    );
    assert.ok(
      Math.abs(cancelledPosition - manualPosition) < 5,
      `manual scroll should cancel auto-scroll, got ${manualPosition} → ${cancelledPosition} (crt=${crt}, width=${width})`,
    );
    // The homepage runs two startup commands; neither should move the viewport.
    await page.goto(base + '/');
    await page.evaluate(() => {
      (window as any).startupScroll = 0;
      const track = () => {
        (window as any).startupScroll = Math.max(
          (window as any).startupScroll,
          window.scrollY,
          document.querySelector('main')!.scrollTop,
        );
      };
      document.addEventListener('scroll', track, true);
    });
    await idle();
    assert.equal(
      await page.evaluate(() => (window as any).startupScroll),
      0,
      `startup should not scroll (crt=${crt}, width=${width})`,
    );
    assert.equal(await page.locator('#transcript article').count(), 2);
    await context.close();
  }
  const settings = await browser.newPage();
  await settings.goto(base + '/blog/');
  await settings.waitForFunction(
    () =>
      document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false' &&
      !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
  );
  const animationToggle = settings.getByRole('button', { name: 'Animations', exact: true });
  await animationToggle.click();
  assert.equal(await animationToggle.getAttribute('aria-pressed'), 'false');
  await settings.reload();
  await settings.waitForFunction(
    () =>
      document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false' &&
      !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
  );
  assert.equal(await animationToggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await settings.locator('html').getAttribute('data-animations'), 'off');
  const started = Date.now();
  await settings.locator('a[data-file$="test-article/INDEX.md"]').first().click();
  await settings.waitForFunction(
    () => document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
  );
  assert.ok(Date.now() - started < 1200, 'disabled animations skip the typing delay');
  assert.equal(new URL(settings.url()).pathname, '/blog/test-article/');
  const shellInput = settings.getByRole('textbox', { name: 'Shell command' });
  await shellInput.fill('pwd');
  await shellInput.press('Enter');
  await settings.waitForFunction(
    () => document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    (await settings.locator('#transcript .entry').last().locator('.output').textContent())!.trim(),
    '/home/web/blog',
  );
  await animationToggle.click();
  assert.equal(await animationToggle.getAttribute('aria-pressed'), 'true');
  await settings.close();
  const context = await browser.newContext({ javaScriptEnabled: false });
  for (const path of ['/blog/', '/blog/test-article/', '/home/web/blog/test-article/']) {
    const page = await context.newPage();
    await page.goto(base + path);
    assert.equal(await page.locator('article').count(), 1);
    assert.equal(await page.locator('article').isVisible(), true);
    await page.close();
  }
  await context.close();
  const fallback = await browser.newPage();
  await fallback.route('**/assets/shell.worker.js', (route) => route.abort());
  await fallback.goto(base + '/blog/');
  await fallback.locator('#transcript article').waitFor({ state: 'visible' });
  assert.equal(await fallback.locator('#transcript article').count(), 1);
  console.log(
    'Animated startup, full links, history navigation, saved animations setting, top alignment, scrollback and static fallback passed',
  );
} finally {
  await browser.close();
}
