import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { strict as assert } from 'node:assert';

const base = process.env.TEST_URL || 'http://127.0.0.1:4321';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
await mkdir('.artifacts', { recursive: true });
try {
  const noJS = await browser.newContext({ javaScriptEnabled: false });
  const raw = await noJS.newPage();
  await raw.goto(base);
  assert.match(await raw.locator('body').innerText(), /Expert Embedded Software Engineer/);
  assert.equal(await raw.locator('[data-source="/home/web/CONTACTS.md"]').count(), 0);
  assert.ok(!(await raw.locator('body').innerText()).includes('adrian@panicek.sk'));
  await raw.getByRole('link', { name: 'Career', exact: true }).click();
  assert.match(await raw.locator('body').innerText(), /# Career/);
  assert.equal((await raw.goto(base + '/~/CAREER.md'))?.status(), 200);
  assert.equal((await raw.goto(base + '/~/EXPERIENCE.md'))?.status(), 404);
  await noJS.close();
  console.log('PASS no-JS content and published raw routes');

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('Browser:', msg.text());
  });
  let filesystemRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/filesystem.json') filesystemRequests++;
  });
  await page.goto(base);
  const input = page.getByRole('textbox', { name: 'Shell command' });
  await input.waitFor();
  await page.waitForFunction(
    () =>
      !!document.querySelector<HTMLTextAreaElement>('#command') &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
    { timeout: 20000 },
  );
  assert.equal(filesystemRequests, 1, 'startup must reuse the preloaded filesystem');
  assert.ok(await page.locator('[data-source="/home/web/CONTACTS.md"]').count());
  await page.keyboard.type('echo keyboard-ready');
  assert.equal(
    await input.inputValue(),
    'echo keyboard-ready',
    'shell must accept typing immediately after startup',
  );
  await input.fill('');
  await input.evaluate((el) => el.blur());
  await page.locator('#transcript h1').first().click();
  await page.keyboard.type('echo click-ready');
  assert.equal(await input.inputValue(), 'echo click-ready');
  await input.fill('');
  console.log('PASS startup keyboard focus and click-to-focus');

  await input.fill('echo cursor');
  await input.press('ArrowLeft');
  await page.waitForFunction(
    () =>
      document.querySelector('.block-caret')?.nextElementSibling?.nextElementSibling
        ?.textContent === 'r',
  );
  const caret = await page.evaluate(() => {
    const input = document.querySelector<HTMLTextAreaElement>('#command')!;
    const marker = document.querySelector<HTMLElement>('.block-caret')!;
    const style = getComputedStyle(marker, '::after');
    return {
      position: input.selectionStart,
      next: marker.nextElementSibling?.nextElementSibling?.textContent,
      width: parseFloat(style.width),
      height: parseFloat(style.height),
      animation: style.animationName,
      native: getComputedStyle(input).caretColor,
    };
  });
  assert.equal(caret.position, 10);
  assert.equal(caret.next, 'r');
  assert.ok(caret.width >= 7 && caret.height >= 15);
  assert.equal(caret.animation, 'none');
  assert.equal(caret.native, 'rgba(0, 0, 0, 0)');
  await input.fill('');
  console.log('PASS steady block cursor follows editing position without native caret');
  for (const width of [320, 768, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.evaluate(() => {
      const terminal = document.querySelector('.terminal')!.getBoundingClientRect();
      const field = document.querySelector('#command')!.getBoundingClientRect();
      const article = document.querySelector('.markdown')!.getBoundingClientRect();
      return {
        terminal: terminal.width,
        fieldRight: field.right,
        terminalRight: terminal.right,
        article: article.width,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(geometry.terminal >= width - 16);
    assert.ok(Math.abs(geometry.fieldRight - geometry.terminalRight) < 2);
    assert.ok(Math.abs(geometry.article - Math.min(geometry.terminal, 640)) < 2);
    assert.equal(geometry.overflow, false);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  console.log('PASS terminal, Markdown, and input resize from 320px to 1920px');

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
  });
  assert.equal(await page.locator('#transcript .entry').count(), 2);
  await input.fill('cat ABOUT.md | render > /tmp/rendered.md && echo done');
  assert.deepEqual(
    (await page.locator('#input-highlight .command-name').allTextContents()).filter(Boolean),
    ['cat', 'render', 'echo'],
  );
  await input.press('Enter');
  await page.waitForFunction(
    () => document.querySelector('#transcript .entry:last-child .output')?.textContent === 'done\n',
  );
  assert.deepEqual(
    (
      await page
        .locator('#transcript .entry:last-child .prompt-line .command-name')
        .allTextContents()
    ).filter(Boolean),
    ['cat', 'render', 'echo'],
  );
  await input.fill('');
  console.log('PASS pipeline and command-list highlighting in input and history');
  await page.screenshot({ path: '.artifacts/desktop.png', fullPage: true });
  const run = async (command: string) => {
    await input.fill(command);
    await input.press('Enter');
    await page.waitForFunction(
      () =>
        !!document.querySelector<HTMLTextAreaElement>('#command') &&
        !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
        !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
    );
    return page.locator('#transcript .entry').last().innerText();
  };
  assert.equal(
    await page.locator('[data-source="/home/web/CONTACTS.md"] a').first().getAttribute('href'),
    'mailto:adrian@panicek.sk',
  );
  assert.equal(
    await page.getByRole('link', { name: 'Phone', exact: true }).getAttribute('href'),
    'tel:+421902796000',
  );
  assert.equal(
    await page.getByRole('link', { name: 'WhatsApp', exact: true }).getAttribute('href'),
    'https://wa.me/421902796000',
  );
  await run("echo '{{rot13:nqevna@cnavprx.fx}}'");
  assert.equal(
    (await page.locator('#transcript .entry').last().locator('.output').innerText()).trim(),
    'adrian@panicek.sk',
  );
  await run('cat ~/CONTACTS.md | head -n 7 | render');
  assert.equal(
    await page
      .locator('#transcript .entry')
      .last()
      .getByRole('link', { name: 'Email', exact: true })
      .getAttribute('href'),
    'mailto:adrian@panicek.sk',
  );
  const encodedContacts = await page.evaluate(async () => (await fetch('/~/CONTACTS.md')).text());
  assert.ok(encodedContacts.includes('{{rot13:nqevna@cnavprx.fx}}'));
  assert.ok(!encodedContacts.includes('adrian@panicek.sk'));
  console.log('PASS JavaScript-only contacts, echo/pipeline decoding, and encoded raw files');
  await run(
    'mkdir -p /tmp/a-very-long-directory-name-for-testing-responsive-terminal-layout/nested; cd /tmp/a-very-long-directory-name-for-testing-responsive-terminal-layout/nested',
  );
  await page.setViewportSize({ width: 320, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok((await input.boundingBox())!.width >= 90);
  await run('echo narrow-prompt-works');
  await page.setViewportSize({ width: 1280, height: 900 });
  await run('cd /tmp');
  const commandCount = await page.locator('#transcript .entry').count();
  await page.getByRole('link', { name: 'Career', exact: true }).click();
  await page.waitForFunction(() => {
    const el = document.querySelector<HTMLTextAreaElement>('#command');
    return el?.readOnly && el.value.length > 0 && el.value !== 'cat ~/CAREER.md | render';
  });
  assert.equal(await page.locator('#transcript .entry').count(), commandCount);
  assert.ok('cat ~/CAREER.md | render'.startsWith(await input.inputValue()));
  await page.waitForFunction(
    () =>
      !!document.querySelector<HTMLTextAreaElement>('#command') &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
  );
  assert.match(
    await page.locator('#transcript .entry').last().innerText(),
    /cat ~\/CAREER.md[\s\S]*Expert Embedded Software Engineer/,
  );
  assert.equal(await page.locator('#cwd').innerText(), '/tmp');
  assert.match(await page.locator('#command-form label').innerText(), /web@panicek.sk \/tmp/);
  assert.equal(await input.evaluate((el) => getComputedStyle(el).fontSize), '16px');
  console.log(
    'PASS visible character-by-character command, full prompt, and link execution after cd',
  );
  await input.fill('echo keep-my-draft');
  await page.getByRole('link', { name: 'Career', exact: true }).first().click();
  await input.press('Escape');
  await page.waitForFunction(
    () => !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
  );
  assert.equal(await input.inputValue(), 'echo keep-my-draft');
  await input.fill('');
  await run(`printf '# Generated heading\\n\\n**Bold text** and [Career](CAREER.md)\\n' | render`);
  const generated = page.locator('#transcript .entry').last();
  assert.equal(await generated.locator('h1').innerText(), 'Generated heading');
  assert.equal(await generated.locator('strong').innerText(), 'Bold text');
  assert.ok(
    await generated.locator('h1').evaluate((el) => parseFloat(getComputedStyle(el).fontSize) > 18),
  );
  await run('cat ~/ABOUT.md | head -n 3 | render');
  assert.equal(
    await page.locator('#transcript .entry').last().locator('h1').innerText(),
    'Adrián Paníček',
  );
  await run(`printf '# Log\\n'; seq 60000`);
  assert.ok(
    (await page.locator('#transcript .entry').last().locator('.output:not(.error)').innerText())
      .trim()
      .endsWith('60000'),
  );
  assert.equal(await input.isEnabled(), true);
  await run('cat ~/ABOUT.md');
  assert.equal(await page.locator('#transcript .entry').last().locator('h1').count(), 0);
  assert.match(
    await page.locator('#transcript .entry').last().locator('.output').innerText(),
    /^# Adrián/,
  );
  await run("echo '# Literal heading'");
  assert.equal(await page.locator('#transcript .entry').last().locator('h1').count(), 0);
  await run(
    `printf '%s' '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>' > ~/picture.svg`,
  );
  await run(`printf '%s' '![Local image](picture.svg)' > ~/IMAGE.md`);
  await run('cat ~/IMAGE.md | render');
  await page.locator('#transcript .entry').last().locator('img').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>('#transcript .entry:last-child img');
    return img?.complete && img.naturalWidth === 16;
  });
  assert.equal(
    await page.locator('#transcript .entry').last().locator('img').getAttribute('src'),
    '/home/web/picture.svg',
  );
  console.log('PASS explicit Markdown, plain cat/echo, local images, and large-log fallback');
  assert.match(await run("printf 'z\\na\\n' | sort | head -n 1"), /\na\n?$/);
  assert.match(await run('whoami'), /web/);
  await run(
    'mkdir -p ~/notes; echo persistent > ~/notes/new.txt; ln -s /home/web/notes /tmp/notes',
  );
  const rawPage = await context.newPage();
  assert.equal((await rawPage.goto(base + '/~/notes/new.txt'))?.status(), 200);
  assert.equal((await rawPage.locator('body').innerText()).trim(), 'persistent');
  await rawPage.goto(base + '/tmp/notes/new.txt');
  assert.equal((await rawPage.locator('body').innerText()).trim(), 'persistent');
  await rawPage.goto(base + '/~/notes/');
  assert.match(await rawPage.locator('body').innerText(), /\/home\/web\/notes\/new.txt/);
  await page.reload();
  await page.waitForFunction(
    () =>
      !!document.querySelector<HTMLTextAreaElement>('#command') &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
  );
  assert.match(await run('cat ~/notes/new.txt'), /persistent/);
  await run('rm ~/notes/new.txt');
  assert.equal((await rawPage.goto(base + '/~/notes/new.txt'))?.status(), 404);
  console.log('PASS persistence, arbitrary raw files, directories, symlinks and deletion');

  await run('printf "hello\\n" | gzip | gunzip');
  assert.equal(
    (
      await page.locator('#transcript .entry').last().locator('.output:not(.error)').innerText()
    ).trim(),
    'hello',
  );
  console.log('PASS browser gzip tools');
  // Native clipboard paste must preserve multiline input and must not run it.
  await page.evaluate(() => navigator.clipboard.writeText('echo paste-one\necho paste-two'));
  const before = await page.locator('#transcript .entry').count();
  await input.focus();
  await input.press('Control+V');
  assert.equal(await input.inputValue(), 'echo paste-one\necho paste-two');
  assert.equal(await page.locator('#transcript .entry').count(), before);
  await input.press('Enter');
  await page.waitForFunction(
    () =>
      !!document.querySelector<HTMLTextAreaElement>('#command') &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
  );
  assert.match(await page.locator('#transcript .entry').last().innerText(), /paste-one\npaste-two/);
  await page
    .locator('#transcript .entry')
    .last()
    .locator('.output')
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  await page.keyboard.press('Control+C');
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /paste-one\npaste-two/);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const longPaste = Array.from({ length: 35 }, (_, i) => `echo line-${i}`).join('\n');
  await input.fill(longPaste);
  await input.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event('scroll'));
  });
  assert.equal(
    await input.evaluate((el) => el.scrollTop),
    await page.locator('#input-highlight').evaluate((el) => el.scrollTop),
  );
  await input.fill('');
  console.log(
    'PASS native copy, multiline paste without auto-execution, and input scroll alignment',
  );

  await input.fill('cat ~/CAR');
  await input.press('Tab');
  await page.waitForFunction(
    () => document.querySelector<HTMLTextAreaElement>('#command')?.value === 'cat ~/CAREER.md',
  );
  await input.press('ArrowUp');
  assert.ok((await input.inputValue()).includes('echo paste-one'));
  await input.fill('');
  await run('seq 20000');
  const largeOutput = await page
    .locator('#transcript .entry')
    .last()
    .locator('.output:not(.error)')
    .innerText();
  assert.equal(largeOutput.trim().split('\n').length, 20000);
  assert.ok(largeOutput.endsWith('20000\n') || largeOutput.endsWith('20000'));
  await run('seq 60000');
  const tail = await page
    .locator('#transcript .entry')
    .last()
    .locator('.output:not(.error)')
    .innerText();
  assert.match(tail, /Earlier lines trimmed/);
  assert.ok(tail.trim().endsWith('60000'));
  assert.ok(tail.split('\n').length <= 50000);
  const latencyStart = performance.now();
  await input.fill('echo responsive');
  assert.equal(await input.inputValue(), 'echo responsive');
  console.log(
    `PASS 20,000-line scrollback; input round-trip ${Math.round(performance.now() - latencyStart)}ms`,
  );
  await run('echo retained > /tmp/retained');
  await input.fill('sleep 30');
  await input.press('Enter');
  await page.getByRole('button', { name: 'interrupt', exact: true }).click();
  await page.waitForFunction(
    () =>
      !!document.querySelector<HTMLTextAreaElement>('#command') &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
  );
  assert.match(await run('cat /tmp/retained'), /retained/);
  // A second terminal must not silently overwrite a newer save.
  const second = await context.newPage();
  await second.goto(base);
  await second.waitForFunction(
    () =>
      !!document.querySelector<HTMLTextAreaElement>('#command') &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
  );
  await run('echo first > /tmp/conflict');
  const secondInput = second.getByRole('textbox', { name: 'Shell command' });
  await secondInput.fill('echo second > /tmp/conflict');
  await secondInput.press('Enter');
  await second.waitForFunction(
    () =>
      !!document.querySelector<HTMLTextAreaElement>('#command') &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
  );
  assert.match(await second.locator('#status').innerText(), /another tab/);
  await rawPage.goto(base + '/tmp/conflict');
  assert.equal((await rawPage.locator('body').innerText()).trim(), 'first');
  await second.close();
  console.log('PASS conflicting tab saves do not overwrite newer files');

  // Quoted names are read literally; a link cannot execute embedded shell syntax.
  const tricky = "/home/web/quote'$(touch HACKED).md";
  const q = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  await run(`printf '%s' '[Career](CAREER.md)' > ${q(tricky)}`);
  await run(`printf '%s' ${q(`[Tricky](<${tricky}>)`)} > ~/LINKS.md`);
  await run('cat ~/LINKS.md | render');
  await page.getByRole('link', { name: 'Tricky', exact: true }).click();
  await page.waitForFunction(
    () =>
      !!document.querySelector<HTMLTextAreaElement>('#command') &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
  );
  assert.equal(
    await page
      .locator('#transcript .entry')
      .last()
      .getByRole('link', { name: 'Career', exact: true })
      .count(),
    1,
  );
  assert.equal((await rawPage.goto(base + '/home/web/HACKED'))?.status(), 404);
  console.log('PASS Markdown filenames with shell syntax remain literal');

  await page.close();
  await rawPage.goto(base + '/tmp/retained');
  assert.equal((await rawPage.locator('body').innerText()).trim(), 'retained');
  console.log('PASS interrupt recovery and raw navigation with terminal closed');
  const resetPage = await context.newPage();
  await resetPage.goto(base);
  await resetPage.waitForFunction(
    () =>
      !!document.querySelector<HTMLTextAreaElement>('#command') &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
  );
  resetPage.once('dialog', (dialog) => dialog.accept());
  await resetPage.getByRole('textbox', { name: 'Shell command' }).fill('reset');
  await resetPage.getByRole('textbox', { name: 'Shell command' }).press('Enter');
  await resetPage.waitForFunction(
    () =>
      !!document.querySelector<HTMLTextAreaElement>('#command') &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
  );
  assert.equal((await rawPage.goto(base + '/tmp/retained'))?.status(), 404);
  assert.equal((await rawPage.goto(base + '/~/ABOUT.md'))?.status(), 200);
  await resetPage.close();
  console.log('PASS reset restores published files and removes local edits');
  assert.deepEqual(errors, []);
  await context.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(base);
  await mobile.waitForFunction(
    () =>
      !!document.querySelector<HTMLTextAreaElement>('#command') &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.disabled &&
      !document.querySelector<HTMLTextAreaElement>('#command')!.readOnly,
  );
  await mobile.screenshot({ path: '.artifacts/mobile.png', fullPage: true });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobileContext.close();
  console.log('PASS mobile viewport; screenshots saved to .artifacts/');
} finally {
  await browser.close();
}
