#!/usr/bin/env node
// Gleamtrail sprite pipeline.
//
// Reads the supplied sheets from public/assets/sprites/, verifies their dimensions and alpha,
// segments every frame by connected-component ownership (see sprite-layouts.mjs), and writes:
//
//   public/assets/atlases/<key>.png + <key>.json   Phaser "JSON Hash" atlases with trimmed frames
//   src/game/data/spriteMeta.generated.ts           per-frame content bounds used for anchoring
//
// Run with:  npm run sprites
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { SHEETS, SHEET_W, SHEET_H, CELL } from './sprite-layouts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'public/assets/sprites');
const OUT_DIR = path.join(ROOT, 'public/assets/atlases');
const META_OUT = path.join(ROOT, 'src/game/data/spriteMeta.generated.ts');

const PAD = 80; // logical frame grows by this much on every side
const ALPHA_MIN = 10; // below: treated as noise → fully transparent
const ALPHA_SNAP = 244; // at/above: snapped to fully opaque (interiors ship at ~250)
const STRONG = 64; // alpha threshold for connected-component labelling
const DOMINANT = 0.8; // share of a component that must sit in one partition to own it whole
const SOLID = 160; // alpha threshold for "body" bounds in the metadata
const SPACING = 2; // transparent gap between packed frames
const LOCATION_MARGIN = 12; // px a detached part must be closer to another sprite to move there
const ATLAS_W = 2048;

function readPng(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  return { w: png.width, h: png.height, data: png.data };
}

/** Two-pass 8-connected component labelling with union-find. */
function labelComponents(mask, w, h) {
  const labels = new Int32Array(w * h);
  const parent = [0];
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) {
      if (a < b) parent[b] = a;
      else parent[a] = b;
    }
  };
  let next = 1;
  const nb = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let n = 0;
      if (x > 0 && labels[i - 1]) nb[n++] = labels[i - 1];
      if (y > 0) {
        if (x > 0 && labels[i - w - 1]) nb[n++] = labels[i - w - 1];
        if (labels[i - w]) nb[n++] = labels[i - w];
        if (x < w - 1 && labels[i - w + 1]) nb[n++] = labels[i - w + 1];
      }
      if (n === 0) {
        parent.push(next);
        labels[i] = next++;
      } else {
        let m = nb[0];
        for (let k = 1; k < n; k++) if (nb[k] < m) m = nb[k];
        labels[i] = m;
        for (let k = 0; k < n; k++) union(m, nb[k]);
      }
    }
  }
  const remap = new Int32Array(next);
  let count = 0;
  for (let k = 1; k < next; k++) {
    const r = find(k);
    if (!remap[r]) remap[r] = ++count;
    remap[k] = remap[r];
  }
  for (let i = 0; i < w * h; i++) if (labels[i]) labels[i] = remap[labels[i]];
  return { labels, count };
}

/**
 * Watershed split of one connected component that spans several frames.
 * Returns false when no erosion depth yields large cores in two different frames — then the
 * component is a single sprite overflowing its cell and the caller keeps it whole.
 */
