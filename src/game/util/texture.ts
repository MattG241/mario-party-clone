import Phaser from 'phaser';

const clamped = new Set<string>();

/**
 * Phaser gives power-of-two textures REPEAT wrapping, so linear filtering at one edge samples the
 * opposite edge. Tiled art (terrain tiles) needs CLAMP_TO_EDGE or each tile's far row bleeds in
 * as a hairline seam. Safe to call repeatedly; no-op on the canvas renderer.
 */
export function clampTexture(scene: Phaser.Scene, key: string): void {
  if (clamped.has(key)) return;
  const r = scene.renderer;
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer) || !scene.textures.exists(key)) return;
  const w = scene.textures.get(key).source[0]?.glTexture;
  // Only image-backed textures: re-uploading an empty (framebuffer) texture would clear it.
  if (!w || !w.pixels) return;
  const gl = r.gl;
  if (w.wrapS !== gl.CLAMP_TO_EDGE || w.wrapT !== gl.CLAMP_TO_EDGE) {
    w.update(w.pixels, w.width, w.height, w.flipY, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, w.minFilter, w.magFilter, w.format);
  }
  clamped.add(key);
}
