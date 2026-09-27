#!/usr/bin/env node
// Generates Gleamtrail's placeholder artwork as SVG files under public/assets/placeholders/.
//
// Everything here is original, simple geometric art in the Gleamtrail palette (teal, cream,
// gold, cyan, purple, wood, stone, crystal) built around spiral motifs. Each file can be
// replaced by painted artwork later: keep the file name (or update src/game/data/assets.ts).
//
// Run with:  npm run placeholders
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/assets/placeholders');

// ---------------------------------------------------------------------------------------------
// Palette
const C = {
  cream: '#fff4dc',
  creamDark: '#f2e2bf',
  teal: '#1fa5a0',
  tealDark: '#117a77',
  tealDeep: '#0d4f57',
  gold: '#f4b83b',
  goldLight: '#ffe08a',
  goldDark: '#c98a1b',
  crystal: '#5ce1ff',
  crystalLight: '#c8f6ff',
  purple: '#8e5cd9',
  purpleLight: '#c49bff',
  purpleDark: '#5e3494',
  wood: '#9a6334',
  woodLight: '#c98b50',
  woodDark: '#5f3b1c',
  stone: '#9c9a92',
  stoneLight: '#c9c6bb',
  stoneDark: '#5f5c56',
  grass: '#6cc24a',
  grassLight: '#a8e27a',
  grassDark: '#3f8f3a',
  coral: '#ff6b5e',
  ink: '#2b2340',
};

// ---------------------------------------------------------------------------------------------
// Helpers
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n) => Number(n.toFixed(1));

function svg(w, h, body, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>\n`;
}
function linear(id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) {
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops
    .map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`)
    .join('')}</linearGradient>`;
}
function radial(id, stops, cx = 0.5, cy = 0.5, r = 0.5) {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops
    .map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`)
    .join('')}</radialGradient>`;
}
/** Archimedean spiral as an SVG path. */
function spiral(cx, cy, r0, r1, turns, steps = 80, start = 0) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + t * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`;
  }
  return d;
}
/** Smooth closed path through points (Catmull-Rom → cubic Bézier). */
function smoothClosed(pts) {
  const n = pts.length;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}
function smoothOpen(pts) {
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}
function poly(pts) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join('') + 'Z';
}
function hexagon(cx, cy, r, rot = 0) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = rot + (i * Math.PI) / 3;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return poly(pts);
}
function crystalShard(x, y, w, h, color, light) {
  // A tall hexagonal crystal pointing up from (x, y).
  const body = poly([
    [x - w / 2, y],
    [x - w / 2, y - h * 0.7],
    [x, y - h],
    [x + w / 2, y - h * 0.7],
    [x + w / 2, y],
  ]);
  const facet = poly([
    [x, y],
    [x, y - h],
    [x + w / 2, y - h * 0.7],
    [x + w / 2, y],
  ]);
  return `<path d="${body}" fill="${color}"/><path d="${facet}" fill="${light}" opacity="0.55"/><path d="${body}" fill="none" stroke="${C.ink}" stroke-opacity="0.35" stroke-width="2"/>`;
}

const files = {};
const put = (rel, content) => {
  files[rel] = content;
};

// ---------------------------------------------------------------------------------------------
// Backgrounds
put(
  'bg/sky.svg',
  (() => {
    const W = 1920;
    const H = 1080;
    const defs =
      linear('sky', [
        [0, '#23407e'],
        [0.45, '#5d8fc9'],
        [0.78, '#f6c79a'],
        [1, '#ffe7b8'],
      ]) +
      radial('sun', [
        [0, '#fff8e0', 1],
        [0.35, '#ffe2a0', 0.85],
        [1, '#ffd08a', 0],
      ]);
    let rays = '';
    for (let i = 0; i < 18; i++) {
      const a0 = (i / 18) * Math.PI * 2;
      const a1 = a0 + 0.08;
      rays += `<path d="M1420 300L${f(1420 + Math.cos(a0) * 1400)} ${f(300 + Math.sin(a0) * 1400)}L${f(1420 + Math.cos(a1) * 1400)} ${f(300 + Math.sin(a1) * 1400)}Z" fill="#fff3cf" opacity="0.07"/>`;
    }
    let stars = '';
    const r = rng(7);
    for (let i = 0; i < 70; i++) {
      stars += `<circle cx="${f(r() * W)}" cy="${f(r() * H * 0.35)}" r="${f(1 + r() * 2.2)}" fill="#ffffff" opacity="${f(0.25 + r() * 0.5)}"/>`;
    }
    const spiralSun = `<path d="${spiral(1420, 300, 6, 120, 3.2, 140)}" fill="none" stroke="#fff6da" stroke-width="10" stroke-linecap="round" opacity="0.55"/>`;
    return svg(
      W,
      H,
      `<rect width="${W}" height="${H}" fill="url(#sky)"/>${stars}${rays}<circle cx="1420" cy="300" r="420" fill="url(#sun)"/>${spiralSun}`,
      defs,
    );
  })(),
);