function splitWatershed(c, labels, pmap, partitions, owner, w, h, nf) {
  // Bounding box of the component.
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (labels[i] !== c) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const local = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) if (labels[(y + y0) * w + (x + x0)] === c) local[y * bw + x] = 1;
  }

  // Chamfer distance (3-4) to the component's outside.
  const INF = 1 << 20;
  const dist = new Int32Array(bw * bh);
  for (let i = 0; i < bw * bh; i++) dist[i] = local[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= bw || y >= bh ? 0 : dist[y * bw + x]);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      if (!local[i]) continue;
      dist[i] = Math.min(dist[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = bh - 1; y >= 0; y--) {
    for (let x = bw - 1; x >= 0; x--) {
      const i = y * bw + x;
      if (!local[i]) continue;
      dist[i] = Math.min(dist[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }

  const partAt = (lx, ly) => pmap[(ly + y0) * w + (lx + x0)];
  for (let depth = 2; depth <= 16; depth++) {
    const thr = depth * 3;
    const seedMask = new Uint8Array(bw * bh);
    for (let i = 0; i < bw * bh; i++) seedMask[i] = dist[i] >= thr ? 1 : 0;
    const { labels: sl, count: sc } = labelComponents(seedMask, bw, bh);
    if (sc === 0) break;
    const counts = new Int32Array((sc + 1) * nf);
    const sizes = new Int32Array(sc + 1);
    const sumX = new Float64Array(sc + 1);
    const sumY = new Float64Array(sc + 1);
    for (let i = 0; i < bw * bh; i++) {
      const s = sl[i];
      if (!s) continue;
      const lx = i % bw;
      const ly = (i / bw) | 0;
      sizes[s]++;
      sumX[s] += lx + x0;
      sumY[s] += ly + y0;
      const f = partAt(lx, ly);
      if (f >= 0) counts[s * nf + f]++;
    }
    let maxSize = 0;
    for (let s = 1; s <= sc; s++) if (sizes[s] > maxSize) maxSize = sizes[s];
    if (maxSize === 0) break;
    // One main core per frame: the largest core dominated by that frame. It must be substantial
    // (a single sprite overflowing its cell erodes into a body core plus small shoe/hair cores)
    // and centred well inside its partition (overflow fragments hug the partition edge).
    const mainCore = new Int32Array(nf).fill(0);
    for (let s = 1; s <= sc; s++) {
      let best = -1;
      let bestN = 0;
      for (let f = 0; f < nf; f++) {
        if (counts[s * nf + f] > bestN) {
          bestN = counts[s * nf + f];
          best = f;
        }
      }
      if (best < 0 || bestN / sizes[s] < 0.7) continue;
      if (!mainCore[best] || sizes[s] > sizes[mainCore[best]]) mainCore[best] = s;
    }
    const minCore = Math.max(600, 0.2 * maxSize);
    const seedFrame = new Int16Array(sc + 1).fill(-1);
    let accepted = 0;
    for (let f = 0; f < nf; f++) {
      const s = mainCore[f];
      if (!s || sizes[s] < minCore) continue;
      const [px, py, pw, ph] = partitions[f];
      const cx = sumX[s] / sizes[s];
      const cy = sumY[s] / sizes[s];
      const mx = 0.2 * pw;
      const my = 0.2 * ph;
      if (cx < px + mx || cx > px + pw - mx || cy < py + my || cy > py + ph - my) continue;
      seedFrame[s] = f;
      accepted++;
    }
    if (accepted < 2) continue;
    if (process.env.SPRITE_DEBUG) {
      const seeds = [];
      for (let q = 1; q <= sc; q++) if (seedFrame[q] >= 0) seeds.push(`f${seedFrame[q]}:${sizes[q]}@(${(sumX[q] / sizes[q]) | 0},${(sumY[q] / sizes[q]) | 0})`);
      console.log(`    watershed comp bbox x${x0}-${x1} y${y0}-${y1} depth ${depth}: ${seeds.join(' ')}`);
    }

    // Regrow the cores with priority flooding (Meyer's watershed on the distance map): thick
    // regions are claimed before thin necks, so a shoe follows its ankle rather than a hair tip
    // that merely touches it.
    const lo = new Int16Array(bw * bh).fill(-1);
    const queued = new Uint8Array(bw * bh);
    let maxD = 0;
    for (let i = 0; i < bw * bh; i++) if (dist[i] > maxD && dist[i] < INF) maxD = dist[i];
    const buckets = Array.from({ length: maxD + 1 }, () => []);
    let cur = 0;
    const push = (j) => {
      queued[j] = 1;
      const d = dist[j];
      buckets[d].push(j);
      if (d > cur) cur = d;
    };
    const neighbours = (i, fn) => {
      const x = i % bw;
      const y = (i / bw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < bw && yy < bh) fn(yy * bw + xx);
        }
      }
    };
    for (let i = 0; i < bw * bh; i++) {
      const s = sl[i];
      if (s && seedFrame[s] >= 0) {
        lo[i] = seedFrame[s];
        queued[i] = 1;
      }
    }
    for (let i = 0; i < bw * bh; i++) {
      if (lo[i] < 0) continue;
      neighbours(i, (j) => {
        if (local[j] && !queued[j]) push(j);
      });
    }
    for (;;) {
      while (cur > 0 && buckets[cur].length === 0) cur--;
      if (buckets[cur].length === 0) break;
      const i = buckets[cur].pop();
      let label = -1;
      neighbours(i, (j) => {
        if (label < 0 && lo[j] >= 0) label = lo[j];
      });
      lo[i] = label;
      neighbours(i, (j) => {
        if (local[j] && !queued[j]) push(j);
      });
    }
    for (let i = 0; i < bw * bh; i++) {
      if (!local[i]) continue;
      const lx = i % bw;
      const ly = (i / bw) | 0;
      owner[(ly + y0) * w + (lx + x0)] = lo[i] >= 0 ? lo[i] : partAt(lx, ly);
    }
    return true;
  }
  return false;
}

function processSheet(sheet) {
  const file = path.join(SRC_DIR, sheet.file);
  if (!fs.existsSync(file)) throw new Error(`Missing sprite sheet: ${file}`);
  const img = readPng(file);
  const { w, h, data } = img;
  const report = [`${sheet.key.padEnd(8)} ${sheet.file}`];
  if (w !== SHEET_W || h !== SHEET_H) {
    report.push(`  ! unexpected size ${w}x${h} (expected ${SHEET_W}x${SHEET_H}) — layout rectangles may need adjusting`);
  }
  const n = w * h;

  // 1. Alpha cleanup + statistics.
  const alpha = new Uint8Array(n);
  let transparent = 0;
  for (let i = 0; i < n; i++) {
    let a = data[i * 4 + 3];
    if (a < ALPHA_MIN) {
      a = 0;
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 0;
    } else if (a >= ALPHA_SNAP) a = 255;
    data[i * 4 + 3] = a;
    alpha[i] = a;
    if (a === 0) transparent++;
  }
  report.push(`  alpha: RGBA, ${((100 * transparent) / n).toFixed(1)}% transparent after cleanup`);

  // 2. Partition map.
  const frames = sheet.frames;
  const nf = frames.length;
  const pmap = new Int16Array(n).fill(-1);
  frames.forEach((f, idx) => {
    const [px, py, pw, ph] = f.partition;
    for (let y = Math.max(0, py); y < Math.min(h, py + ph); y++) {
      for (let x = Math.max(0, px); x < Math.min(w, px + pw); x++) pmap[y * w + x] = idx;
    }
  });

  // 3. Connected components over strong pixels; assign ownership.
  const strong = new Uint8Array(n);
  for (let i = 0; i < n; i++) strong[i] = alpha[i] >= STRONG ? 1 : 0;
  const { labels, count } = labelComponents(strong, w, h);
  const compSize = new Int32Array(count + 1);
  const compFrame = new Int32Array((count + 1) * nf);
  for (let i = 0; i < n; i++) {
    const c = labels[i];
    if (!c) continue;
    compSize[c]++;
    const f = pmap[i];
    if (f >= 0) compFrame[c * nf + f]++;
  }
  // Dominant frame of every component, and the largest component each frame dominates.
  const compDom = new Int16Array(count + 1).fill(-1);
  const compShare = new Float32Array(count + 1);
  const largest = new Int32Array(nf);
  for (let c = 1; c <= count; c++) {
    let best = -1;
    let bestN = 0;
    for (let f = 0; f < nf; f++) {
      const v = compFrame[c * nf + f];
      if (v > bestN) {
        bestN = v;
        best = f;
      }
    }
    compDom[c] = best;
    compShare[c] = best >= 0 ? bestN / compSize[c] : 0;
    if (best >= 0 && compSize[c] > largest[best]) largest[best] = compSize[c];
  }
  // Primary components are the bodies of the sprites; secondary ones are small detached parts
  // (coins, discs under feet, sparkles, leaves) that are placed by proximity afterwards.
  const primary = new Uint8Array(count + 1);
  for (let c = 1; c <= count; c++) {
    if (compDom[c] >= 0 && compSize[c] >= Math.max(400, 0.25 * largest[compDom[c]])) primary[c] = 1;
  }

  const owner = new Int16Array(n).fill(-1);
  const shared = [];
  for (let c = 1; c <= count; c++) {
    if (!primary[c]) continue;
    if (compShare[c] >= DOMINANT) {
      for (let i = 0; i < n; i++) if (labels[i] === c) owner[i] = compDom[c];
    } else shared.push(c);
  }
  // Primary components spanning frames (touching sprites) are separated with a watershed:
  // erode until each sprite has its own core, then regrow the cores.
  let watershedCount = 0;
  const partitions = frames.map((f) => f.partition);
  for (const c of shared) {
    if (splitWatershed(c, labels, pmap, partitions, owner, w, h, nf)) watershedCount++;
    else {
      // A single sprite that merely overflows its cell: keep it whole.
      for (let i = 0; i < n; i++) if (labels[i] === c) owner[i] = compDom[c];
    }
  }
  const applyOverrides = () => {
    for (const ov of sheet.overrides ?? []) {
      const [ox, oy, ow, oh] = ov.rect;
      for (let y = oy; y < oy + oh; y++) {
        for (let x = ox; x < ox + ow; x++) if (owner[y * w + x] >= 0) owner[y * w + x] = ov.frame;
      }
    }
  };
  applyOverrides();

  // Body boxes: extents of each frame's primary pixels.
  const body = frames.map(() => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
  for (let i = 0; i < n; i++) {
    const o = owner[i];
    if (o < 0) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const b = body[o];
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y;
    if (y > b.y1) b.y1 = y;
  }
  // Secondary components go to the frame whose body box is nearest to their centroid.
  const sumX = new Float64Array(count + 1);
  const sumY = new Float64Array(count + 1);
  for (let i = 0; i < n; i++) {
    const c = labels[i];
    if (!c || primary[c]) continue;
    sumX[c] += i % w;
    sumY[c] += (i / w) | 0;
  }
  const secOwner = new Int16Array(count + 1).fill(-1);
  for (let c = 1; c <= count; c++) {
    if (primary[c] || !compSize[c]) continue;
    const cx = sumX[c] / compSize[c];
    const cy = sumY[c] / compSize[c];
    let best = compDom[c];
    let bestD = Infinity;
    for (let f = 0; f < nf; f++) {
      const b = body[f];
      if (b.x1 < b.x0) continue;
      const dx = Math.max(b.x0 - cx, 0, cx - b.x1);
      const dy = Math.max(b.y0 - cy, 0, cy - b.y1);
      // Location wins unless another sprite's body is clearly closer.
      const d = Math.hypot(dx, dy) - (f === compDom[c] ? LOCATION_MARGIN : 0);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    secOwner[c] = best >= 0 ? best : compDom[c];
  }
  for (let i = 0; i < n; i++) {
    const c = labels[i];
    if (c && !primary[c]) owner[i] = secOwner[c];
  }
  applyOverrides();
  const splitCount = shared.length;

  // 4. Weak (faint glow / anti-aliasing) pixels: flood outward from owned pixels.
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < n; i++) if (owner[i] >= 0) queue[qt++] = i;
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if ((dx === 0 && dy === 0) || xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (owner[j] === -1 && alpha[j] >= ALPHA_MIN) {
          owner[j] = owner[i];
          queue[qt++] = j;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) if (owner[i] === -1 && alpha[i] >= ALPHA_MIN) owner[i] = pmap[i];

  // 5. Extract each frame into its padded logical box.
  const boxes = frames.map(() => ({ x0: Infinity, y0: Infinity, x1: -1, y1: -1 }));
  for (let i = 0; i < n; i++) {
    const o = owner[i];
    if (o < 0 || alpha[i] === 0) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const b = boxes[o];
    if (x < b.x0) b.x0 = x;
    if (y < b.y0) b.y0 = y;
    if (x > b.x1) b.x1 = x;
    if (y > b.y1) b.y1 = y;
  }
  const out = [];
  let maxOverflow = 0;
  let clippedTotal = 0;
  frames.forEach((f, idx) => {
    const b0 = boxes[idx];
    // Band frames are centred on their actual artwork, standing on the band's baseline.
    const logical = f.logical ?? [Math.round((b0.x0 + b0.x1 + 1) / 2 - CELL / 2), f.baseline - CELL, CELL, CELL];
    const [lx, ly, lw, lh] = logical;
    const boxW = lw + 2 * PAD;
    const boxH = lh + 2 * PAD;
    const b = boxes[idx];
    if (b.x1 < 0) {
      out.push({ idx, empty: true, boxW, boxH });
      report.push(`  ! frame ${idx} is empty`);
      return;
    }
    maxOverflow = Math.max(maxOverflow, lx - b.x0, ly - b.y0, b.x1 - (lx + lw - 1), b.y1 - (ly + lh - 1));
    // Clamp to the padded box.
    const cx0 = Math.max(b.x0, lx - PAD);
    const cy0 = Math.max(b.y0, ly - PAD);
    const cx1 = Math.min(b.x1, lx + lw + PAD - 1);
    const cy1 = Math.min(b.y1, ly + lh + PAD - 1);
    const tw = cx1 - cx0 + 1;
    const th = cy1 - cy0 + 1;
    const pix = new Uint8Array(tw * th * 4);
    let clipped = 0;
    let sx0 = Infinity;
    let sy0 = Infinity;
    let sx1 = -1;
    let sy1 = -1;
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const i = y * w + x;
        if (owner[i] !== idx || alpha[i] === 0) continue;
        if (x < cx0 || x > cx1 || y < cy0 || y > cy1) {
          clipped++;
          continue;
        }
        const o = ((y - cy0) * tw + (x - cx0)) * 4;
        pix[o] = data[i * 4];
        pix[o + 1] = data[i * 4 + 1];
        pix[o + 2] = data[i * 4 + 2];
        pix[o + 3] = data[i * 4 + 3];
        if (alpha[i] >= SOLID) {
          if (x < sx0) sx0 = x;
          if (y < sy0) sy0 = y;
          if (x > sx1) sx1 = x;
          if (y > sy1) sy1 = y;
        }
      }
    }
    clippedTotal += clipped;
    const toLocalX = (x) => x - lx + PAD;
    const toLocalY = (y) => y - ly + PAD;
    out.push({
      idx,
      boxW,
      boxH,
      tw,
      th,
      pix,
      trimX: toLocalX(cx0),
      trimY: toLocalY(cy0),
      solid: sx1 >= 0 ? [toLocalX(sx0), toLocalY(sy0), sx1 - sx0 + 1, sy1 - sy0 + 1] : [0, 0, boxW, boxH],
    });
  });
  report.push(
    `  frames: ${nf}, components: ${count} (${splitCount} shared: ${watershedCount} watershed-split), max overflow ${maxOverflow}px` +
      (clippedTotal ? `, ${clippedTotal}px clipped (increase PAD)` : ''),
  );
  return { out, report };
}

/** Shelf-pack trimmed frames into a fixed-width atlas. */
function pack(frames) {
  const items = frames.filter((f) => !f.empty).sort((a, b) => b.th - a.th || b.tw - a.tw);
  let x = SPACING;
  let y = SPACING;
  let shelfH = 0;
  for (const f of items) {
    if (x + f.tw + SPACING > ATLAS_W) {
      x = SPACING;
      y += shelfH + SPACING;
      shelfH = 0;
    }
    f.ax = x;
    f.ay = y;
    x += f.tw + SPACING;
    shelfH = Math.max(shelfH, f.th);
  }
  const usedH = y + shelfH + SPACING;
  // Power-of-two height so WebGL1 can build mipmaps for smooth down-scaling.
  let H = 64;
  while (H < usedH) H *= 2;
  return { W: ATLAS_W, H };
}

function writeAtlas(sheet, frames) {
  const { W, H } = pack(frames);
  const png = new PNG({ width: W, height: H });
  png.data.fill(0);
  const json = { frames: {}, meta: { app: 'gleamtrail/scripts/build-sprites.mjs', image: `${sheet.key}.png`, format: 'RGBA8888', size: { w: W, h: H }, scale: '1' } };
  for (const f of frames) {
    if (f.empty) continue;
    for (let y = 0; y < f.th; y++) {
      const src = y * f.tw * 4;
      const dst = ((f.ay + y) * W + f.ax) * 4;
      png.data.set(f.pix.subarray(src, src + f.tw * 4), dst);
    }
    json.frames[String(f.idx)] = {
      frame: { x: f.ax, y: f.ay, w: f.tw, h: f.th },
      rotated: false,
      trimmed: true,
      spriteSourceSize: { x: f.trimX, y: f.trimY, w: f.tw, h: f.th },
      sourceSize: { w: f.boxW, h: f.boxH },
    };
  }
  fs.writeFileSync(path.join(OUT_DIR, `${sheet.key}.png`), PNG.sync.write(png, { deflateLevel: 9 }));
  fs.writeFileSync(path.join(OUT_DIR, `${sheet.key}.json`), JSON.stringify(json));
  return { W, H };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const meta = {};
  const lines = [];
  for (const sheet of SHEETS) {
    const { out, report } = processSheet(sheet);
    const { W, H } = writeAtlas(sheet, out);
    report.push(`  atlas: ${W}x${H}`);
    lines.push(...report);
    meta[sheet.key] = {
      pad: PAD,
      anchor: sheet.anchor,
      frames: out.map((f) => ({ w: f.boxW, h: f.boxH, solid: f.empty ? [0, 0, f.boxW, f.boxH] : f.solid })),
    };
  }
  const ts =
    '// AUTO-GENERATED by scripts/build-sprites.mjs — do not edit by hand. Run `npm run sprites`.\n' +
    '// Per-frame logical box size and the bounds of the solid (alpha >= ' + SOLID + ') artwork inside it.\n' +
    'export interface FrameMeta {\n  w: number;\n  h: number;\n  solid: [number, number, number, number];\n}\n' +
    'export interface SheetMeta {\n  pad: number;\n  anchor: \'feet\' | \'center\';\n  frames: FrameMeta[];\n}\n\n' +
    'export const SPRITE_META: Record<string, SheetMeta> = ' +
    JSON.stringify(meta, null, 0).replace(/\{"w"/g, '\n    {"w"') +
    ';\n';
  fs.writeFileSync(META_OUT, ts);
  console.log(lines.join('\n'));
  console.log(`\nWrote ${SHEETS.length} atlases to ${path.relative(ROOT, OUT_DIR)} and ${path.relative(ROOT, META_OUT)}`);
}

main();
