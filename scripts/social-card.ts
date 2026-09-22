import { chromium } from 'playwright';

const font = Buffer.from(await Bun.file('public/assets/ibm-vga-8x16.woff').arrayBuffer()).toString(
  'base64',
);
const portrait = Buffer.from(await Bun.file('content/portrait.png').arrayBuffer()).toString(
  'base64',
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@font-face{font-family:VGA;src:url(data:font/woff;base64,${font}) format('woff')}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;padding:64px;background:#0b0d10;color:#c4c9d2;font-family:VGA,monospace;font-synthesis:none}
.prompt{font-size:32px;line-height:1;color:#8893a5}.user{color:#4dd9d0}.host{color:#65baff}.path{color:#70dbac}
main{display:flex;align-items:center;justify-content:space-between;margin-top:64px;gap:48px}h1{font-size:64px;line-height:1;margin:0 0 32px;color:#edf0f5;font-weight:400}p{font-size:32px;line-height:1.25;margin:0}img{width:288px;height:288px;object-fit:cover;border-radius:4px}footer{margin-top:48px;font-size:24px;color:#8893a5}
</style></head><body><div class="prompt"><span class="user">web</span>@<span class="host">panicek.sk</span> <span class="path">~</span> $ cat ABOUT.md</div><main><div><h1>Adrián Paníček</h1><p>Software. Electronics.<br>Finding out how things work.</p></div><img src="data:image/png;base64,${portrait}" alt="Portrait of Adrián Paníček"></main><footer>Rust · C++ · Embedded systems · Linux</footer></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('img').evaluate((node) => (node as HTMLImageElement).decode());
  await page.screenshot({ path: 'public/assets/social-card.png' });
} finally {
  await browser.close();
}