function cloudBank(W, H, seed, color, opacity, count, yMin, yMax, rMin, rMax) {
  const r = rng(seed);
  let body = '';
  for (let i = 0; i < count; i++) {
    const cx = r() * W;
    const cy = yMin + r() * (yMax - yMin);
    const rr = rMin + r() * (rMax - rMin);
    body += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rr * 1.6)}" ry="${f(rr)}" fill="${color}" opacity="${opacity}"/>`;
    // Wrap around horizontally so the texture tiles.
    if (cx < rr * 1.6) body += `<ellipse cx="${f(cx + W)}" cy="${f(cy)}" rx="${f(rr * 1.6)}" ry="${f(rr)}" fill="${color}" opacity="${opacity}"/>`;
    if (cx > W - rr * 1.6) body += `<ellipse cx="${f(cx - W)}" cy="${f(cy)}" rx="${f(rr * 1.6)}" ry="${f(rr)}" fill="${color}" opacity="${opacity}"/>`;
  }
  return body;
}
put(
  'bg/clouds_far.svg',
  svg(2048, 420, cloudBank(2048, 420, 11, '#ffffff', 0.18, 46, 150, 330, 40, 110) + cloudBank(2048, 420, 12, '#ffe3f0', 0.16, 30, 200, 360, 30, 80)),
);
put(
  'bg/clouds_below.svg',
  (() => {
    const W = 2048;
    const H = 560;
    const defs = linear('fade', [
      [0, '#ffffff', 0],
      [0.35, '#ffffff', 0.85],
      [1, '#e9f1ff', 1],
    ]);
    return svg(
      W,
      H,
      `<rect y="200" width="${W}" height="${H - 200}" fill="url(#fade)"/>` +
        cloudBank(W, H, 21, '#ffffff', 0.9, 60, 120, 330, 50, 120) +
        cloudBank(W, H, 22, '#f3ecff', 0.8, 50, 220, 420, 50, 110) +
        cloudBank(W, H, 23, '#ffffff', 0.95, 40, 330, 520, 60, 130),
      defs,
    );
  })(),
);
put(
  'bg/islands_far.svg',
  (() => {
    const W = 2048;
    const H = 640;
    const r = rng(31);
    let body = '';
    for (let i = 0; i < 9; i++) {
      const cx = 80 + i * 230 + r() * 60;
      const cy = 240 + r() * 220;
      const w = 90 + r() * 140;
      const h = w * (0.5 + r() * 0.3);
      const col = i % 2 ? '#6f7fb8' : '#8190c4';
      body += `<path d="M${f(cx - w)} ${f(cy)}Q${f(cx)} ${f(cy - h * 0.35)} ${f(cx + w)} ${f(cy)}L${f(cx + w * 0.15)} ${f(cy + h)}Z" fill="${col}" opacity="0.55"/>`;
      body += `<ellipse cx="${f(cx)}" cy="${f(cy - 4)}" rx="${f(w)}" ry="${f(h * 0.18)}" fill="#95c7a2" opacity="0.5"/>`;
      for (let t = 0; t < 3; t++) {
        const tx = cx - w * 0.6 + r() * w * 1.2;
        body += `<circle cx="${f(tx)}" cy="${f(cy - 18 - r() * 12)}" r="${f(10 + r() * 12)}" fill="#7fb58f" opacity="0.5"/>`;
      }
    }
    return svg(W, H, body);
  })(),
);

