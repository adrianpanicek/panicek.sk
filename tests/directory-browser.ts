import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
const base = process.env.TEST_URL || 'http://127.0.0.1:4321';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const staticContext = await browser.newContext({ javaScriptEnabled: false });
  for (const path of ['/blog', '/home/web/blog']) {
    const direct = await staticContext.newPage();
    await direct.goto(base + path);
    assert.equal(await direct.locator('article').count(), 1);
    assert.equal(
      await direct.locator('article').getAttribute('data-source'),
      '/home/web/blog/INDEX.md',
    );
    await direct.close();
  }
  await staticContext.close();
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  const idle = () =>
    page.waitForFunction(
      () =>
        document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false' &&
        !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
    );
  await page.goto(base);
  await idle();
  assert.ok(
    !requests.some((path) => path.startsWith('/_files/')),
    'startup must not fetch nested content',
  );
  const input = page.getByRole('textbox', { name: 'Shell command' });
  await input.fill('render /blog');
  await input.press('Enter');
  await page.locator('article[data-source="/home/web/blog/INDEX.md"]').waitFor();
  await idle();
  // content-visibility can skip offscreen layout; inspect the rendered DOM text.
  const publishedIndex = (await page.locator('article').last().textContent())!;
  assert.match(publishedIndex, /Blog/);
  assert.ok(requests.includes('/_files/home/web/blog/'));
  assert.ok(requests.includes('/_files/home/web/blog/INDEX.md'));
  await input.fill("echo '# Local blog' > /blog/INDEX.md");
  await input.press('Enter');
  await idle();
  await page.goto(base + '/blog/');
  await page.locator('article[data-source="/home/web/blog/INDEX.md"]').waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('article[data-source="/home/web/blog/INDEX.md"]')
      ?.textContent?.includes('Local blog'),
  );
  assert.match((await page.locator('article').last().textContent())!, /Local blog/);
  assert.equal(await page.locator('article').count(), 1);
  const fresh = await browser.newPage();
  await fresh.goto(base + '/home/web/blog/');
  await fresh.locator('article[data-source="/home/web/blog/INDEX.md"]').waitFor();
  await fresh.waitForFunction(() => {
    const articles = document.querySelectorAll<HTMLElement>(
      'article[data-source="/home/web/blog/INDEX.md"]',
    );
    return (
      !document.querySelector<HTMLTextAreaElement>('#command')?.disabled &&
      document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false' &&
      articles[articles.length - 1]?.textContent?.includes('Blog')
    );
  });
  assert.equal(
    await fresh.locator('article[data-source="/home/web/blog/INDEX.md"]').last().textContent(),
    publishedIndex,
  );
  console.log('PASS directory URLs, nginx-style lazy loading, aliases and persisted edits');
} finally {
  await browser.close();
}
