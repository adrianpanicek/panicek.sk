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
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(base);
  const ready = () =>
    page.waitForFunction(
      () =>
        !document.querySelector<HTMLTextAreaElement>('#command')?.disabled &&
        document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
    );
  await ready();
  assert.ok(!requests.some((url) => url.endsWith('/vim.js')));
  const input = page.locator('#command');
  async function open(command: string) {
    await input.fill(command);
    await input.press('Enter');
    await page.locator('#vim-editor .cm-content').waitFor();
  }
  async function ex(command: string) {
    await page.keyboard.press('Escape');
    await page.keyboard.type(':' + command);
    await page.keyboard.press('Enter');
  }
  await open('vim ~/vim-test.txt');
  assert.equal(
    await page.locator('#vim-editor').evaluate((node) => {
      const screen = node.closest('.crt-viewport');
      return (
        !!screen &&
        getComputedStyle(screen).filter.includes('crt-curve') &&
        !node.closest('[inert]')
      );
    }),
    true,
  );
  await page.keyboard.type('iHello from Vim');
  await ex('q');
  await page.waitForFunction(() =>
    document.querySelector('.vim-status')?.textContent?.includes('E37'),
  );
  await ex('wq');
  await page.locator('#vim-editor').waitFor({ state: 'detached' });
  await ready();
  await input.fill('cat ~/vim-test.txt');
  await input.press('Enter');
  await ready();
  assert.match(await page.locator('#transcript .entry').last().innerText(), /Hello from Vim/);
  await page.reload();
  await ready();
  await open('vi ~/vim-test.txt');
  assert.equal(await page.locator('.cm-content').innerText(), 'Hello from Vim');
  await page.keyboard.type('gg0dw');
  await page.keyboard.type('u');
  assert.equal(await page.locator('.cm-content').innerText(), 'Hello from Vim');
  await page.keyboard.type('A discarded');
  await ex('q!');
  await page.locator('#vim-editor').waitFor({ state: 'detached' });
  await open('vim ~/vim-test.txt');
  assert.equal(await page.locator('.cm-content').innerText(), 'Hello from Vim');
  await ex('q');
  await page.locator('#vim-editor').waitFor({ state: 'detached' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const raw = await context.newPage();
  await raw.goto(base + '/~/vim-test.txt');
  assert.equal((await raw.locator('body').innerText()).trim(), 'Hello from Vim');
  await input.fill("printf 'first\\r\\nsecond\\r\\n' > /tmp/crlf.txt");
  await input.press('Enter');
  await ready();
  await open('vim /tmp/crlf.txt');
  await ex('q');
  await page.locator('#vim-editor').waitFor({ state: 'detached' });
  await open('vim /tmp/crlf.txt');
  await page.keyboard.type('A edited');
  await ex('wq');
  await page.locator('#vim-editor').waitFor({ state: 'detached' });
  const lineEndings = await page.evaluate(async () => (await fetch('/tmp/crlf.txt')).text());
  assert.equal(lineEndings, 'first edited\r\nsecond\r\n');
  // A conflicting tab must never close the buffer or silently lose its contents.
  await open('vim ~/vim-test.txt');
  await page.keyboard.type('A conflict-buffer');
  const other = await context.newPage();
  await other.goto(base);
  await other.waitForFunction(
    () =>
      !document.querySelector<HTMLTextAreaElement>('#command')?.disabled &&
      document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
  );
  await other.locator('#command').fill('echo concurrent > /tmp/concurrent');
  await other.locator('#command').press('Enter');
  await other.waitForFunction(
    () =>
      !document.querySelector<HTMLTextAreaElement>('#command')?.disabled &&
      document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
  );
  await ex('wq');
  await page.waitForFunction(() =>
    document.querySelector('.vim-status')?.textContent?.includes('Write failed'),
  );
  assert.match(await page.locator('.cm-content').innerText(), /conflict-buffer/);
  await ex('q!');
  await page.locator('#vim-editor').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 320, height: 640 });
  await open('vim ~/vim-test.txt');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ex('q');
  await page.locator('#vim-editor').waitFor({ state: 'detached' });
  console.log('PASS CRLF preservation, failed-save buffer retention, and narrow editor');
  assert.deepEqual(errors, []);
  console.log(
    'PASS lazy Vim editor, insert/normal modes, undo, unsaved guard, :wq, :q!, persistence, and raw URLs',
  );
} finally {
  await browser.close();
}
