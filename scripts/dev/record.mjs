#!/usr/bin/env node
// Development helper: record smooth gameplay footage on machines too slow to run the game in real
// time. The page runs normally until the scene of interest is up, then the game loop is stopped
// and driven by hand on a virtual clock (Date.now and performance.now advance exactly one frame
// per step, so Phaser's clock, tweens and timers all agree), and every rendered frame is saved.
// Not part of the shipped game.
//
//   node scripts/dev/record.mjs <scenario.json> <outDir> [baseUrl]
//
// A scenario is a list of shots; each shot opens a URL and runs steps:
//   { "name": "orbit", "url": "?minigame=orbit-dodge&humans=0&instructions=off&seed=5",
//     "steps": [["waitReal", "<js condition>", 90000], ["skip", 3], ["record", 8], ["key", "Enter"]] }
// Steps: waitReal (real-time wait for a condition, before the clock is taken over), skip seconds
// (advance without saving frames), until "<js>" maxSeconds [record] (advance until the condition
// holds), record seconds, key name (press and release, not recorded), press name (press and
// release while recording), down/up name, wait ms (real time), eval "<js>" (run in the page, e.g.
// to hide UI that should not be in the shot).
// Frames are written as <outDir>/<name>/f00000.jpg at 30 fps.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [scenarioPath, outDir, base = 'http://localhost:4173/'] = process.argv.slice(2);
if (!scenarioPath || !outDir) {
  console.error('usage: record.mjs <scenario.json> <outDir> [baseUrl]');
  process.exit(1);
}
const FPS = 30;
const DT = 1000 / FPS;
const shots = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
const only = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

/** Installed in the page once the scene of interest is up: stops the loop and takes over time. */
function takeOver() {
  const g = window.__GLEAMTRAIL__.game;
  g.loop.sleep();
  const realPerf = performance.now.bind(performance);
  let vt = realPerf();
  const dateBase = Date.now() - vt;
  performance.now = () => vt;
  Date.now = () => dateBase + vt;
  const canvas = g.canvas;
  window.__rec = {
    /** Advance n frames; render only the last (rendering is the slow part). */
    advance(n, dt, render) {
      for (let i = 0; i < n; i++) {
        vt += dt;
        g.loop.time = vt;
        g.loop.now = vt;
        g.loop.delta = dt;
        g.loop.rawDelta = dt;
        if (render && i === n - 1) {
          g.step(vt, dt);
        } else {
          g.events.emit('prestep', vt, dt);
          g.events.emit('step', vt, dt);
          g.scene.update(vt, dt);
          g.events.emit('poststep', vt, dt);
        }
      }
    },
    /** Step one frame, render it and return it as a JPEG data URL (read before the frame is presented). */
    frame(dt, q) {
      this.advance(1, dt, true);
      return canvas.toDataURL('image/jpeg', q);
    },
    check(expr) {
      try {
        return !!(0, eval)(expr);
      } catch {
        return false;
      }
    },
  };
}

const t0 = Date.now();
for (const shot of shots) {
  if (only && !only.has(shot.name)) continue;
  const dir = path.join(outDir, shot.name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.routeWebSocket(/.*/, () => {});
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let frameNo = 0;
  let owned = false;
  const own = async () => {
    if (owned) return;
    await page.evaluate(takeOver);
    owned = true;
  };
  const record = async (frames) => {
    await own();
    for (let i = 0; i < frames; i++) {
      const url = await page.evaluate(([dt, q]) => window.__rec.frame(dt, q), [DT, shot.quality ?? 0.93]);
      fs.writeFileSync(path.join(dir, `f${String(frameNo++).padStart(5, '0')}.jpg`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
  };
  try {
    await page.goto(base + shot.url);
    for (const [op, a, b, c] of shot.steps) {
      if (op === 'waitReal') await page.waitForFunction(a, null, { timeout: b ?? 90000 });
      else if (op === 'wait') await page.waitForTimeout(a);
      else if (op === 'skip') {
        await own();
        // advance in chunks of a few frames per round trip, rendering once per chunk
        let left = Math.round(a * FPS);
        while (left > 0) {
          const n = Math.min(8, left);
          await page.evaluate(([k, dt]) => window.__rec.advance(k, dt, true), [n, DT]);
          left -= n;
        }
      } else if (op === 'until') {
        await own();
        const max = Math.round((b ?? 60) * FPS);
        let n = 0;
        while (n < max && !(await page.evaluate((e) => window.__rec.check(e), a))) {
          if (c) await record(1);
          else await page.evaluate((dt) => window.__rec.advance(4, dt, true), DT);
          n += c ? 1 : 4;
        }
        if (n >= max) console.log(`${shot.name}: until timed out: ${a}`);
      } else if (op === 'record') await record(Math.round(a * FPS));
      else if (op === 'key') {
        await page.keyboard.down(a);
        if (owned) await page.evaluate((dt) => window.__rec.advance(3, dt, true), DT);
        else await page.waitForTimeout(120);
        await page.keyboard.up(a);
      } else if (op === 'press') {
        await page.keyboard.down(a);
        await record(2);
        await page.keyboard.up(a);
      } else if (op === 'eval') await page.evaluate(a);
      else if (op === 'down') await page.keyboard.down(a);
      else if (op === 'up') await page.keyboard.up(a);
    }
    console.log(`${shot.name}: ${frameNo} frames @ ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } catch (e) {
    console.log(`${shot.name}: FAILED after ${frameNo} frames: ${e.message.split('\n')[0]}`);
  }
  if (errors.length) console.log(`${shot.name} errors:\n  ${errors.slice(0, 5).join('\n  ')}`);
  await page.close();
}
await browser.close();
