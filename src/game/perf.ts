// Graphics level. "Lite" is for TV browsers and other low-memory devices: the board and sky load at
// half resolution (public/assets/lite, from scripts/build-lite.py), the largest optional renders are
// skipped (every scene has lighter built-in art for them), and the colour grade, mipmaps and canvas
// anti-aliasing are off with a steady 30 fps cap. It is decided once at boot because textures are
// chosen when they load; changing it in Settings reloads the page.
import { URL_PARAMS } from './debug/debug';

export type GraphicsMode = 'auto' | 'full' | 'lite';

/** Smart-TV and streaming-stick browsers (they have a fraction of a computer's memory). */
const TV_UA = /smart-?tv|tizen|web0s|webos|netcast|hbbtv|bravia|crkey|\baft[a-z]|googletv|android ?tv|viera|vidaa|hisense|philipstv|nettv|roku|aquos/i;

/** Whether this device should run Lite graphics. `?lite` / `?full` in the URL override everything. */
export function decideLite(mode: GraphicsMode, nav: (Navigator & { deviceMemory?: number }) | undefined = globalThis.navigator): boolean {
  if (URL_PARAMS.has('lite')) return true;
  if (URL_PARAMS.has('full')) return false;
  if (mode !== 'auto') return mode === 'lite';
  if (!nav) return false;
  if (TV_UA.test(nav.userAgent ?? '')) return true;
  return typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2;
}

export let LITE = false;

export function setLite(v: boolean): void {
  LITE = v;
}

/**
 * Atlases Lite loads at half size (public/assets/lite/atlases, from scripts/build-lite.py). Each is
 * stretched back over its full-size frame coordinates after loading (see inflateTexture), so every
 * sprite keeps its size. WebGL only.
 */
export const LITE_HALF_ATLASES = ['hero_kip', 'hero_mossi', 'hero_tumble', 'hero_zippa', 'npcs3d', 'vfx', 'items', 'props'];

/** Backdrop art Lite rasterises at half size; tiled strips of it draw at double scale. */
const LITE_HALF_SVGS = new Set(['bg-sky', 'bg-clouds-far', 'bg-clouds-below', 'bg-islands-far']);

/** How much smaller than normal this texture was loaded (1 = full size). */
export function liteSvgDivisor(key: string): number {
  return LITE && LITE_HALF_SVGS.has(key) ? 2 : 1;
}
