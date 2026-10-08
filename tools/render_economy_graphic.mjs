import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const HTML_FILE = path.join(ROOT, 'public', 'economy_infographic.html');
const OUT_PNG = path.join(ROOT, 'public', 'economy_diagram.png');

async function main() {
  console.log('Rendering economy diagram graphic...');
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
  await page.goto(`file://${HTML_FILE}`, { waitUntil: 'networkidle0' });

  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });

  await new Promise(r => setTimeout(r, 600));

  const element = await page.$('.container');
  if (element) {
    await element.screenshot({ path: OUT_PNG });
  } else {
    await page.screenshot({ path: OUT_PNG });
  }

  await browser.close();
  console.log(`Successfully generated economy diagram at: ${OUT_PNG}`);
}

main().catch(err => {
  console.error('Error rendering diagram:', err);
  process.exit(1);
});
