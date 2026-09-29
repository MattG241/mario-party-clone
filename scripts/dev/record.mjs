#!/usr/bin/env node
// Development helper: record smooth gameplay footage on machines too slow to run the game in real
// time. The page runs normally until the scene of interest is up, then the game loop is stopped
// and driven by hand on a virtual clock (Date.now and performance.now advance exactly one frame
// per step, so Phaser's clock, tweens and timers all agree), and every rendered frame is saved.
// Not part of the shipped game.
//
//   node scripts/dev/record.mjs <scenario.json> <outDir> [baseUrl]
//   SHOTS=a,b   record only these shots        PROBE=1   dry run: no frames, just the logs
//
// A scenario is a list of shots; each shot opens a URL and runs steps:
//   { "name": "orbit", "url": "?minigame=orbit-dodge&humans=0&instructions=off&seed=5",
//     "chars": ["sonic", "goku", "nami", "homer"], "random": 7, "hold": true,
//     "steps": [["waitReal", "window.__launched === true"], ["until", "<js>", 60], ["record", 8]] }
// Shot options: chars (the characters a ?minigame / ?quick launch seats, in slot order); random
// (Math.random is seeded with it when the clock is taken over); hold (stop the game the moment the
// dev launcher starts, waitReal on window.__launched, so the clock is taken over at the same point
// every run); pads (that many fake standard controllers, pressed with the pad step); storage
// (localStorage items to set before the game loads, e.g. settings); quality (JPEG, 0-1). With
// random and hold a run repeats frame for frame: the game's own audio is silenced (its synth
// draws on Math.random on the audio clock), and the clock holds while a scene loads.
// Steps, before the clock is taken over (real time): waitReal "<js>" [ms], wait ms, keyUntil key
// "<js>" (press until the condition holds: on software GL a quick tap can fall between frames).
// Steps on the virtual clock (the first of these takes the clock over): skip seconds (advance
// without saving frames), until "<js>" maxSeconds [record] (advance until the condition holds),
// record seconds, key name (press and release, not recorded), press name (press and release while
// recording), hold name seconds [record], down/up name, pad controller button [record] (a
// two-frame press of a fake controller's button: A, B, X, Y, UP, DOWN, LEFT, RIGHT...), eval
// "<js>" (run in the page, e.g. to hide UI that should not be in the shot), seed n (reseed
// Math.random now), mark label, watch "<js>" (log each change of the value, with its frame), snap
// label (save one still, not part of the footage).
// Frames are written as <outDir>/<name>/f00000.jpg at 30 fps, with sfx.json listing the sound
// effects the game played during them ([frame index, key, rate, volume]) and log.json with every
// effect, mark and watched value since the clock was taken over (frame = frames since then; rec =
// the recorded frame index at that moment), so a dry run (PROBE=1) finds the moments to record.
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
/** W3C standard-mapping button indices, for the fake controllers' "pad" step. */
const PAD_BUTTONS = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const PROBE = !!process.env.PROBE;
const shots = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
const only = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

/**
 * Runs before the game's own scripts: a seedable Math.random; storage items written to
 * localStorage (e.g. settings); pads fake standard-mapping controllers the recorder can press
 * (window.__pad); with chars, the dev launcher's seating swapped for the shot's cast; with hold,
 * the game loop stops the moment the dev launcher starts (window.__launched), so the clock is taken
 * over at the same point on every run however slowly the page loaded.
 */
function pageSetup({ seed, chars, hold, pads, storage }) {
  if (storage) for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  if (pads) {
    const list = Array.from({ length: pads }, (_, index) => ({
      index,
      id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)',
      mapping: 'standard',
      connected: true,
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    }));
    navigator.getGamepads = () => list;
    window.__pad = (i, b, down) => {
      const btn = list[i].buttons[b];
      btn.pressed = btn.touched = down;
      btn.value = down ? 1 : 0;
      list[i].timestamp++;
    };
  }
  window.__seedRandom = (s) => {
    // mulberry32
    let a = s >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  if (seed != null) window.__seedRandom(seed);
  if (!chars && !hold) return;
  const patch = () => {
    const game = window.__GLEAMTRAIL__?.game;
    const launcher = game?.scene?.getScene?.('DevLaunch');
    if (!launcher) return setTimeout(patch, 5);
    if (chars) {
      const seat = launcher.participants.bind(launcher);
      launcher.participants = () => {
        const parts = seat();
        const slots = window.__GLEAMTRAIL__.session.slots;
        parts.forEach((p, i) => {
          if (!chars[i]) return;
          p.characterId = chars[i];
          slots[p.slot].characterId = chars[i];
        });
        return parts;
      };
    }
    if (hold) {
      const create = launcher.create.bind(launcher);
      launcher.create = () => {
        create();
        game.loop.sleep();
        window.__launched = true;
      };
    }
  };
  patch();
}

