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
const articlePath = '/blog/computers-are-just-egg-cups/';
try {
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({
      javaScriptEnabled,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto(new URL(articlePath, server.url).href);
    const idle = () =>
      page.waitForFunction(
        () =>
          document.querySelector('#command-form')?.getAttribute('aria-busy') ===
          'false',
      );
    if (javaScriptEnabled) {
      await idle();
    }
    const layout = page.locator('article').first();
    const ratio = await layout
      .locator('p')
      .first()
      .evaluate(el => {
        const css = getComputedStyle(el);
        return parseFloat(css.lineHeight) / parseFloat(css.fontSize);
      });
    assert.ok(Math.abs(ratio - 1.2) < 0.01);
    const image = layout.locator('img').first();
    const widthRatio = await image.evaluate(
      el =>
        parseFloat(getComputedStyle(el).width) /
        parseFloat(getComputedStyle(el).fontSize),
    );
    assert.ok(
      Math.abs(widthRatio - 3) < 0.01,
      `expected a 3em image, got ${widthRatio}em`,
    );
    if (javaScriptEnabled) {
      const command = page.locator('#command');
      await command.fill(
        'render --style "line-height: 1.6; padding: 2em; background-color: rgb(20, 30, 40); --accent: cyan" ~/blog/computers-are-just-egg-cups/INDEX.md',
      );
      await command.press('Enter');
      await idle();
      const styled = page.locator('article').last();
      const css = await styled.evaluate(el => {
        const css = getComputedStyle(el);
        return {
          lineHeight: el.style.lineHeight,
          padding: parseFloat(css.paddingTop) / parseFloat(css.fontSize),
          background: css.backgroundColor,
          accent: css.getPropertyValue('--accent').trim(),
        };
      });
      assert.deepEqual(css, {
        lineHeight: '1.6',
        padding: 2,
        background: 'rgb(20, 30, 40)',
        accent: 'cyan',
      });
      assert.equal(await layout.evaluate(el => el.style.lineHeight), '1.2');
      assert.equal(await styled.locator('.markdown-body').count(), 0);
      await command.fill(
        `printf '%s' '![Cup](/home/web/blog/computers-are-just-egg-cups/egg-cup-full.gif "width=2.5em height=4em")' | render -s "line-height: 1.3"`,
      );
      await command.press('Enter');
      await idle();
      const last = page.locator('article').last();
      await last.evaluate(el => (el.style.fontSize = '20px'));
      const size = await last.locator('img').evaluate(el => ({
        width: getComputedStyle(el).width,
        height: getComputedStyle(el).height,
      }));
      assert.deepEqual(size, {width: '50px', height: '80px'});
      await page.setViewportSize({width: 375, height: 812});
      await image.scrollIntoViewIfNeeded();
      await layout
        .locator('table')
        .first()
        .screenshot({path: '/tmp/markdown-em-cups.png'});
    }
    await context.close();
  }
  console.log(
    'PASS static and interactive article styles, per-render CSS overrides, 3em cups, and relative width/height through CRT wrappers',
  );
} finally {
  await browser.close();
  await server.stop(true);
}
