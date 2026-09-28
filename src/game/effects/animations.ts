import Phaser from 'phaser';

interface Def {
  key: string;
  atlas: string;
  frames: number[];
  fps: number;
  repeat?: number;
}

/**
 * Item and prop animations from the supplied sheets.
 *   items: 0–5 Gleam Chip · 6–11 Prism Key · 12–17 Mystery Capsule · 18–23 Wingstep Boots
 *          24–29 Bubble Shield · 30–35 Snare Seed
 *   props: 0–2 rope bridge · 3–5 door · 6–8 chest · 9–11 switch · 12–14 lift pad · 15–17 cannon
 *          18–20 rotating barrier · 21–23 spring pad · 24–26 signposts · 27–29 portal
 *          30–32 spiked log · 33–35 swinging mace
 */
const DEFS: Def[] = [
  { key: 'chip-spin', atlas: 'items', frames: [0, 1, 2, 3, 4, 5], fps: 12, repeat: -1 },
  { key: 'key-spin', atlas: 'items', frames: [6, 7, 8, 9, 10, 11], fps: 8, repeat: -1 },
  { key: 'capsule-idle', atlas: 'items', frames: [12, 13, 12, 14], fps: 6, repeat: -1 },
  { key: 'capsule-open', atlas: 'items', frames: [13, 14, 15, 16, 17], fps: 9 },
  { key: 'boots-idle', atlas: 'items', frames: [18, 19, 20, 21, 22, 23], fps: 8, repeat: -1 },
  { key: 'bubble-idle', atlas: 'items', frames: [24, 25, 26, 27, 28, 29], fps: 8, repeat: -1 },
  { key: 'seed-idle', atlas: 'items', frames: [30, 31], fps: 4, repeat: -1 },
  { key: 'seed-trap', atlas: 'items', frames: [31, 32, 33, 34, 35], fps: 10 },
  { key: 'bridge-break', atlas: 'props', frames: [0, 1, 2], fps: 6 },
  { key: 'door-open', atlas: 'props', frames: [3, 4, 5], fps: 8 },
  { key: 'chest-open', atlas: 'props', frames: [6, 7, 8], fps: 8 },
  { key: 'button-press', atlas: 'props', frames: [9, 10, 11], fps: 10 },
  { key: 'lift-rise', atlas: 'props', frames: [12, 13, 14], fps: 8 },
  { key: 'cannon-fire', atlas: 'props', frames: [15, 16, 17], fps: 8 },
  { key: 'barrier-spin', atlas: 'props', frames: [19, 20], fps: 10, repeat: -1 },
  { key: 'spring-launch', atlas: 'props', frames: [21, 22, 23], fps: 10 },
  { key: 'portal-idle', atlas: 'props', frames: [27, 28, 29, 28], fps: 5, repeat: -1 },
  { key: 'log-roll', atlas: 'props', frames: [31, 32], fps: 12, repeat: -1 },
  { key: 'mace-swing', atlas: 'props', frames: [33, 34, 33, 35], fps: 4, repeat: -1 },
];

export function registerCommonAnimations(anims: Phaser.Animations.AnimationManager): void {
  for (const d of DEFS) {
    if (anims.exists(d.key)) continue;
    anims.create({
      key: d.key,
      frames: d.frames.map((f) => ({ key: d.atlas, frame: String(f) })),
      frameRate: d.fps,
      repeat: d.repeat ?? 0,
    });
  }
}

