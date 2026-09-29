import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { staticHandler } from '../scripts/static-handler';

const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: staticHandler('dist') });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
try {
  for (const entry of ['home', 'link', 'command'] as const) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 700 },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    let portraitRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/home/web/portrait.png') portraitRequests++;
    });
    const idle = () =>
      page.waitForFunction(
        () =>
          document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false' &&
          !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
      );
    const run = async (command: string) => {
      const input = page.getByRole('textbox', { name: 'Shell command' });
      await input.fill(command);
      await input.press('Enter');
      await idle();
    };
    await page.goto(new URL(entry === 'home' ? '/' : '/blog/', server.url).href);
    await idle();
    if (entry !== 'home') {
      assert.equal(portraitRequests, 0, 'blog startup must not fetch the portrait');
      if (entry === 'link') {
        await run("echo '[About](~/ABOUT.md)' | render");
        await page.getByRole('link', { name: 'About', exact: true }).click();
        await idle();
      } else {
        await run('cat ~/ABOUT.md | render');
      }
    }
    const portrait = page.locator('article img[src="/home/web/portrait.png"]').last();
    await portrait.waitFor({ state: 'attached' });
    await portrait.evaluate((image: HTMLImageElement) => image.decode());
    assert.equal(portraitRequests, 1, `${entry}: rendered image must reuse the preload`);
    assert.equal(await portrait.getAttribute('loading'), 'eager');
    assert.equal(await portrait.getAttribute('fetchpriority'), 'high');
    assert.equal(
      await page.evaluate(
        () =>
          (
            performance.getEntriesByName(
              new URL('/home/web/portrait.png', location.href).href,
            )[0] as PerformanceResourceTiming
          ).initiatorType,
      ),
      'link',
      `${entry}: preload must start the portrait request before the image renders`,
    );
    await run('cat ~/ABOUT.md | render');
    assert.equal(await page.locator('link[rel="preload"][as="image"]').count(), 1);
    assert.equal(portraitRequests, 1, 'rendering About again must reuse the portrait');
    await context.close();
  }
  console.log('PASS portrait preloading on homepage, About links and commands, with request reuse');
} finally {
  await browser.close();
  await server.stop(true);
}
