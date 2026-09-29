#!/usr/bin/env node
// Development helper for the trailer: render the game's procedural sound effects
// (src/game/audio/sfx.ts) to WAV files with an OfflineAudioContext in a headless browser, so the
// edit can lay the real in-game effects under the footage. Not part of the shipped game.
//
//   node scripts/dev/trailer/sfx_render.mjs <rawDir> <outDir> [sampleRate]
//
// Renders every (key, rate) pair listed in <rawDir>/*/sfx.json (written by scripts/dev/record.mjs)
// as <outDir>/<key>@<rate>.wav (mono, 16-bit), skipping files that already exist. EXTRA_SFX adds
// pairs the edit uses on its own (e.g. EXTRA_SFX=whoosh@1,pop@1.2 for its graphics).
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const [rawDir, outDir, srArg] = process.argv.slice(2);
if (!rawDir || !outDir) {
  console.error('usage: sfx_render.mjs <rawDir> <outDir> [sampleRate]');
  process.exit(1);
}
const SR = Number(srArg) || 48000;
const wanted = new Set();
for (const d of fs.readdirSync(rawDir)) {
  const f = path.join(rawDir, d, 'sfx.json');
  if (!fs.existsSync(f)) continue;
  for (const [, key, rate] of JSON.parse(fs.readFileSync(f, 'utf8')).events) wanted.add(`${key}@${rate}`);
}
for (const item of (process.env.EXTRA_SFX ?? '').split(',').filter(Boolean)) wanted.add(item);
fs.mkdirSync(outDir, { recursive: true });

const bundle = await build({ entryPoints: ['src/game/audio/sfx.ts'], bundle: true, format: 'iife', globalName: 'GT_SFX', write: false, target: 'es2020' });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.addScriptTag({ content: bundle.outputFiles[0].text });

/** 16-bit mono WAV. */
function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return buf;
}

let made = 0;
for (const item of [...wanted].sort()) {
  const out = path.join(outDir, `${item}.wav`);
  if (fs.existsSync(out)) continue;
  const [key, rate] = item.split('@');
  const pcm = await page.evaluate(
    async ([key, rate, SR]) => {
      const ctx = new OfflineAudioContext(1, Math.round(SR * 3.5), SR);
      // the same white-noise source AudioManager builds
      const noise = ctx.createBuffer(1, SR * 2, SR);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const out = ctx.createGain();
      out.connect(ctx.destination);
      window.GT_SFX.SFX[key]({ ctx, out, noise }, 0.005, Number(rate));
      const data = (await ctx.startRendering()).getChannelData(0);
      let end = data.length;
      while (end > 0 && Math.abs(data[end - 1]) < 1e-4) end--;
      return Array.from(data.subarray(0, Math.min(data.length, end + Math.round(SR * 0.02))));
    },
    [key, rate, SR],
  );
  fs.writeFileSync(out, wav(pcm));
  made++;
}
await browser.close();
console.log(`${wanted.size} effects wanted, ${made} rendered into ${outDir}`);
