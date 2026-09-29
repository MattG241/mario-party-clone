import { describe, expect, it } from 'vitest';
import { findBoard } from '../../src/game/data/boards';
import type { RenderedBoard } from '../../src/game/data/rendered';

// A world board that says its Blender art exists (theme.rendered) must ship every file the game
// loads for it, Full and Lite, plus the setup-screen preview; otherwise it falls back to placeholders.
// (Vite globs list the files without loading them; the manifests are read as JSON.)
const FILES = new Set(
  Object.keys(import.meta.glob(['/public/assets/rendered/dojo/*', '/public/assets/rendered/capitol/*', '/public/assets/lite/dojo/*', '/public/assets/lite/capitol/*', '/public/assets/lite/previews/*'])),
);
const MANIFESTS = import.meta.glob(['/public/assets/rendered/dojo/manifest.json', '/public/assets/rendered/capitol/manifest.json', '/public/assets/lite/dojo/manifest.json', '/public/assets/lite/capitol/manifest.json'], {
  eager: true,
  import: 'default',
}) as Record<string, RenderedBoard>;

describe.each(['dojo', 'capitol'])('board art: %s', (id) => {
  const board = findBoard(id)!;

  it('has its rendered files in place when it says so', () => {
    if (!board.theme?.rendered) return;
    for (const variant of ['rendered', 'lite']) {
      const dir = `/public/assets/${variant}/${id}`;
      const man = MANIFESTS[`${dir}/manifest.json`];
      expect(man, `${dir}/manifest.json`).toBeDefined();
      expect(man.board).toBe(id);
      expect(man.tiles.length).toBeGreaterThan(0);
      const files = [...man.tiles.map((t) => t.file), ...(man.props ?? []).map((p) => p.file)];
      if (man.shadow) files.push(man.shadow.file);
      for (const f of files) expect(FILES.has(`${dir}/${f}`), `${dir}/${f}`).toBe(true);
    }
    expect(board.theme.preview).toBe(`assets/lite/previews/${id}.webp`);
    expect(FILES.has(`/public/${board.theme.preview}`)).toBe(true);
  });

  it('keeps every space inside the rendered frame', () => {
    if (!board.theme?.rendered) return;
    const man = MANIFESTS[`/public/assets/rendered/${id}/manifest.json`];
    const [ox, oy] = man.origin;
    const w = Math.max(...man.tiles.map((t) => t.x + t.w)) / man.scale;
    const h = Math.max(...man.tiles.map((t) => t.y + t.h)) / man.scale;
    for (const n of board.nodes) {
      expect(n.x).toBeGreaterThan(ox);
      expect(n.y).toBeGreaterThan(oy);
      expect(n.x).toBeLessThan(ox + w);
      expect(n.y).toBeLessThan(oy + h);
    }
  });
});