// ---------------------------------------------------------------------------------------------
// Floating islands (procedural, seeded)
function island(W, H, seed, opts = {}) {
  const r = rng(seed);
  const topH = H * (opts.topRatio ?? 0.42);
  const cx = W / 2;
  const cy = topH / 2 + 8;
  const rx = W / 2 - 16;
  const ry = topH / 2 - 10;
  const n = 20;
  // Irregular grass top.
  const top = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.92 + r() * 0.1;
    top.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  // Front edge (lower half of the outline, left → right).
  const front = [];
  for (let i = 0; i <= n / 2; i++) front.push(top[(n / 2 - i + n) % n]);
  front.reverse();
  const frontLR = front.slice().sort((a, b) => a[0] - b[0]);
  const cliffH = H * 0.13;
  const uid = `i${seed}`;
  const defs =
    linear(`${uid}g`, [
      [0, C.grassLight],
      [0.5, C.grass],
      [1, C.grassDark],
    ]) +
    linear(`${uid}c`, [
      [0, '#b0875a'],
      [1, '#7a5634'],
    ]) +
    linear(`${uid}u`, [
      [0, '#7d5c3e'],
      [0.35, '#6b5a57'],
      [1, '#3f3d58'],
    ]) +
    radial(`${uid}glow`, [
      [0, C.crystal, 0.55],
      [1, C.crystal, 0],
    ]);
  let body = '';
  // Underside: a tapering rock "root" hanging below the cliff.
  const left = frontLR[0];
  const right = frontLR[frontLR.length - 1];
  const baseY = cy + cliffH;
  const tipX = cx + (r() - 0.5) * W * 0.12;
  const tipY = H - 8;
  const under = [
    [left[0] + 6, left[1] + cliffH - 4],
    ...frontLR.map((p) => [p[0], p[1] + cliffH - 2]),
    [right[0] - 6, right[1] + cliffH - 4],
    [cx + W * 0.34, baseY + (tipY - baseY) * 0.22 + r() * 10],
    [cx + W * 0.2, baseY + (tipY - baseY) * 0.5 + r() * 14],
    [tipX + W * 0.07, baseY + (tipY - baseY) * 0.78],
    [tipX, tipY],
    [tipX - W * 0.08, baseY + (tipY - baseY) * 0.74],
    [cx - W * 0.22, baseY + (tipY - baseY) * 0.46 + r() * 14],
    [cx - W * 0.35, baseY + (tipY - baseY) * 0.2 + r() * 10],
  ];
  body += `<path d="${smoothClosed(under)}" fill="url(#${uid}u)"/>`;
  // Strata bands across the underside.
  for (let i = 1; i <= 4; i++) {
    const y = baseY + (tipY - baseY) * (i * 0.17);
    const half = W * 0.38 * (1 - i * 0.2);
    body += `<path d="M${f(cx - half)} ${f(y)}Q${f(cx)} ${f(y + 18)} ${f(cx + half)} ${f(y - 4)}" stroke="#2c2640" stroke-opacity="0.22" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  }
  // Embedded stones
  for (let i = 0; i < 6; i++) {
    const t = 0.1 + r() * 0.55;
    const y = baseY + (tipY - baseY) * t;
    const half = W * 0.34 * (1 - t);
    const x = cx - half + r() * half * 2;
    const s = 8 + r() * 14;
    body += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(s * 1.3)}" ry="${f(s)}" fill="#8d8a86" opacity="0.55"/><ellipse cx="${f(x - s * 0.3)}" cy="${f(y - s * 0.3)}" rx="${f(s * 0.5)}" ry="${f(s * 0.35)}" fill="#c9c6bb" opacity="0.45"/>`;
  }
  // Glowing crystal clusters
  const nCr = opts.crystals ?? 3;
  for (let i = 0; i < nCr; i++) {
    const t = 0.25 + r() * 0.45;
    const y = baseY + (tipY - baseY) * t;
    const half = W * 0.3 * (1 - t);
    const x = cx - half + r() * half * 2;
    const ch = 26 + r() * 34;
    const purple = r() > 0.55;
    body += `<circle cx="${f(x)}" cy="${f(y + ch * 0.4)}" r="${f(ch * 0.9)}" fill="url(#${uid}glow)"/>`;
    body += `<g transform="rotate(${f(180 + (r() - 0.5) * 30)} ${f(x)} ${f(y)})">${crystalShard(x, y, ch * 0.42, ch, purple ? C.purpleLight : C.crystal, '#ffffff')}${crystalShard(x + ch * 0.3, y, ch * 0.28, ch * 0.62, purple ? C.crystal : C.purpleLight, '#ffffff')}</g>`;
  }
  // Dangling roots
  for (let i = 0; i < 6; i++) {
    const x0 = left[0] + 30 + r() * (right[0] - left[0] - 60);
    const y0 = baseY + 6 + r() * 20;
    const len = 50 + r() * 110;
    const sway = (r() - 0.5) * 50;
    body += `<path d="M${f(x0)} ${f(y0)}c${f(sway * 0.3)} ${f(len * 0.35)} ${f(sway)} ${f(len * 0.6)} ${f(sway * 0.6)} ${f(len)}" stroke="#5a3d22" stroke-width="${f(3 + r() * 4)}" stroke-linecap="round" fill="none" opacity="0.85"/>`;
    if (r() > 0.5) body += `<circle cx="${f(x0 + sway * 0.6)}" cy="${f(y0 + len)}" r="4" fill="${C.grassLight}" opacity="0.9"/>`;
  }
  // Cliff band (earth) with a slightly wavy bottom edge.
  const cliffTop = frontLR;
  const cliffBottom = frontLR.map((p, i) => [p[0], p[1] + cliffH + (i % 2 ? 4 : -2)]).reverse();
  body += `<path d="${poly([...cliffTop, ...cliffBottom])}" fill="url(#${uid}c)"/>`;
  body += `<path d="${smoothOpen(frontLR.map((p) => [p[0], p[1] + cliffH * 0.55]))}" stroke="#5f3f24" stroke-opacity="0.4" stroke-width="4" fill="none"/>`;
  for (let i = 0; i < 7; i++) {
    const p = frontLR[1 + Math.floor(r() * (frontLR.length - 2))];
    body += `<ellipse cx="${f(p[0] + (r() - 0.5) * 20)}" cy="${f(p[1] + cliffH * (0.3 + r() * 0.5))}" rx="${f(6 + r() * 8)}" ry="${f(4 + r() * 5)}" fill="#c9a87a" opacity="0.6"/>`;
  }
  // Grass top
  body += `<path d="${smoothClosed(top)}" fill="url(#${uid}g)"/>`;
  body += `<path d="${smoothClosed(top.map((p) => [cx + (p[0] - cx) * 0.9, cy + (p[1] - cy) * 0.86 - 4]))}" fill="${C.grassLight}" opacity="0.28"/>`;
  body += `<path d="${smoothClosed(top)}" fill="none" stroke="#3a7d2e" stroke-width="4" stroke-opacity="0.55"/>`;
  // Grass lip hanging over the cliff
  body += `<path d="${smoothOpen(frontLR.map((p, i) => [p[0], p[1] + 6 + (i % 2) * 7]))}" stroke="${C.grassDark}" stroke-width="12" stroke-linecap="round" fill="none"/>`;
  for (let i = 0; i < frontLR.length - 1; i += 2) {
    const p = frontLR[i];
    body += `<path d="M${f(p[0])} ${f(p[1] + 8)}q4 ${f(10 + r() * 14)} 1 ${f(20 + r() * 18)}" stroke="${C.grassDark}" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.85"/>`;
  }
  // Tufts, flowers and pebbles on top
  for (let i = 0; i < (opts.tufts ?? 14); i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.8;
    const x = cx + Math.cos(a) * rx * d;
    const y = cy + Math.sin(a) * ry * d;
    body += `<path d="M${f(x - 8)} ${f(y)}l4 -12l4 12l4 -10l3 10" stroke="${C.grassDark}" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.6"/>`;
    const roll = r();
    if (roll > 0.6) {
      const col = [C.coral, C.goldLight, C.purpleLight, '#ffffff'][(r() * 4) | 0];
      body += `<circle cx="${f(x + 10)}" cy="${f(y - 4)}" r="4.5" fill="${col}"/><circle cx="${f(x + 10)}" cy="${f(y - 4)}" r="1.8" fill="${C.goldLight}"/>`;
    } else if (roll < 0.15) {
      body += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="9" ry="6" fill="${C.stone}"/><ellipse cx="${f(x - 2)}" cy="${f(y - 2)}" rx="4" ry="2.5" fill="${C.stoneLight}"/>`;
    }
  }
  return svg(W, H, body, defs);
}
put('board/island_large.svg', island(1000, 640, 101, { crystals: 4, tufts: 22 }));
put('board/island_wide.svg', island(1180, 560, 202, { crystals: 4, tufts: 24, topRatio: 0.5 }));
put('board/island_medium.svg', island(660, 460, 303, { crystals: 3, tufts: 14 }));
put('board/island_small.svg', island(400, 320, 404, { crystals: 2, tufts: 8 }));
put('board/island_tiny.svg', island(240, 210, 505, { crystals: 1, tufts: 4 }));

// ---------------------------------------------------------------------------------------------
// Landmarks
put(
  'board/observatory.svg',
  (() => {
    const W = 460;
    const H = 700;
    const defs =
      linear('obsStone', [
        [0, C.stoneLight],
        [1, C.stone],
      ], 0, 0, 1, 0) +
      linear('obsBrass', [
        [0, C.goldLight],
        [0.5, C.gold],
        [1, C.goldDark],
      ], 0, 0, 1, 1) +
      radial('obsCore', [
        [0, '#ffffff'],
        [0.4, C.crystal],
        [1, C.crystal, 0],
      ]);
    let b = '';
    // Base steps
    b += `<path d="M40 680h380l-24 -40h-332z" fill="${C.stoneDark}"/>`;
    b += `<path d="M64 640h332l-20 -34h-292z" fill="${C.stone}"/>`;
    // Tower body
    b += `<path d="M110 606L136 250h188l26 356z" fill="url(#obsStone)"/>`;
    for (let y = 290; y < 600; y += 44) b += `<path d="M${f(118 + (606 - y) * 0.06)} ${y}H${f(342 - (606 - y) * 0.06)}" stroke="${C.stoneDark}" stroke-opacity="0.35" stroke-width="3"/>`;
    // Spiral engraving glowing up the tower
    b += `<path d="M170 590C140 540 320 520 290 470S150 420 180 370S320 330 280 280" fill="none" stroke="${C.crystal}" stroke-width="10" stroke-linecap="round" opacity="0.9"/>`;
    b += `<path d="M170 590C140 540 320 520 290 470S150 420 180 370S320 330 280 280" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`;
    // Door
    b += `<path d="M196 606v-70a34 34 0 0 1 68 0v70z" fill="${C.woodDark}"/><path d="M204 606v-66a26 26 0 0 1 52 0v66z" fill="${C.wood}"/>`;
    b += `<circle cx="230" cy="560" r="10" fill="none" stroke="${C.gold}" stroke-width="4"/>`;
    // Balcony ring
    b += `<ellipse cx="230" cy="252" rx="130" ry="30" fill="${C.goldDark}"/><ellipse cx="230" cy="244" rx="130" ry="30" fill="url(#obsBrass)"/>`;
    // Dome
    b += `<path d="M120 244a110 120 0 0 1 220 0z" fill="url(#obsBrass)"/>`;
    b += `<path d="M150 236a80 92 0 0 1 160 0" fill="none" stroke="${C.goldDark}" stroke-width="4"/>`;
    b += `<path d="${spiral(230, 176, 4, 46, 2.5, 90)}" fill="none" stroke="${C.goldDark}" stroke-width="6" stroke-linecap="round"/>`;
    // Telescope
    b += `<g transform="rotate(-28 290 150)"><rect x="270" y="118" width="170" height="44" rx="14" fill="${C.goldDark}"/><rect x="276" y="122" width="150" height="36" rx="12" fill="${C.gold}"/><rect x="410" y="112" width="30" height="56" rx="8" fill="${C.goldLight}" stroke="${C.goldDark}" stroke-width="3"/></g>`;
    // Rotating rings around a glowing core
    b += `<circle cx="230" cy="96" r="70" fill="url(#obsCore)"/>`;
    b += `<ellipse cx="230" cy="96" rx="92" ry="26" fill="none" stroke="${C.gold}" stroke-width="7"/>`;
    b += `<ellipse cx="230" cy="96" rx="30" ry="88" fill="none" stroke="${C.goldDark}" stroke-width="6" transform="rotate(35 230 96)"/>`;
    b += `<path d="${hexagon(230, 96, 22, Math.PI / 6)}" fill="${C.crystalLight}" stroke="#ffffff" stroke-width="3"/>`;
    // Pennants
    b += `<path d="M120 244l-40 30v80l40 -26z" fill="${C.coral}"/><path d="M340 244l40 30v80l-40 -26z" fill="${C.teal}"/>`;
    return svg(W, H, b, defs);
  })(),
);

put(
  'board/tree_twist.svg',
  (() => {
    const W = 520;
    const H = 700;
    const defs =
      linear('trunk', [
        [0, '#8a5a30'],
        [0.5, '#b07a45'],
        [1, '#6b4322'],
      ], 0, 0, 1, 0) +
      radial('leaf', [
        [0, '#9be06a'],
        [0.7, '#5fb548'],
        [1, '#3f8f3a'],
      ], 0.4, 0.35, 0.7);
    let b = '';
    // Roots
    b += `<path d="M150 690c30 -40 70 -60 110 -60s80 20 110 60z" fill="#6b4322"/>`;
    // Twisting trunk: two intertwined strands
    b += `<path d="M200 660C170 560 330 520 290 430S170 330 230 250" stroke="url(#trunk)" stroke-width="70" fill="none" stroke-linecap="round"/>`;
    b += `<path d="M320 660C350 560 190 520 230 430S350 330 290 250" stroke="#9c6a3a" stroke-width="54" fill="none" stroke-linecap="round"/>`;
    b += `<path d="M320 660C350 560 190 520 230 430S350 330 290 250" stroke="#c98b50" stroke-width="12" fill="none" stroke-linecap="round" opacity="0.6"/>`;
    // Canopy blobs
    const r = rng(77);
    const blobs = [
      [260, 210, 170],
      [130, 250, 110],
      [390, 250, 110],
      [200, 120, 110],
      [330, 120, 110],
      [260, 70, 90],
    ];
    for (const [x, y, rr] of blobs) b += `<circle cx="${x}" cy="${y}" r="${rr}" fill="url(#leaf)"/>`;
    for (let i = 0; i < 26; i++) {
      const x = 90 + r() * 340;
      const y = 40 + r() * 260;
      b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(10 + r() * 16)}" fill="#b6ec84" opacity="0.35"/>`;
    }
    // Lanterns hanging from the canopy
    const lanterns = [
      [120, 330],
      [400, 340],
      [250, 360],
    ];
    for (const [x, y] of lanterns) {
      b += `<path d="M${x} ${y - 40}v26" stroke="${C.woodDark}" stroke-width="3"/>`;
      b += `<ellipse cx="${x}" cy="${y}" rx="18" ry="22" fill="${C.gold}"/><ellipse cx="${x}" cy="${y}" rx="10" ry="16" fill="${C.goldLight}"/>`;
      b += `<rect x="${x - 10}" y="${y - 26}" width="20" height="6" rx="2" fill="${C.woodDark}"/>`;
    }
    // Spiral carved into the trunk
    b += `<path d="${spiral(262, 520, 3, 26, 2.2, 60)}" stroke="${C.crystal}" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.85"/>`;
    return svg(W, H, b, defs);
  })(),
);

