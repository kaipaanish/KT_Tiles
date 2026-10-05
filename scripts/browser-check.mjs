// Browser check: screenshots at phone (390 × 844, touch) and desktop (1440 × 900) sizes, plus a
// console check. A development tool only: nothing in `npm run build` runs it, and
// playwright-core downloads no browsers; it drives the Chrome (or Edge) already installed.
//
//   npm run build && npx vite preview --port 4173      (in another terminal)
//   npm run check:browser -- [url] [--out checks/step-2] [--only name] [--browser msedge]
//
// Exits with code 1 if any page logs a console error or throws.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { scenarios } from './check-scenarios.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const baseUrl = args.find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:4173/';
const outDir = option('--out') ?? 'checks/latest';
const only = option('--only');
const channel = option('--browser') ?? 'chrome';

const devices = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel, headless: true });
const report = [];
let failures = 0;

for (const scenario of scenarios) {
  if (only && !scenario.name.includes(only)) continue;
  for (const [device, contextOptions] of Object.entries(devices)) {
    if (scenario.devices && !scenario.devices.includes(device)) continue;
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const errors = [];
    const warnings = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
      if (message.type() === 'warning') warnings.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(`Uncaught: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()} for ${response.url()}`);
    });

    const shots = [];
    const shot = async (label) => {
      const file = path.join(outDir, `${scenario.name}${label ? `-${label}` : ''}-${device}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
    };
    try {
      await page.goto(new URL(scenario.path ?? '', baseUrl).href);
      await page.waitForSelector('body[data-ready="true"]', { timeout: 15000 });
      if (scenario.run) await scenario.run(page, { device, shot });
      else await shot('');
    } catch (error) {
      errors.push(`Check failed: ${error.message.split('\n')[0]}`);
    }
    failures += errors.length;
    report.push({ scenario: scenario.name, device, errors, warnings, shots });
    console.log(`${errors.length ? '✗' : '✓'} ${scenario.name} (${device})${errors.length ? `: ${errors.length} error(s)` : ''}`);
    for (const e of errors) console.log(`    error: ${e}`);
    for (const w of warnings) console.log(`    warning: ${w}`);
    await context.close();
  }
}

await browser.close();
await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.length} page(s) checked, ${failures} console error(s). Screenshots in ${outDir}`);
process.exit(failures > 0 ? 1 : 0);
