import { programFixture } from './fixtures/program';
import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
const base = process.env.TEST_URL || 'http://127.0.0.1:4321';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  const requests: string[] = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.route('**/filesystem.json', async (route) => {
    const response = await route.fetch();
    const files = await response.json();
    files['/home/web/programs'] = { directory: true };
    await route.fulfill({ json: files });
  });
  await page.goto(base);
  const idle = () =>
    page.waitForFunction(
      () =>
        document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false' &&
        !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
    );
  await idle();
  assert.ok(!requests.includes('/assets/program.js'));
  const input = page.getByRole('textbox', { name: 'Shell command' });
  const run = async (command: string) => {
    await input.fill(command);
    await input.press('Enter');
    await idle().catch(async (error) => {
      console.error('Program command failed:', command);
      console.error(await page.locator('.entry').last().innerText());
      throw error;
    });
  };
  const install = async (source: string) => {
    await run(`cat > /tmp/test.js <<'SCRIPT'\n${source}\nSCRIPT\nchmod +x /tmp/test.js`);
  };
  await install('api.print("hello " + api.args[0]);');
  await run('./../../tmp/test.js "browser world"');
  assert.match(await page.locator('.entry').last().innerText(), /hello browser world/);
  assert.ok(requests.includes('/assets/program.js'));
  await install("api.write('hello '); api.write('world');");
  await run('/tmp/test.js');
  assert.equal(await page.locator('.entry').last().locator('pre.output').count(), 1);
  assert.equal(
    await page.locator('.entry').last().locator('pre.output').textContent(),
    'hello world',
  );
  assert.ok(!requests.some((path) => path.startsWith('/_files/home/web/programs/')));
  await page.route('**/_files/home/web/programs/', (route) =>
    route.fulfill({ json: [{ name: 'hello', type: 'file', size: 73 }] }),
  );
  await page.route('**/_files/home/web/programs/hello', (route) =>
    route.fulfill({ body: '#!/usr/bin/env browser-js\napi.print(`Hello, ${api.args[0]}!`);\n' }),
  );
  await run('./programs/hello lazy');
  assert.match(await page.locator('.entry').last().innerText(), /Hello, lazy!/);
  assert.ok(requests.includes('/_files/home/web/programs/'));
  await install(
    `try { await indexedDB.databases(); api.print('storage accessible'); } catch { api.print('storage blocked'); }`,
  );
  await run('/tmp/test.js');
  assert.match(await page.locator('.entry').last().innerText(), /storage blocked/);
  await install(
    `api.print(typeof document); try { await fetch('${base}/api/visit'); } catch { api.print('network blocked'); } api.print(typeof indexedDB);`,
  );
  await run('/tmp/test.js');
  assert.match(await page.locator('.entry').last().innerText(), /undefined[\s\S]*network blocked/);
  await install(
    `api.view('<button id="greet">Greet</button>'); api.onEvent(e => { if(e.id === 'greet') { api.print('clicked'); api.exit(0); } });`,
  );
  await input.fill('/tmp/test.js');
  await input.press('Enter');
  await page.frameLocator('iframe.browser-program').getByRole('button', { name: 'Greet' }).click();
  await idle();
  assert.match(await page.locator('.entry').last().innerText(), /clicked/);
  await install('while (true) {}');
  await input.fill('/tmp/test.js');
  await input.press('Enter');
  await page.locator('iframe.browser-program').waitFor({ state: 'attached' });
  await page.locator('#stop').click();
  await idle();
  assert.match(await page.locator('#exit-status').innerText(), /130/);
  await install('throw new Error("intentional failure");');
  await run('/tmp/test.js');
  assert.match(await page.locator('.entry').last().innerText(), /intentional failure/);
  await install(
    `api.view('<meta http-equiv=\"refresh\" content=\"0;url=${base}/leak\"><iframe src=\"${base}/leak\"></iframe><button id=\"safe\" onclick=\"parent.document.body.remove()\">Safe</button>');`,
  );
  await input.fill('/tmp/test.js');
  await input.press('Enter');
  const safe = page.frameLocator('iframe.browser-program').getByRole('button', { name: 'Safe' });
  await safe.click();
  assert.equal(await safe.getAttribute('onclick'), null);
  assert.equal(
    await page.frameLocator('iframe.browser-program').locator('meta, iframe').count(),
    1,
  ); // bootstrap CSP meta only
  assert.ok(!requests.includes('/leak'));
  // Exercise the sandbox's keyboard interruption path after interacting with its view.
  await safe.press('Control+c');
  await idle();
  // Minimal raw Wasm: exported main returns 7.
  await run(
    "printf '\\x00asm\\x01\\x00\\x00\\x00\\x01\\x05\\x01\\x60\\x00\\x01\\x7f\\x03\\x02\\x01\\x00\\x07\\x08\\x01\\x04main\\x00\\x00\\x0a\\x06\\x01\\x04\\x00\\x41\\x07\\x0b' > /tmp/raw; chmod +x /tmp/raw",
  );
  await run('/tmp/raw');
  assert.match(await page.locator('#exit-status').innerText(), /7/);
  const escaped = [...programFixture()]
    .map((byte) => '\\x' + byte.toString(16).padStart(2, '0'))
    .join('');
  await run(`printf '${escaped}' > /tmp/host; chmod +x /tmp/host`);
  await run('/tmp/host one two');
  assert.match(await page.locator('.entry').last().innerText(), /wasm says/);
  assert.match(await page.locator('#exit-status').innerText(), /2/);
  console.log(
    'PASS JS and Wasm programs, quoted args, UI events, network isolation, errors and interruption',
  );
} finally {
  await browser.close();
}