put(
  'board/crystal_generator.svg',
  (() => {
    const W = 320;
    const H = 400;
    const defs =
      linear('cg', [
        [0, C.crystalLight],
        [0.5, C.crystal],
        [1, '#2b9fc4'],
      ], 0, 0, 1, 1) + radial('cgGlow', [
        [0, C.crystal, 0.8],
        [1, C.crystal, 0],
      ]);
    let b = `<circle cx="160" cy="170" r="150" fill="url(#cgGlow)"/>`;
    b += `<path d="M60 390h200l-20 -40h-160z" fill="${C.stoneDark}"/><path d="M80 350h160l-12 -24h-136z" fill="${C.stone}"/>`;
    // Brass frame arms
    b += `<path d="M90 330C60 250 60 140 110 80" stroke="${C.goldDark}" stroke-width="16" fill="none" stroke-linecap="round"/>`;
    b += `<path d="M230 330C260 250 260 140 210 80" stroke="${C.goldDark}" stroke-width="16" fill="none" stroke-linecap="round"/>`;
    b += `<path d="M90 330C60 250 60 140 110 80" stroke="${C.gold}" stroke-width="8" fill="none" stroke-linecap="round"/>`;
    b += `<path d="M230 330C260 250 260 140 210 80" stroke="${C.gold}" stroke-width="8" fill="none" stroke-linecap="round"/>`;
    // Crystal
    b += `<path d="M160 40L210 110L196 300H124L110 110Z" fill="url(#cg)" stroke="#ffffff" stroke-width="4"/>`;
    b += `<path d="M160 40L160 300" stroke="#ffffff" stroke-opacity="0.6" stroke-width="3"/><path d="M110 110L160 150L210 110" stroke="#ffffff" stroke-opacity="0.6" stroke-width="3" fill="none"/>`;
    // Coils
    for (let i = 0; i < 4; i++) {
      const y = 180 + i * 30;
      b += `<ellipse cx="160" cy="${y}" rx="${64 - i * 4}" ry="12" fill="none" stroke="${C.gold}" stroke-width="6"/>`;
    }
    b += `<path d="${spiral(160, 120, 2, 20, 2, 50)}" stroke="#ffffff" stroke-width="4" fill="none" opacity="0.9"/>`;
    return svg(W, H, b, defs);
  })(),
);

