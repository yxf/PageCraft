import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';

const source = await readFile(new URL('../public/logo.png', import.meta.url));
const output = new URL('../public/icons/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%}img{display:block;width:100%;height:100%;object-fit:contain}</style><img src="data:image/png;base64,${source.toString('base64')}" alt="">`,
    );
    await page.locator('img').evaluate((img) => img.decode());
    await page.screenshot({
      path: new URL(`icon-${size}.png`, output).pathname,
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
