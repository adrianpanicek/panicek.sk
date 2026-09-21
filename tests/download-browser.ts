import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4321');
  const ready = () =>
    page.waitForFunction(() => !document.querySelector<HTMLTextAreaElement>('#command')?.disabled);
  await ready();
  const run = async (text: string) => {
    await page.locator('#command').fill(text);
    await page.locator('#command').press('Enter');
    await ready();
  };
  await run(
    `printf 'AP+AAQ==' | base64 -d > '/tmp/file with spaces.bin'; printf 'héllo' > /tmp/text.txt`,
  );
  const downloads: import('playwright').Download[] = [];
  page.on('download', (download) => downloads.push(download));
  await run(`/usr/sbin/save '/tmp/file with spaces.bin' /tmp/text.txt /tmp/missing`);
  await page.waitForFunction(() => document.querySelectorAll('.downloads a').length === 2);
  await page.waitForTimeout(500);
  assert.equal(downloads.length, 2);
  await mkdir('.artifacts/downloads', { recursive: true });
  for (const download of downloads)
    await download.saveAs('.artifacts/downloads/' + download.suggestedFilename());
  assert.deepEqual(
    new Uint8Array(await Bun.file('.artifacts/downloads/file with spaces.bin').arrayBuffer()),
    new Uint8Array([0, 255, 128, 1]),
  );
  assert.equal(await Bun.file('.artifacts/downloads/text.txt').text(), 'héllo');
  assert.match(await page.locator('#transcript .entry').last().innerText(), /missing/);
  const again = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download text.txt', exact: true }).click();
  assert.equal((await again).suggestedFilename(), 'text.txt');
  await run('clear');
  assert.equal(await page.locator('.downloads').count(), 0);
  console.log(
    'PASS /usr/sbin/save multi-file downloads, exact binary/UTF-8 bytes, partial errors, retry links, and clear',
  );
} finally {
  await browser.close();
}