put(
  'board/bunting.svg',
  (() => {
    const W = 640;
    const H = 140;
    const cols = [C.coral, C.gold, C.teal, C.purple, C.crystal, C.grass];
    let b = `<path d="M10 20Q320 90 630 20" stroke="${C.woodDark}" stroke-width="4" fill="none"/>`;
    for (let i = 0; i < 12; i++) {
      const t = (i + 0.5) / 12;
      const x = 10 + t * 620;
      const y = 20 + Math.sin(t * Math.PI) * 35;
      b += `<path d="M${f(x - 20)} ${f(y)}L${f(x + 20)} ${f(y)}L${f(x)} ${f(y + 50)}Z" fill="${cols[i % cols.length]}" stroke="${C.ink}" stroke-opacity="0.3" stroke-width="2"/>`;
      b += `<circle cx="${f(x)}" cy="${f(y + 16)}" r="5" fill="#ffffff" opacity="0.7"/>`;
    }
    return svg(W, H, b);
  })(),
);

put(
  'board/lantern.svg',
  svg(
    80,
    120,
    `<path d="M40 0v18" stroke="${C.woodDark}" stroke-width="4"/><rect x="24" y="16" width="32" height="8" rx="3" fill="${C.woodDark}"/>` +
      `<ellipse cx="40" cy="62" rx="30" ry="38" fill="${C.gold}"/><ellipse cx="40" cy="62" rx="18" ry="30" fill="${C.goldLight}"/>` +
      `<path d="M16 62h48M20 44h40M20 80h40" stroke="${C.goldDark}" stroke-width="2" opacity="0.6"/>` +
      `<rect x="26" y="98" width="28" height="8" rx="3" fill="${C.woodDark}"/><path d="M40 106v12" stroke="${C.coral}" stroke-width="4"/>`,
  ),
);

put(
  'board/windmill.svg',
  (() => {
    let b = `<path d="M100 380L118 150h44l18 230z" fill="${C.wood}"/><path d="M118 150h44l4 40h-52z" fill="${C.woodDark}"/>`;
    b += `<path d="M106 380h68" stroke="${C.woodDark}" stroke-width="10"/>`;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + 0.3;
      const x = 140 + Math.cos(a) * 110;
      const y = 140 + Math.sin(a) * 110;
      b += `<path d="M140 140L${f(x)} ${f(y)}" stroke="${C.goldDark}" stroke-width="10" stroke-linecap="round"/>`;
      b += `<path d="M${f(140 + Math.cos(a) * 40)} ${f(140 + Math.sin(a) * 40)}L${f(x)} ${f(y)}L${f(140 + Math.cos(a + 0.35) * 100)} ${f(140 + Math.sin(a + 0.35) * 100)}Z" fill="${C.cream}" stroke="${C.goldDark}" stroke-width="3"/>`;
    }
    b += `<circle cx="140" cy="140" r="22" fill="${C.gold}" stroke="${C.goldDark}" stroke-width="4"/><path d="${spiral(140, 140, 2, 14, 1.8, 40)}" stroke="${C.goldDark}" stroke-width="3" fill="none"/>`;
    return svg(280, 390, b);
  })(),
);

put(
  'board/workshop.svg',
  (() => {
    let b = `<path d="M20 290h300v-150l-150 -90l-150 90z" fill="${C.woodLight}"/>`;
    b += `<path d="M0 150l170 -110l170 110l-20 16l-150 -96l-150 96z" fill="${C.tealDark}"/>`;
    b += `<path d="M130 290v-90h80v90z" fill="${C.woodDark}"/><circle cx="196" cy="246" r="5" fill="${C.gold}"/>`;
    b += `<rect x="48" y="176" width="56" height="48" rx="6" fill="${C.crystal}" stroke="${C.woodDark}" stroke-width="6"/>`;
    b += `<rect x="236" y="176" width="56" height="48" rx="6" fill="${C.crystal}" stroke="${C.woodDark}" stroke-width="6"/>`;
    // Gears on the roof
    const gear = (cx, cy, r, teeth, col) => {
      let d = '';
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const rr = i % 2 ? r : r * 1.25;
        d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)}`;
      }
      return `<path d="${d}Z" fill="${col}" stroke="${C.goldDark}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="${f(r * 0.35)}" fill="${C.woodDark}"/>`;
    };
    b += gear(250, 70, 30, 9, C.gold) + gear(292, 104, 20, 7, C.goldLight);
    b += `<rect x="110" y="120" width="120" height="36" rx="10" fill="${C.cream}" stroke="${C.goldDark}" stroke-width="4"/>`;
    b += `<path d="M130 138h80" stroke="${C.tealDark}" stroke-width="6" stroke-linecap="round"/>`;
    return svg(340, 300, b);
  })(),
);

put(
  'board/stall.svg',
  (() => {
    let b = `<rect x="30" y="120" width="12" height="170" fill="${C.woodDark}"/><rect x="278" y="120" width="12" height="170" fill="${C.woodDark}"/>`;
    b += `<rect x="20" y="200" width="280" height="90" rx="10" fill="${C.wood}"/><rect x="20" y="200" width="280" height="18" rx="6" fill="${C.woodLight}"/>`;
    // Striped awning with scalloped edge
    for (let i = 0; i < 7; i++) {
      b += `<path d="M${10 + i * 43} 60h43v70h-43z" fill="${i % 2 ? C.cream : C.purple}"/>`;
      b += `<path d="M${10 + i * 43} 130a21.5 18 0 0 0 43 0z" fill="${i % 2 ? C.cream : C.purple}"/>`;
    }
    b += `<path d="M0 64l160 -56l160 56z" fill="${C.purpleDark}"/>`;
    // Goods: jars and a capsule
    b += `<circle cx="80" cy="190" r="18" fill="${C.gold}"/><path d="${spiral(80, 190, 1, 10, 1.6, 30)}" stroke="${C.goldDark}" stroke-width="3" fill="none"/>`;
    b += `<rect x="130" y="166" width="32" height="40" rx="8" fill="${C.crystal}" opacity="0.85"/><rect x="176" y="172" width="28" height="34" rx="8" fill="${C.purpleLight}" opacity="0.9"/>`;
    b += `<path d="M230 196l16 -28l16 28z" fill="${C.coral}"/>`;
    return svg(320, 300, b);
  })(),
);

