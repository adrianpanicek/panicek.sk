import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
const base = process.env.TEST_URL || 'http://127.0.0.1:4321';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
try {
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
  assert.match(await page.locator('article').last().innerText(), /No posts yet/);
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
  assert.match(await page.locator('article').last().innerText(), /Local blog/);
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
      articles[articles.length - 1]?.innerText.includes('No posts yet')
    );
  });
  assert.match(
    await fresh.locator('article[data-source="/home/web/blog/INDEX.md"]').last().innerText(),
    /No posts yet/,
  );
  console.log('PASS directory URLs, nginx-style lazy loading, aliases and persisted edits');
} finally {
  await browser.close();
}
