#!/usr/bin/env node
// Development helper: drive the running game in headless Chromium with keyboard steps and take
// screenshots. Not part of the shipped game.
//
//   node scripts/dev/drive.mjs <url> <outDir> '<steps JSON>'
//
// Steps: ["wait", ms] · ["key", "Enter"] · ["down", "KeyD"] · ["up", "KeyD"] · ["hold", "KeyD", ms]
//        ["shot", "name.png"] · ["waitFor", "js expression", timeoutMs] · ["eval", "js"]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [url = 'http://localhost:5173/', outDir = '.', stepsJson = '[]'] = process.argv.slice(2);
const steps = JSON.parse(stepsJson);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
await page.goto(url);
const t0 = Date.now();
for (const step of steps) {
  const [op, a, b] = step;
  if (op === 'wait') await page.waitForTimeout(a);
  else if (op === 'key') await page.keyboard.press(a, { delay: 60 });
  else if (op === 'down') await page.keyboard.down(a);
  else if (op === 'up') await page.keyboard.up(a);
  else if (op === 'hold') {
    await page.keyboard.down(a);
    await page.waitForTimeout(b);
    await page.keyboard.up(a);
  } else if (op === 'shot') {
    await page.screenshot({ path: path.join(outDir, a) });
    console.log(`shot ${a} @ ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else if (op === 'waitFor') {
    await page.waitForFunction(a, null, { timeout: b ?? 20000 });
  } else if (op === 'eval') {
    const r = await page.evaluate(a);
    console.log('eval →', JSON.stringify(r));
  }
}
if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
await browser.close();