put(
  'board/relic_pedestal.svg',
  svg(
    160,
    130,
    `<ellipse cx="80" cy="112" rx="70" ry="16" fill="#000" opacity="0.18"/>` +
      `<path d="M26 110h108l-10 -22h-88z" fill="${C.stoneDark}"/><path d="M40 88h80l-8 -52h-64z" fill="${C.stone}"/>` +
      `<ellipse cx="80" cy="36" rx="46" ry="12" fill="${C.stoneLight}"/><ellipse cx="80" cy="36" rx="32" ry="7" fill="${C.crystal}" opacity="0.6"/>` +
      `<path d="${spiral(80, 64, 2, 14, 1.8, 40)}" stroke="${C.crystal}" stroke-width="3" fill="none"/>`,
  ),
);

put(
  'board/prism_gate.svg',
  (() => {
    let b = `<path d="M20 230v-130a80 80 0 0 1 160 0v130h-34v-126a46 46 0 0 0 -92 0v126z" fill="${C.stone}" stroke="${C.stoneDark}" stroke-width="4"/>`;
    b += `<path d="M54 230v-126a46 46 0 0 1 92 0v126z" fill="${C.purple}" opacity="0.35"/>`;
    for (let i = 0; i < 4; i++) b += `<path d="M${64 + i * 24} 230v-120" stroke="${C.crystal}" stroke-width="5" opacity="0.8"/>`;
    b += `<circle cx="100" cy="150" r="24" fill="${C.cream}" stroke="${C.goldDark}" stroke-width="5"/>`;
    b += `<path d="${spiral(100, 150, 2, 14, 1.8, 40)}" stroke="${C.purple}" stroke-width="4" fill="none"/>`;
    b += `${crystalShard(100, 42, 26, 40, C.crystal, '#ffffff')}`;
    return svg(200, 240, b);
  })(),
);

put(
  'board/cloud_puff.svg',
  svg(
    280,
    150,
    `<ellipse cx="90" cy="95" rx="70" ry="42" fill="#ffffff"/><ellipse cx="160" cy="70" rx="80" ry="55" fill="#ffffff"/><ellipse cx="215" cy="100" rx="58" ry="38" fill="#ffffff"/><ellipse cx="140" cy="112" rx="110" ry="30" fill="#f1f4ff"/>`,
  ),
);

// ---------------------------------------------------------------------------------------------
// Board spaces: 2.5D discs with an upright, colour-independent icon.
const icons = {
  gleam: (cx, cy) =>
    `<path d="${hexagon(cx, cy, 17, Math.PI / 6)}" fill="${C.gold}" stroke="${C.goldDark}" stroke-width="3"/><path d="${spiral(cx, cy, 1, 10, 1.8, 36)}" stroke="${C.tealDark}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  festival: (cx, cy) => {
    let d = '';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 9 : 19;
      d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`;
    }
    return `<path d="${d}Z" fill="${C.goldLight}" stroke="#b2531a" stroke-width="3" stroke-linejoin="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="#ffffff"/>`;
  },
  mischief: (cx, cy) =>
    `<path d="${spiral(cx - 2, cy, 1, 15, 1.6, 40, Math.PI)}" stroke="#ffffff" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M${cx + 10} ${cy - 16}l6 8l-5 1l6 9" stroke="${C.goldLight}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  market: (cx, cy) =>
    `<path d="M${cx - 15} ${cy - 4}q0 22 15 22t15 -22q0 -8 -8 -10h-14q-8 2 -8 10z" fill="${C.woodLight}" stroke="${C.woodDark}" stroke-width="3"/><path d="M${cx - 7} ${cy - 13}q7 -9 14 0" stroke="${C.woodDark}" stroke-width="3" fill="none"/><circle cx="${cx}" cy="${cy + 5}" r="5" fill="${C.gold}" stroke="${C.goldDark}" stroke-width="2"/>`,
  portal: (cx, cy) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="18" ry="18" fill="none" stroke="#ffffff" stroke-width="4"/><ellipse cx="${cx}" cy="${cy}" rx="11" ry="11" fill="none" stroke="${C.crystalLight}" stroke-width="4"/><circle cx="${cx}" cy="${cy}" r="4" fill="#ffffff"/>`,
  relic: (cx, cy) =>
    `<path d="M${cx} ${cy - 20}L${cx + 12} ${cy - 8}L${cx + 9} ${cy + 16}H${cx - 9}L${cx - 12} ${cy - 8}Z" fill="${C.crystalLight}" stroke="${C.purpleDark}" stroke-width="3" stroke-linejoin="round"/><path d="M${cx} ${cy - 20}V${cy + 16}M${cx - 12} ${cy - 8}L${cx} ${cy - 2}L${cx + 12} ${cy - 8}" stroke="${C.purple}" stroke-width="2" fill="none"/>`,
  event: (cx, cy) => {
    let d = '';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 14 : 19;
      d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`;
    }
    return `<path d="${d}Z" fill="${C.stone}" stroke="${C.stoneDark}" stroke-width="3" stroke-linejoin="round"/><circle cx="${cx}" cy="${cy}" r="10" fill="${C.cream}"/><path d="M${cx} ${cy - 6}v7" stroke="${C.coral}" stroke-width="4" stroke-linecap="round"/><circle cx="${cx}" cy="${cy + 5.5}" r="2.3" fill="${C.coral}"/>`;
  },
  start: (cx, cy) =>
    `<path d="M${cx - 8} ${cy + 17}V${cy - 19}" stroke="${C.woodDark}" stroke-width="4" stroke-linecap="round"/><path d="M${cx - 6} ${cy - 19}h22l-6 8l6 8h-22z" fill="${C.coral}" stroke="#9c2f28" stroke-width="2.5" stroke-linejoin="round"/>`,
};
const spaceColors = {
  gleam: ['#39c7ea', '#8fe7f8', '#197a9d'],
  festival: ['#ff9a2e', '#ffc978', '#b85a16'],
  mischief: ['#9b5de5', '#c7a0ff', '#56308c'],
  market: ['#f2c14e', '#ffe39a', '#a67a18'],
  portal: ['#34cdbd', '#9bf2e8', '#18867b'],
  relic: ['#e6f6ff', '#ffffff', '#6f8fb0'],
  event: ['#e9e2cf', '#fff9ea', '#8d856f'],
  start: ['#1fa5a0', '#79dcd5', '#0f6f6b'],
};
for (const [type, [top, inner, rim]] of Object.entries(spaceColors)) {
  const W = 128;
  const H = 88;
  const cx = 64;
  const topY = 38;
  let b = `<ellipse cx="${cx}" cy="${topY + 16}" rx="60" ry="28" fill="#000" opacity="0.2"/>`;
  b += `<path d="M4 ${topY}v12a60 28 0 0 0 120 0v-12z" fill="${rim}"/>`;
  b += `<ellipse cx="${cx}" cy="${topY}" rx="60" ry="28" fill="${top}"/>`;
  b += `<ellipse cx="${cx}" cy="${topY - 2}" rx="46" ry="20" fill="${inner}" opacity="0.55"/>`;
  b += `<ellipse cx="${cx}" cy="${topY}" rx="60" ry="28" fill="none" stroke="${C.ink}" stroke-opacity="0.35" stroke-width="2.5"/>`;
  b += `<path d="M14 ${topY + 9}a52 22 0 0 0 100 0" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2"/>`;
  b += icons[type](cx, topY - 2);
  put(`board/space_${type}.svg`, svg(W, H, b));
}