/** Installed in the page when the clock is taken over: stops the loop and takes over time. */
function takeOver() {
  const g = window.__GLEAMTRAIL__.game;
  g.loop.sleep();
  const realPerf = performance.now.bind(performance);
  // Whole milliseconds throughout (frames of 33, 33 and 34 ms), so the clocks' sums and differences
  // are exact and a run repeats to the frame whatever time it started at.
  const vt0 = Math.round(realPerf());
  let vt = vt0;
  const dateBase = Math.round(Date.now()) - vt;
  performance.now = () => vt;
  Date.now = () => dateBase + vt;
  const canvas = g.canvas;
  // Between frames the page gets a turn of its event loop, as it would between animation frames:
  // promise continuations (the board's turn flow) and loader callbacks run before the next step.
  const chan = new MessageChannel();
  let wake = null;
  chan.port1.onmessage = () => {
    const w = wake;
    wake = null;
    if (w) w();
  };
  const yieldTurn = () =>
    new Promise((r) => {
      wake = r;
      chan.port2.postMessage(0);
    });
  const log = { sfx: [], marks: [], watch: [] };
  // Log the game's sound effects against the recorded frames (sfx.json next to the frames), so
  // the edit can lay the real effects under the footage. Mirrors AudioManager's throttle. The game
  // itself goes quiet: its synth voices and music scheduler draw on Math.random on the audio
  // clock (real time), which would make a seeded run differ from one run to the next.
  const sfx = [];
  const lastPlayed = new Map();
  const au = window.__GLEAMTRAIL__.audio;
  if (au) {
    au.stopMusic?.(0);
    au.playMusic = () => {};
    au.play = (key, opts = {}) => {
      const last = lastPlayed.get(key) ?? -1e9;
      if (vt - last >= (opts.throttleMs ?? 28)) {
        lastPlayed.set(key, vt);
        const rate = opts.rate ?? 1;
        const vol = opts.volume ?? 1;
        // A sound played between frames (the board's turn flow continues in promise callbacks after
        // a frame's step) belongs to the frame just drawn.
        const idx = rec.recording ? rec.saved : rec.justSaved ? rec.saved - 1 : null;
        if (idx !== null) sfx.push([idx, key, rate, vol]);
        log.sfx.push([rec.frames, idx, key, Math.round(rate * 1000) / 1000, Math.round(vol * 1000) / 1000]);
      }
    };
  }
  /** Update-only step: everything a frame does except drawing (cameras still follow and settle). */
  const stepNoRender = (dt) => {
    g.events.emit('prestep', vt, dt);
    g.events.emit('step', vt, dt);
    g.scene.update(vt, dt);
    g.events.emit('poststep', vt, dt);
    for (const s of g.scene.scenes) {
      const st = s.sys.settings;
      if (!st.visible || st.status < 3 || st.status >= 7) continue; // the scenes a render would draw
      for (const cam of s.cameras.cameras) if (cam.visible && cam.alpha > 0) cam.preRender();
    }
    // SceneManager.render() is what clears this; left set, a scene op queued while processing
    // (e.g. bringToTop) re-queues itself forever on the next frame.
    g.scene.isProcessing = false;
  };
  const rec = {
    sfx,
    log,
    saved: 0,
    /** The last step drew a recorded frame (see the sound log above). */
    justSaved: false,
    frames: 0,
    recording: false,
    watchExpr: null,
    watchLast: undefined,
    check(expr) {
      try {
        return !!(0, eval)(expr);
      } catch {
        return false;
      }
    },
    watchTick() {
      if (!this.watchExpr) return;
      let v;
      try {
        v = JSON.stringify((0, eval)(this.watchExpr));
      } catch (e) {
        v = `!${e.message}`;
      }
      if (v !== this.watchLast) {
        this.watchLast = v;
        log.watch.push([this.frames, this.recording ? this.saved : null, v]);
      }
    },
    one(_dt, render) {
      this.justSaved = false;
      const next = vt0 + Math.round(((this.frames + 1) * 1000) / 30);
      const dt = next - vt;
      vt = next;
      g.loop.time = vt;
      g.loop.now = vt;
      g.loop.delta = dt;
      g.loop.rawDelta = dt;
      if (render) g.step(vt, dt);
      else stepNoRender(dt);
      this.frames++;
      this.watchTick();
    },
    /**
     * Hold the clock while any scene is loading (a minigame's arena, say): loading takes however
     * long it takes in real time, and letting game time run meanwhile would make every run differ.
     */
    async settle() {
      const busy = () => g.scene.scenes.some((s) => s.sys.settings.status === 3 || (s.load && s.load.isLoading()));
      for (let i = 0; i < 6000 && busy(); i++) await new Promise((r) => setTimeout(r, 5));
    },
    /** Advance n frames, yielding between them; draw only the last when asked (drawing is the slow part). */
    async advance(n, dt, renderLast) {
      for (let i = 0; i < n; i++) {
        await this.settle();
        this.one(dt, renderLast && i === n - 1);
        await yieldTurn();
      }
    },
    /** Advance until the condition holds (checked every frame) or max frames; returns frames advanced. */
    async until(expr, max, dt) {
      let n = 0;
      while (n < max && !this.check(expr)) {
        await this.settle();
        this.one(dt, false);
        await yieldTurn();
        n++;
      }
      return n;
    },
    /** Step one frame, draw it and return it as a JPEG data URL (read before the frame is presented). */
    async frame(dt, q) {
      await this.settle();
      this.recording = true;
      this.one(dt, true);
      this.recording = false;
      this.saved++;
      this.justSaved = true;
      return canvas.toDataURL('image/jpeg', q);
    },
    /** A dry run's stand-in for frame(): counts as recorded, draws nothing. */
    async dry(n, dt) {
      for (let i = 0; i < n; i++) {
        await this.settle();
        this.recording = true;
        this.one(dt, false);
        this.recording = false;
        this.saved++;
        this.justSaved = true;
        await yieldTurn();
      }
    },
    /** Draw the current state without advancing the game (for stills). */
    still(q) {
      const r = g.renderer;
      r.preRender();
      g.scene.render(r);
      r.postRender();
      return canvas.toDataURL('image/jpeg', q);
    },
  };
  window.__rec = rec;
  /** Visible texts at or above a font size, across every running scene (for watching call-outs). */
  window.__texts = (min = 40) => {
    const out = [];
    const walk = (o, vis) => {
      if (!o || !o.active) return;
      const v = vis && o.visible !== false && (o.alpha ?? 1) > 0.05;
      if (o.type === 'Text' && v && parseFloat(o.style?.fontSize) >= min && o.text) out.push(o.text);
      if (o.list) for (const c of o.list) walk(c, v);
    };
    for (const s of g.scene.scenes) {
      const st = s.sys.settings;
      if (!st.visible || st.status < 3 || st.status >= 7) continue;
      for (const o of s.children.list) walk(o, true);
    }
    return out.join(' | ');
  };
}

