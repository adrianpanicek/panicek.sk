import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  const ids: string[] = [];
  await page.route('**/api/visit', async (route) => {
    ids.push(route.request().postDataJSON().id);
    await route.fulfill({ json: { visitors: 42 } });
  });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4321');
  await page.locator('#visitor-count').waitFor();
  assert.equal(await page.locator('#visitor-count').textContent(), 'visitors: 42');
  await page.reload();
  await page.locator('#visitor-count').waitFor();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  await page.evaluate(() => localStorage.removeItem('portfolio:visitor'));
  await page.reload();
  await page.locator('#visitor-count').waitFor();
  assert.notEqual(ids[2], ids[0]);
  await page.route('**/api/visit', (route) => route.abort());
  await page.reload();
  await page.waitForFunction(
    () => !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
  );
  assert.equal(await page.locator('#visitor-count').count(), 0);
  console.log(
    'PASS visitor identity persists, reset creates new identity, and collector failure leaves terminal usable',
  );
} finally {
  await browser.close();
}