// ---------------------------------------------------------------------------------------------
// Items without a supplied sprite
put(
  'items/prism_relic.svg',
  (() => {
    const W = 220;
    const H = 260;
    const defs =
      linear('pr', [
        [0, '#ffffff'],
        [0.35, C.crystalLight],
        [0.7, C.crystal],
        [1, C.purpleLight],
      ], 0, 0, 1, 1) + radial('prGlow', [
        [0, '#ffffff', 0.9],
        [0.5, C.crystal, 0.35],
        [1, C.purple, 0],
      ]);
    let b = `<circle cx="110" cy="124" r="108" fill="url(#prGlow)"/>`;
    b += `<path d="M110 14L170 62L160 196L110 244L60 196L50 62Z" fill="url(#pr)" stroke="#ffffff" stroke-width="5" stroke-linejoin="round"/>`;
    b += `<path d="M110 14L110 244M50 62L110 96L170 62M60 196L110 170L160 196" stroke="${C.purple}" stroke-opacity="0.55" stroke-width="3" fill="none"/>`;
    b += `<path d="${spiral(110, 134, 2, 26, 2.1, 60)}" stroke="${C.gold}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
    b += `<path d="M78 70L96 58L92 120Z" fill="#ffffff" opacity="0.7"/>`;
    for (const [x, y, s] of [
      [30, 40, 7],
      [192, 70, 6],
      [186, 206, 8],
      [28, 190, 6],
    ])
      b += `<path d="M${x} ${y - s * 2}L${x + s * 0.6} ${y - s * 0.6}L${x + s * 2} ${y}L${x + s * 0.6} ${y + s * 0.6}L${x} ${y + s * 2}L${x - s * 0.6} ${y + s * 0.6}L${x - s * 2} ${y}L${x - s * 0.6} ${y - s * 0.6}Z" fill="#ffffff" opacity="0.9"/>`;
    return svg(W, H, b, defs);
  })(),
);
put(
  'items/warp_charm.svg',
  svg(
    180,
    180,
    `<circle cx="90" cy="84" r="70" fill="${C.purple}" opacity="0.25"/>` +
      `<circle cx="90" cy="80" r="52" fill="${C.gold}" stroke="${C.goldDark}" stroke-width="6"/>` +
      `<circle cx="90" cy="80" r="36" fill="${C.purpleDark}"/>` +
      `<path d="${spiral(90, 80, 2, 30, 2.4, 70)}" stroke="${C.purpleLight}" stroke-width="6" fill="none" stroke-linecap="round"/>` +
      `<path d="M90 28V10" stroke="${C.goldDark}" stroke-width="6"/><circle cx="90" cy="10" r="8" fill="none" stroke="${C.goldDark}" stroke-width="4"/>` +
      `<path d="M80 132l-10 40M90 134v42M100 132l10 40" stroke="${C.coral}" stroke-width="6" stroke-linecap="round"/>` +
      `<circle cx="74" cy="64" r="8" fill="#ffffff" opacity="0.6"/>`,
  ),
);
put(
  'items/magnet_glove.svg',
  svg(
    180,
    180,
    `<path d="M50 170v-60c-14 -10 -20 -30 -10 -44l14 16v-52a10 10 0 0 1 20 0v40v-52a10 10 0 0 1 20 0v52v-46a10 10 0 0 1 20 0v50v-36a10 10 0 0 1 20 0v70c0 30 -14 50 -30 62v10z" fill="${C.coral}" stroke="#9c2f28" stroke-width="5" stroke-linejoin="round"/>` +
      `<rect x="44" y="150" width="96" height="24" rx="8" fill="${C.cream}" stroke="#9c2f28" stroke-width="5"/>` +
      `<path d="M72 120a20 20 0 0 0 40 0v-18h-12v18a8 8 0 0 1 -16 0v-18h-12z" fill="${C.stoneLight}" stroke="${C.stoneDark}" stroke-width="3"/>` +
      `<rect x="72" y="96" width="12" height="10" fill="${C.crystal}"/><rect x="100" y="96" width="12" height="10" fill="${C.crystal}"/>` +
      `<path d="M150 70q12 -10 24 0M146 54q20 -18 36 0" stroke="${C.crystal}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  ),
);
put(
  'items/spring_bean.svg',
  svg(
    180,
    180,
    `<ellipse cx="90" cy="164" rx="50" ry="10" fill="#000" opacity="0.15"/>` +
      `<path d="M52 120c-10 -40 20 -70 50 -60s40 50 10 80s-52 18 -60 -20z" fill="${C.grass}" stroke="${C.grassDark}" stroke-width="5"/>` +
      `<path d="M66 116c0 -24 16 -42 36 -40" stroke="${C.grassLight}" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.8"/>` +
      `<path d="M96 62c-6 -8 -6 -16 4 -18c10 -2 12 8 2 12c-10 4 -14 -6 -4 -12c10 -6 16 4 6 10c-10 6 -14 -8 -4 -14c8 -6 18 -2 16 8" stroke="${C.gold}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
      `<path d="M114 30c10 -10 24 -8 30 2c-10 6 -22 8 -30 -2z" fill="${C.grassLight}" stroke="${C.grassDark}" stroke-width="3"/>` +
      `<circle cx="78" cy="104" r="6" fill="#ffffff" opacity="0.7"/>`,
  ),
);

// ---------------------------------------------------------------------------------------------
// UI
put(
  'ui/orbit_dial.svg',
  (() => {
    const W = 380;
    const H = 380;
    const cx = 190;
    const cy = 190;
    const defs =
      radial('odFace', [
        [0, '#fffdf4'],
        [0.75, C.cream],
        [1, C.creamDark],
      ]) + linear('odRing', [
        [0, C.goldLight],
        [0.5, C.gold],
        [1, C.goldDark],
      ], 0, 0, 1, 1);
    let b = `<circle cx="${cx}" cy="${cy}" r="182" fill="url(#odRing)" stroke="${C.goldDark}" stroke-width="6"/>`;
    b += `<circle cx="${cx}" cy="${cy}" r="150" fill="url(#odFace)" stroke="${C.tealDark}" stroke-width="8"/>`;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      b += `<path d="M${f(cx + Math.cos(a) * 150)} ${f(cy + Math.sin(a) * 150)}L${f(cx + Math.cos(a) * 176)} ${f(cy + Math.sin(a) * 176)}" stroke="${C.goldDark}" stroke-width="6" stroke-linecap="round"/>`;
      b += `<circle cx="${f(cx + Math.cos(a + Math.PI / 10) * 166)}" cy="${f(cy + Math.sin(a + Math.PI / 10) * 166)}" r="7" fill="${i % 2 ? C.crystal : C.purpleLight}" stroke="#ffffff" stroke-width="2"/>`;
    }
    b += `<path d="${spiral(cx, cy, 20, 128, 2.6, 160)}" stroke="${C.teal}" stroke-opacity="0.18" stroke-width="16" fill="none" stroke-linecap="round"/>`;
    b += `<circle cx="${cx}" cy="${cy}" r="98" fill="none" stroke="${C.teal}" stroke-opacity="0.35" stroke-width="4" stroke-dasharray="6 10"/>`;
    return svg(W, H, b, defs);
  })(),
);
put(
  'ui/spiral_emblem.svg',
  (() => {
    const defs =
      linear('emb', [
        [0, C.goldLight],
        [0.5, C.gold],
        [1, C.goldDark],
      ], 0, 0, 1, 1) + radial('embGlow', [
        [0, C.crystal, 0.8],
        [1, C.crystal, 0],
      ]);
    let b = `<circle cx="128" cy="128" r="124" fill="url(#embGlow)"/>`;
    b += `<path d="${hexagon(128, 128, 104, Math.PI / 6)}" fill="${C.tealDark}" stroke="url(#emb)" stroke-width="12" stroke-linejoin="round"/>`;
    b += `<path d="${spiral(128, 128, 4, 78, 2.8, 160)}" stroke="url(#emb)" stroke-width="16" fill="none" stroke-linecap="round"/>`;
    b += `<path d="${spiral(128, 128, 4, 78, 2.8, 160)}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      b += `<path d="${hexagon(128 + Math.cos(a) * 104, 128 + Math.sin(a) * 104, 10, 0)}" fill="${i % 2 ? C.crystal : C.purpleLight}" stroke="#ffffff" stroke-width="3"/>`;
    }
    return svg(256, 256, b, defs);
  })(),
);
put(
  'ui/controller.svg',
  svg(
    220,
    150,
    `<path d="M50 30h120c30 0 44 20 48 50l2 30c2 22 -14 36 -30 30l-34 -24h-76l-34 24c-16 6 -32 -8 -30 -30l2 -30c4 -30 18 -50 48 -50z" fill="${C.ink}" stroke="${C.cream}" stroke-width="6" stroke-linejoin="round"/>` +
      `<rect x="44" y="66" width="44" height="14" rx="4" fill="${C.cream}"/><rect x="59" y="51" width="14" height="44" rx="4" fill="${C.cream}"/>` +
      `<circle cx="164" cy="56" r="9" fill="${C.grass}"/><circle cx="184" cy="74" r="9" fill="${C.coral}"/><circle cx="144" cy="74" r="9" fill="${C.crystal}"/><circle cx="164" cy="92" r="9" fill="${C.gold}"/>` +
      `<circle cx="96" cy="104" r="14" fill="#4a4060" stroke="${C.cream}" stroke-width="3"/><circle cx="128" cy="104" r="14" fill="#4a4060" stroke="${C.cream}" stroke-width="3"/>`,
  ),
);
put(
  'ui/keyboard.svg',
  (() => {
    let b = `<rect x="8" y="24" width="204" height="104" rx="16" fill="${C.ink}" stroke="${C.cream}" stroke-width="6"/>`;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) b += `<rect x="${24 + c * 22}" y="${38 + r * 24}" width="18" height="18" rx="4" fill="${C.cream}" opacity="${r === 1 && c > 0 && c < 4 ? 1 : 0.7}"/>`;
    }
    b += `<rect x="54" y="110" width="112" height="12" rx="4" fill="${C.cream}"/>`;
    return svg(220, 150, b);
  })(),
);
put(
  'ui/podium.svg',
  (() => {
    const defs = linear('pod', [
      [0, C.stoneLight],
      [1, C.stone],
    ]);
    let b = `<ellipse cx="160" cy="176" rx="150" ry="22" fill="#000" opacity="0.2"/>`;
    b += `<path d="M20 60v100a140 30 0 0 0 280 0v-100z" fill="url(#pod)"/>`;
    b += `<path d="M20 110a140 30 0 0 0 280 0" fill="none" stroke="${C.gold}" stroke-width="8"/>`;
    b += `<ellipse cx="160" cy="60" rx="140" ry="36" fill="${C.cream}" stroke="${C.goldDark}" stroke-width="5"/>`;
    b += `<ellipse cx="160" cy="60" rx="110" ry="26" fill="none" stroke="${C.teal}" stroke-width="4" stroke-dasharray="10 8"/>`;
    b += `<path d="${spiral(160, 138, 2, 16, 1.8, 40)}" stroke="${C.tealDark}" stroke-width="4" fill="none"/>`;
    return svg(320, 200, b, defs);
  })(),
);
put(
  'ui/panel_ornament.svg',
  svg(
    96,
    96,
    `<path d="${spiral(34, 34, 2, 24, 1.7, 50, Math.PI)}" stroke="${C.gold}" stroke-width="7" fill="none" stroke-linecap="round"/>` +
      `<path d="M34 58Q34 90 90 90M58 34Q90 34 90 90" stroke="${C.gold}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
      `<path d="${hexagon(34, 34, 7, 0)}" fill="${C.crystal}" stroke="#ffffff" stroke-width="2"/>`,
  ),
);
put(
  'ui/path_arrow.svg',
  svg(
    120,
    120,
    `<path d="M60 8L108 64H78V112H42V64H12Z" fill="${C.gold}" stroke="${C.ink}" stroke-width="7" stroke-linejoin="round"/>` +
      `<path d="M60 26L88 58H66V100" stroke="#ffffff" stroke-opacity="0.6" stroke-width="5" fill="none" stroke-linejoin="round"/>`,
  ),
);

// ---------------------------------------------------------------------------------------------
function main() {
  let count = 0;
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    count++;
  }
  // Favicon: the spiral emblem.
  fs.writeFileSync(path.join(ROOT, 'public/favicon.svg'), files['ui/spiral_emblem.svg']);
  console.log(`Wrote ${count} placeholder SVGs to ${path.relative(ROOT, OUT)}`);
}
main();
