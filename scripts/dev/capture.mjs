#!/usr/bin/env node
// Development helper: capture a fixed set of screenshots of the key screens so visual changes
// can be compared run to run. Not part of the shipped game.
//
//   node scripts/dev/capture.mjs <outDir> [baseUrl] [only,comma,separated]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [outDir = 'shots', base = 'http://localhost:5173/', only = ''] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const pick = only ? new Set(only.split(',')) : null;

const ready = 'window.__GLEAMTRAIL__ && window.__GLEAMTRAIL__.ready';
const sceneActive = (k) => `window.__GLEAMTRAIL__ && window.__GLEAMTRAIL__.game.scene.isActive('${k}')`;

/** Each scenario: url query + steps (same vocabulary as drive.mjs). */
const SCENARIOS = [
  { name: 'title', q: '?realtime', steps: [['waitFor', ready, 60000], ['wait', 2500], ['shot', 'title.png']] },
  {
    name: 'select',
    q: '?realtime',
    steps: [['waitFor', ready, 60000], ['wait', 1200], ['key', 'Enter'], ['wait', 1500], ['key', 'Enter'], ['waitFor', sceneActive('CharacterSelect'), 60000], ['wait', 1500], ['key', 'Enter'], ['wait', 1800], ['shot', 'select.png']],
  },
  { name: 'board', q: '?quick&humans=1&seed=21&realtime&noflow&midgame&debug', steps: [['waitFor', sceneActive('BoardUI'), 60000], ['wait', 4000], ['shot', 'board-overview.png']] },
  {
    name: 'turn',
    q: '?quick&humans=1&seed=21&realtime&midgame',
    steps: [['waitFor', sceneActive('BoardUI'), 60000], ['waitFor', 'window.__GLEAMTRAIL__.debug.awaitRoll === true', 120000], ['wait', 1500], ['shot', 'board-turn.png'], ['key', 'Enter'], ['waitFor', 'window.__GLEAMTRAIL__.debug.dialShown === true', 60000], ['wait', 700], ['shot', 'board-dial.png'], ['key', 'Enter'], ['waitFor', 'window.__GLEAMTRAIL__.debug.stepsLeft > 0', 30000], ['wait', 900], ['shot', 'board-move.png']],
  },
  {
    name: 'gleam',
    q: '?minigame=gleam-grab&realtime&instructions=on&seed=11',
    steps: [['waitFor', sceneActive('MinigameIntro'), 60000], ['wait', 5000], ['shot', 'mg-intro.png'], ['key', 'Enter'], ['waitFor', sceneActive('mg-gleam-grab'), 30000], ['waitFor', "(() => { const s = window.__GLEAMTRAIL__ && window.__GLEAMTRAIL__.game.scene.getScene('mg-gleam-grab'); return !!s && s.sys.isActive() && s.elapsed > 6000; })()", 240000], ['down', 'KeyD'], ['wait', 900], ['up', 'KeyD'], ['waitFor', "(() => { const s = window.__GLEAMTRAIL__ && window.__GLEAMTRAIL__.game.scene.getScene('mg-gleam-grab'); return !!s && s.sys.isActive() && s.elapsed > 12000; })()", 240000], ['shot', 'mg-gleam.png']],
  },
  {
    name: 'orbit',
    q: '?minigame=orbit-dodge&realtime&instructions=off&seed=5',
    steps: [['waitFor', sceneActive('mg-orbit-dodge'), 60000], ['waitFor', "(() => { const s = window.__GLEAMTRAIL__ && window.__GLEAMTRAIL__.game.scene.getScene('mg-orbit-dodge'); return !!s && s.sys.isActive() && s.elapsed > 9000; })()", 240000], ['shot', 'mg-orbit.png']],
  },
  {
    name: 'results',
    q: '?minigame=orbit-dodge&realtime&instructions=off&humans=0&seed=5',
    steps: [['waitFor', sceneActive('Results'), 480000], ['waitFor', 'window.__GLEAMTRAIL__.debug.resultsReady === true', 120000], ['wait', 1200], ['shot', 'results.png']],
  },
];

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const t0 = Date.now();
for (const sc of SCENARIOS) {
  if (pick && !pick.has(sc.name)) continue;
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  // Never connect the Vite HMR socket: edits elsewhere in the repo must not reload the page mid-run.
  await page.routeWebSocket(/.*/, () => {});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  try {
    await page.goto(base + sc.q);
    for (const [op, a, b] of sc.steps) {
      if (op === 'wait') await page.waitForTimeout(a);
      else if (op === 'key') await page.keyboard.press(a, { delay: 60 });
      else if (op === 'down') await page.keyboard.down(a);
      else if (op === 'up') await page.keyboard.up(a);
      else if (op === 'waitFor') await page.waitForFunction(a, null, { timeout: b ?? 30000 });
      else if (op === 'shot') {
        await page.screenshot({ path: path.join(outDir, a), timeout: 240000 });
        console.log(`${sc.name}: ${a} @ ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    }
  } catch (e) {
    console.log(`${sc.name}: FAILED ${e.message.split('\n')[0]}`);
  }
  if (errors.length) console.log(`${sc.name} errors:\n  ${errors.slice(0, 5).join('\n  ')}`);
  await page.close();
}
await browser.close();
