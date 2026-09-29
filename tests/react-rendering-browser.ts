import {chromium} from 'playwright';
import {strict as assert} from 'node:assert';
import {staticHandler} from '../scripts/static-handler';

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: staticHandler('dist'),
});
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
try {
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (
      message.type() === 'error' &&
      /React|hydration|matching|update.*component/i.test(message.text())
    ) {
      errors.push(message.text());
    }
  });
  const idle = () =>
    page.waitForFunction(
      () =>
        document.querySelector('#command-form')?.getAttribute('aria-busy') ===
          'false' &&
        !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
    );
  for (const route of ['/', '/blog/', '/blog/computers-are-just-egg-cups/']) {
    await page.goto(new URL(route, server.url).href);
    await idle();
    assert.equal(await page.locator('#app').count(), 1);
    assert.equal(await page.locator('#command').isEnabled(), true);
  }
  const article = page.locator('article').first();
  assert.ok(await article.getAttribute('data-article-scope'));
  assert.equal(await page.locator('article style').count(), 1);
  await page.locator('#command').fill('clear');
  await page.locator('#command').press('Enter');
  await idle();
  assert.equal(
    await page.locator('article style').count(),
    0,
    'article styles leave with their transcript entry',
  );
  assert.equal(await page.locator('[data-egg-cups]').count(), 0);
  await page.route('**/filesystem.json', route => route.abort());
  await page.goto(server.url.href);
  await page
    .getByRole('status')
    .filter({hasText: 'Could not load portfolio files'})
    .waitFor();
  assert.equal(
    await page.locator('article').first().isVisible(),
    true,
    'worker startup failure retains static content',
  );
  assert.deepEqual(
    errors,
    [],
    'React must hydrate without warnings or runtime errors',
  );
  await context.close();
  console.log(
    'PASS React hydration, scoped style cleanup and static startup recovery',
  );
} finally {
  await browser.close();
  await server.stop(true);
}