const t0 = Date.now();
for (const shot of shots) {
  if (only && !only.has(shot.name)) continue;
  const dir = path.join(outDir, shot.name);
  if (!PROBE) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.routeWebSocket(/.*/, () => {});
  await page.addInitScript(pageSetup, { seed: shot.random ?? null, chars: shot.chars ?? null, hold: !!shot.hold, pads: shot.pads ?? 0, storage: shot.storage ?? null });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let frameNo = 0;
  let owned = false;
  const q = shot.quality ?? 0.93;
  const own = async () => {
    if (owned) return;
    await page.evaluate(takeOver);
    owned = true;
    // From here on every run repeats exactly (with hold, the take-over point is fixed too).
    if (shot.random != null) {
      await page.evaluate((s) => {
        window.__seedRandom(s);
        window.__rec.log.marks.push([0, 0, 'seed']);
      }, shot.random);
    }
  };
  const advance = async (frames, renderLast = true) => {
    await own();
    let left = frames;
    while (left > 0) {
      const n = Math.min(8, left);
      await page.evaluate(([k, dt, r]) => window.__rec.advance(k, dt, r), [n, DT, renderLast && !PROBE && n === left]);
      left -= n;
    }
  };
  const record = async (frames) => {
    await own();
    if (PROBE) {
      // A dry run keeps the recorded-frame count honest without drawing anything.
      await page.evaluate(([k, dt]) => window.__rec.dry(k, dt), [frames, DT]);
      frameNo += frames;
      return;
    }
    for (let i = 0; i < frames; i++) {
      const url = await page.evaluate(([dt, qq]) => window.__rec.frame(dt, qq), [DT, q]);
      fs.writeFileSync(path.join(dir, `f${String(frameNo++).padStart(5, '0')}.jpg`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
  };
  const keyUntil = async (key, cond, tries = 8) => {
    for (let i = 0; i < tries; i++) {
      if (owned) {
        await page.keyboard.down(key);
        await advance(3, false);
        await page.keyboard.up(key);
        const n = await page.evaluate(([c, dt]) => window.__rec.until(c, 45, dt), [cond, DT]);
        if (n < 45) return;
      } else {
        await page.keyboard.press(key, { delay: 60 });
        try {
          await page.waitForFunction(cond, null, { timeout: 5000 });
          return;
        } catch {
          // not yet: press again
        }
      }
    }
    throw new Error(`pressing ${key} never reached: ${cond}`);
  };
  try {
    await page.goto(base + shot.url);
    for (const [op, a, b, c] of shot.steps) {
      if (op === 'waitReal') await page.waitForFunction(a, null, { timeout: b ?? 90000 });
      else if (op === 'wait') await page.waitForTimeout(a);
      else if (op === 'keyUntil') await keyUntil(a, b, c);
      else if (op === 'skip') await advance(Math.round(a * FPS));
      else if (op === 'until') {
        await own();
        const max = Math.round((b ?? 60) * FPS);
        let n = 0;
        if (c) {
          while (n < max && !(await page.evaluate((e) => window.__rec.check(e), a))) {
            await record(1);
            n++;
          }
        } else {
          n = await page.evaluate(([e, m, dt]) => window.__rec.until(e, m, dt), [a, max, DT]);
        }
        if (n >= max) console.log(`${shot.name}: until timed out: ${a}`);
      } else if (op === 'record') await record(Math.round(a * FPS));
      else if (op === 'key') {
        await page.keyboard.down(a);
        if (owned) await advance(3, false);
        else await page.waitForTimeout(120);
        await page.keyboard.up(a);
      } else if (op === 'press') {
        await page.keyboard.down(a);
        await record(2);
        await page.keyboard.up(a);
      } else if (op === 'hold') {
        await page.keyboard.down(a);
        if (c) await record(Math.round(b * FPS));
        else await advance(Math.round(b * FPS), false);
        await page.keyboard.up(a);
      } else if (op === 'pad') {
        // ["pad", controller, button, record?]: a two-frame press of a fake controller's button
        const btn = typeof b === 'number' ? b : PAD_BUTTONS[b];
        await page.evaluate(([i, k]) => window.__pad(i, k, true), [a, btn]);
        if (c) await record(2);
        else await advance(2, false);
        await page.evaluate(([i, k]) => window.__pad(i, k, false), [a, btn]);
      } else if (op === 'eval') await page.evaluate(a);
      else if (op === 'down') await page.keyboard.down(a);
      else if (op === 'up') await page.keyboard.up(a);
      else if (op === 'seed') {
        await own();
        await page.evaluate((s) => {
          window.__seedRandom(s);
          window.__rec.log.marks.push([window.__rec.frames, window.__rec.saved, 'seed']);
        }, a);
      } else if (op === 'mark') {
        await own();
        await page.evaluate((l) => window.__rec.log.marks.push([window.__rec.frames, window.__rec.saved, l]), a);
      } else if (op === 'watch') {
        await own();
        await page.evaluate((e) => {
          window.__rec.watchExpr = e;
          window.__rec.watchLast = undefined;
          window.__rec.watchTick();
        }, a);
      } else if (op === 'snap') {
        await own();
        const url = await page.evaluate((qq) => window.__rec.still(qq), q);
        fs.writeFileSync(path.join(dir, `snap_${a}.jpg`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      }
    }
    if (owned) {
      const { sfx, log } = await page.evaluate(() => ({ sfx: window.__rec.sfx, log: window.__rec.log }));
      if (!PROBE) fs.writeFileSync(path.join(dir, 'sfx.json'), JSON.stringify({ fps: FPS, events: sfx }));
      fs.writeFileSync(path.join(dir, PROBE ? 'probe.json' : 'log.json'), JSON.stringify({ fps: FPS, ...log }));
    }
    console.log(`${shot.name}: ${frameNo} frames @ ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } catch (e) {
    console.log(`${shot.name}: FAILED after ${frameNo} frames: ${e.message.split('\n')[0]}`);
    if (owned) {
      try {
        const { log } = await page.evaluate(() => ({ log: window.__rec.log }));
        fs.writeFileSync(path.join(dir, PROBE ? 'probe.json' : 'log.json'), JSON.stringify({ fps: FPS, ...log }));
      } catch {
        // the page is gone
      }
    }
  }
  if (errors.length) console.log(`${shot.name} errors:\n  ${errors.slice(0, 5).join('\n  ')}`);
  await page.close();
}
await browser.close();