/** Small generated textures used by particles. */
export function generateFxTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  if (!scene.textures.exists('fx-dot')) {
    for (let r = 12; r > 0; r--) {
      g.fillStyle(0xffffff, (1 - r / 12) * 0.35 + 0.05);
      g.fillCircle(12, 12, r);
    }
    g.generateTexture('fx-dot', 24, 24);
    g.clear();
  }
  if (!scene.textures.exists('fx-confetti')) {
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 14, 8);
    g.generateTexture('fx-confetti', 14, 8);
    g.clear();
  }
  if (!scene.textures.exists('px')) {
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 4, 4);
    g.generateTexture('px', 4, 4);
    g.clear();
  }
  if (!scene.textures.exists('fx-shadow')) {
    // Soft radial shadow with a darker core (character/prop grounding).
    const tex = scene.textures.createCanvas('fx-shadow', 128, 128);
    if (tex) {
      const ctx = tex.getContext();
      const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(8,18,28,0.82)');
      grd.addColorStop(0.3, 'rgba(8,18,28,0.55)');
      grd.addColorStop(0.7, 'rgba(8,18,28,0.16)');
      grd.addColorStop(1, 'rgba(8,18,28,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 128, 128);
      tex.refresh();
    }
  }
  if (!scene.textures.exists('fx-spot')) {
    // Spotlight vignette: clear centre, navy-dark edges (dims the world around a focus point).
    const tex = scene.textures.createCanvas('fx-spot', 256, 144);
    if (tex) {
      const ctx = tex.getContext();
      const grd = ctx.createRadialGradient(128, 72, 18, 128, 72, 140);
      grd.addColorStop(0, 'rgba(6,16,30,0)');
      grd.addColorStop(0.35, 'rgba(6,16,30,0.05)');
      grd.addColorStop(0.7, 'rgba(6,16,30,0.38)');
      grd.addColorStop(1, 'rgba(6,16,30,0.6)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 256, 144);
      tex.refresh();
    }
  }
  if (!scene.textures.exists('fx-shaft')) {
    // A soft shaft of light falling from above: brightest just above its foot, fading upwards and
    // out to the sides (the results winner stands in one).
    const tex = scene.textures.createCanvas('fx-shaft', 128, 512);
    if (tex) {
      const ctx = tex.getContext();
      const img = ctx.createImageData(128, 512);
      for (let y = 0; y < 512; y++) {
        const v = y / 511;
        const up = Math.min(1, v / 0.8) ** 1.6;
        const foot = v > 0.9 ? 1 - (v - 0.9) / 0.1 : 1;
        for (let x = 0; x < 128; x++) {
          const u = (x - 63.5) / 64;
          const a = Math.exp(-u * u * 4.5) * up * foot;
          const i = (y * 128 + x) * 4;
          img.data[i] = 255;
          img.data[i + 1] = 255;
          img.data[i + 2] = 255;
          img.data[i + 3] = Math.round(a * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
      tex.refresh();
    }
  }
  if (!scene.textures.exists('fx-rays')) {
    // Soft sunburst: blurred wedges that fade out from the centre (results spotlight).
    const S = 512;
    const tex = scene.textures.createCanvas('fx-rays', S, S);
    if (tex) {
      const ctx = tex.getContext();
      const c = S / 2;
      ctx.filter = 'blur(7px)';
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * Math.PI * 2;
        const grd = ctx.createRadialGradient(c, c, 16, c, c, c - 10);
        grd.addColorStop(0, 'rgba(255,255,255,0.95)');
        grd.addColorStop(0.45, 'rgba(255,255,255,0.4)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, c - 12, a0, a0 + (i % 2 ? 0.1 : 0.16));
        ctx.closePath();
        ctx.fill();
      }
      ctx.filter = 'none';
      tex.refresh();
    }
  }
  if (!scene.textures.exists('fx-contact')) {
    // Tighter contact shadow: a dense core with a short falloff, so it reads around the feet.
    const tex = scene.textures.createCanvas('fx-contact', 128, 128);
    if (tex) {
      const ctx = tex.getContext();
      const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(6,14,22,0.92)');
      grd.addColorStop(0.45, 'rgba(6,14,22,0.78)');
      grd.addColorStop(0.75, 'rgba(6,14,22,0.32)');
      grd.addColorStop(1, 'rgba(6,14,22,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 128, 128);
      tex.refresh();
    }
  }
  if (!scene.textures.exists('fx-target')) {
    // Landing target: a soft filled disc with a bright rim (tinted per use).
    const tex = scene.textures.createCanvas('fx-target', 128, 128);
    if (tex) {
      const ctx = tex.getContext();
      const grd = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
      grd.addColorStop(0, 'rgba(255,255,255,0.28)');
      grd.addColorStop(0.75, 'rgba(255,255,255,0.45)');
      grd.addColorStop(0.9, 'rgba(255,255,255,0.95)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(64, 64, 62, 0, Math.PI * 2);
      ctx.fill();
      tex.refresh();
    }
  }
  if (!scene.textures.exists('fx-ring')) {
    g.lineStyle(6, 0xffffff, 1);
    g.strokeCircle(64, 64, 58);
    g.generateTexture('fx-ring', 128, 128);
    g.clear();
  }
  g.destroy();
}
