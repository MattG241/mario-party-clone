import Phaser from 'phaser';
import { COLORS, CSS, DEPTH, PLAYER_COLORS } from '../constants';
import { NPCS, npcFrame, type NpcId } from '../data/npcs';
import { renderedManifestKey, renderedTileKey, type RenderedBoard } from '../data/rendered';
import { clampTexture } from '../util/texture';
import type { MatchState } from '../state/MatchState';
import { addText } from '../ui/theme';
import { centerOrigin, standOrigin } from '../util/spriteUtil';
import { BoardGraph } from './BoardGraph';
import type { BoardDef, BoardNodeDef } from './types';

const NODE_SCALE = 0.92;
/** Display scale of the 3D space renders (rendered at 2x; a touch smaller than 1:1 to keep paths airy). */
const RENDERED_SPACE_SCALE = 0.46;

interface NodeView {
  def: BoardNodeDef;
  tile: Phaser.GameObjects.Image;
  /** Resting scale of the tile (the rendered 3D spaces and the vector fallback differ). */
  tileScale: number;
  overlay: Phaser.GameObjects.Container;
  surge?: Phaser.GameObjects.Image;
  trap?: Phaser.GameObjects.Container;
}

/** Deterministic pseudo-random from a string (for organic path wobble). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** Renders a board and keeps its dynamic visuals in sync with the match state. */
export class BoardManager {
  readonly graph: BoardGraph;
  readonly nodes = new Map<string, NodeView>();
  readonly decorations = new Map<string, Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform>();
  /** Fork arrows on the ground (grown when the camera pulls back so junctions stay readable). */
  private chevrons: Phaser.GameObjects.Image[] = [];
  private bridgeLayer!: Phaser.GameObjects.Container;
  private detourLayer!: Phaser.GameObjects.Container;
  private relic!: Phaser.GameObjects.Container;
  private relicGlow!: Phaser.GameObjects.Image;
  private keeper!: Phaser.GameObjects.Sprite;
  private portalBadges = new Map<string, Phaser.GameObjects.Container>();
  private portalSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private gate?: Phaser.GameObjects.Image;
  private gateBars?: Phaser.GameObjects.Graphics;
  private bridgeBroken = false;
  /** Trails and stepping stones are part of the pre-rendered terrain. */
  private bakedPaths = false;
  /** Placeholder decoration textures superseded by rendered landmarks. */
  private replacedDecor = new Set<string>();
  npcs = new Map<NpcId, Phaser.GameObjects.Sprite>();

  constructor(
    private scene: Phaser.Scene,
    readonly def: BoardDef,
  ) {
    this.graph = new BoardGraph(def);
  }

  pos(id: string): { x: number; y: number } {
    const n = this.graph.node(id);
    return { x: n.x, y: n.y };
  }

  /** Pre-rendered terrain for this board, if every tile loaded. */
  private rendered(): RenderedBoard | null {
    const man = this.scene.cache.json.get(renderedManifestKey(this.def.id)) as RenderedBoard | undefined;
    if (!man?.tiles?.length) return null;
    return man.tiles.every((t) => this.scene.textures.exists(renderedTileKey(this.def.id, t.file))) ? man : null;
  }

  build(state: MatchState): void {
    this.makeTextures();
    const s = this.scene;
    const baked = this.rendered();
    if (baked) {
      // Pre-rendered 3D terrain: islands, trails, stepping stones and scenery in one lit diorama.
      const k = 1 / baked.scale;
      // The islands' soft shadow on the cloud sea far below grounds the whole board.
      const sh = baked.shadow;
      if (sh && s.textures.exists(renderedTileKey(this.def.id, sh.file))) {
        s.add.image(sh.x, sh.y, renderedTileKey(this.def.id, sh.file)).setOrigin(0).setDisplaySize(sh.w, sh.h).setDepth(DEPTH.islands - 5).setAlpha(0.55);
      }
      for (const t of baked.tiles) {
        const key = renderedTileKey(this.def.id, t.file);
        clampTexture(s, key);
        s.add
          .image(baked.origin[0] + t.x * k, baked.origin[1] + t.y * k, key)
          .setOrigin(0)
          .setScale(k)
          .setDepth(DEPTH.islands);
      }
    } else {
      // Vector placeholder islands (drawn back to front).
      [...this.def.islands]
        .sort((a, b) => a.y - b.y)
        .forEach((isl, i) => {
          const img = s.add.image(isl.x, isl.y, isl.texture).setOrigin(0.5, 0).setScale(isl.scale ?? 1).setFlipX(!!isl.flipX);
          img.setDepth(DEPTH.islands + i * 0.01);
          if (isl.bob) s.tweens.add({ targets: img, y: isl.y - isl.bob, duration: 2400 + i * 170, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
        });
    }
    this.bakedPaths = !!baked?.bakedPaths;
    // Pre-rendered landmarks (depth-sorted with the characters by their ground anchor).
    const replaced = new Set<string>();
    for (const p of baked?.props ?? []) {
      const key = renderedTileKey(this.def.id, p.file);
      if (!s.textures.exists(key)) continue;
      const img = s.add.image(p.anchorX, p.baseY, key);
      img.setDisplaySize(p.w, p.h).setOrigin((p.anchorX - p.x) / p.w, (p.baseY - p.y) / p.h);
      img.setDepth(p.depthY ?? p.baseY);
      if (p.kind === 'sails' && p.hub) {
        img.setOrigin((p.hub[0] - p.x) / p.w, (p.hub[1] - p.y) / p.h).setPosition(p.hub[0], p.hub[1]).setDepth(p.baseY + 4);
        s.tweens.add({ targets: img, angle: 360, duration: 9000, repeat: -1 });
      }
      if (p.tex) replaced.add(p.tex);
      this.decorations.set(p.id, img);
      if (p.kind === 'gate') this.gate = img;
    }
    this.replacedDecor = replaced;
    this.bridgeLayer = s.add.container(0, 0).setDepth(DEPTH.paths + 1);
    this.detourLayer = s.add.container(0, 0).setDepth(DEPTH.paths + 1);
    this.drawPaths();
    // Decorations
    for (const d of this.def.decorations) {
      if (this.replacedDecor.has(d.texture)) continue;
      let obj: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
      if (d.frame !== undefined) {
        obj = s.add.sprite(d.x, d.y, d.texture, d.frame);
        const o = standOrigin(d.texture, d.frame);
        obj.setOrigin(o.x, o.y);
        if (d.anim) (obj as Phaser.GameObjects.Sprite).play(d.anim);
      } else {
        obj = s.add.image(d.x, d.y, d.texture).setOrigin(0.5, 1);
      }
      obj.setScale(d.scale ?? 1).setFlipX(!!d.flipX).setAlpha(d.alpha ?? 1);
      obj.setDepth(d.sorted ? d.y : (d.depth ?? DEPTH.paths - 2));
      if (d.tint !== undefined) obj.setTint(d.tint);
      if (d.bob) s.tweens.add({ targets: obj, y: d.y - d.bob, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      if (d.id) this.decorations.set(d.id, obj);
    }
    // Relic pedestals at every gate.
    if (!this.replacedDecor.has('relic-pedestal')) {
      for (const g of this.def.relicGates) {
        const p = this.pos(g);
        s.add.image(p.x, p.y - 34, 'relic-pedestal').setOrigin(0.5, 1).setScale(0.5).setDepth(p.y - 34);
      }
    }
    // Portals
    for (const n of this.def.nodes.filter((nd) => nd.type === 'portal')) {
      const portal = s.add.sprite(n.x, n.y - 26, 'props', '27').play('portal-idle');
      const o = standOrigin('props', '27');
      portal.setOrigin(o.x, o.y).setScale(0.5).setDepth(n.y - 26);
      this.portalSprites.set(n.id, portal);
      // A small colour gem at the portal's foot marks which portals are paired.
      const badge = s.add.container(n.x + 42, n.y + 8).setDepth(DEPTH.spaces + 3);
      this.portalBadges.set(n.id, badge);
    }
    // Ground chevrons at every fork, pointing along each branch.
    for (const n of this.def.nodes) {
      if (n.next.length < 2) continue;
      for (const to of n.next) {
        const b = this.graph.node(to);
        const ang = Math.atan2(b.y - n.y, b.x - n.x);
        const chev = s.add.image(n.x + Math.cos(ang) * 100, n.y + Math.sin(ang) * 78, 'fork-chevron').setRotation(ang).setDepth(DEPTH.spaces - 1).setScale(1.4);
        s.tweens.add({ targets: chev, alpha: { from: 1, to: 0.55 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
        this.chevrons.push(chev);
      }
    }
    // Prism gate
    for (const gd of this.def.gates) {
      if (!this.replacedDecor.has('prism-gate')) this.gate = s.add.image(gd.prop.x, gd.prop.y, 'prism-gate').setOrigin(0.5, 1).setScale(gd.prop.scale).setDepth(gd.prop.y);
      this.gateBars = s.add.graphics().setDepth(gd.prop.y + 1);
    }
    // Spaces
    for (const n of this.def.nodes) {
      // Pre-rendered 3D space (enamel disc in a stone socket) when available, else the vector tile.
      const rk = `rendered-space-${n.type}`;
      const meta = s.cache.json.get('rendered-spaces') as { anchor?: [number, number]; size?: [number, number] } | undefined;
      let tile: Phaser.GameObjects.Image;
      let tileScale = NODE_SCALE;
      if (s.textures.exists(rk) && meta?.anchor && meta.size) {
        tileScale = RENDERED_SPACE_SCALE;
        tile = s.add.image(n.x, n.y, rk).setOrigin(meta.anchor[0] / meta.size[0], meta.anchor[1] / meta.size[1]).setScale(tileScale).setDepth(DEPTH.spaces);
      } else {
        tile = s.add.image(n.x, n.y, `space-${n.type}`).setScale(NODE_SCALE).setDepth(DEPTH.spaces);
      }
      const overlay = s.add.container(n.x, n.y).setDepth(DEPTH.spaces + 1);
      this.nodes.set(n.id, { def: n, tile, tileScale, overlay });
    }
    // NPCs
    this.placeNpc('ora', this.def.hostSpot.x, this.def.hostSpot.y, 'wave');
    const wrenchNode = this.def.nodes.find((n) => n.metadata?.shop === 'wrench');
    if (wrenchNode) this.placeNpc('wrench', wrenchNode.x - 70, wrenchNode.y - 58, 'tool');
    const pipperNode = this.def.nodes.find((n) => n.metadata?.shop === 'pipper');
    if (pipperNode) this.placeNpc('pipper', pipperNode.x + 78, pipperNode.y - 52, 'wave');
    this.placeNpc('mimi', 2020, 1500, 'happy');
    // Relic Keeper + relic
    this.relic = s.add.container(0, 0);
    // A shaft of crystal light rising from the relic: the goal reads from anywhere on the board.
    const beam = s.add.image(0, -120, 'fx-beam').setOrigin(0.5, 1).setDisplaySize(170, 1500).setTint(COLORS.crystal).setAlpha(0.42).setBlendMode(Phaser.BlendModes.ADD);
    const core = s.add.image(0, -120, 'fx-beam').setOrigin(0.5, 1).setDisplaySize(56, 1300).setTint(0xffffff).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD);
    s.tweens.add({ targets: [beam, core], alpha: { from: 0.28, to: 0.5 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.relicGlow = s.add.image(0, -150, 'fx-dot').setScale(9).setTint(COLORS.crystal).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD);
    const relicImg = s.add.image(0, -150, 'prism-relic').setScale(0.36);
    this.relic.add([beam, core, this.relicGlow, relicImg]);
    s.tweens.add({ targets: relicImg, y: -166, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    s.tweens.add({ targets: this.relicGlow, alpha: { from: 0.35, to: 0.7 }, scale: { from: 8, to: 10 }, duration: 1100, yoyo: true, repeat: -1 });
    this.keeper = s.add.sprite(0, 0, 'npcs', npcFrame('packsprout', 'gift'));
    const ko = standOrigin('npcs', npcFrame('packsprout'));
    this.keeper.setOrigin(ko.x, ko.y).setScale(0.52);
    this.placeRelic(state.board.relicGate);
    this.refresh(state);
  }

  private placeNpc(id: NpcId, x: number, y: number, pose: string): void {
    const frame = npcFrame(id, pose);
    const spr = this.scene.add.sprite(x, y, 'npcs', frame);
    const o = standOrigin('npcs', frame);
    // A little smaller than the players (so she never reads as a fifth player), with a name plate.
    spr.setOrigin(o.x, o.y).setScale(0.42).setDepth(y);
    this.npcs.set(id, spr);
    const def = NPCS[id];
    const plate = this.scene.add.container(x, y + 16).setDepth(y + 1);
    const label = addText(this.scene, 0, 0, def.name.toUpperCase(), 17, { color: '#ffffff', weight: 700, fixed: true });
    const pw = label.width + 26;
    const pg = this.scene.add.graphics();
    pg.fillStyle(0x0c2630, 0.85);
    pg.fillRoundedRect(-pw / 2, -13, pw, 26, 13);
    pg.lineStyle(2, def.color, 1);
    pg.strokeRoundedRect(-pw / 2, -13, pw, 26, 13);
    plate.add([pg, label]);
    // Gentle idle breathing.
    this.scene.tweens.add({ targets: spr, scaleY: 0.432, duration: 1200 + Math.random() * 400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  /** Keep fork arrows readable at any zoom (called every frame with the board camera's zoom). */
  scaleForZoom(zoom: number): void {
    const k = 1.4 * Phaser.Math.Clamp(0.9 / zoom, 1, 2);
    for (const c of this.chevrons) if (Math.abs(c.scaleX - k) > 0.01) c.setScale(k);
  }

  npcPose(id: NpcId, pose: string): void {
    const spr = this.npcs.get(id);
    if (!spr) return;
    spr.setFrame(npcFrame(id, pose));
  }

  private placeRelic(gate: string): void {
    const p = this.pos(gate);
    this.relic.setPosition(p.x, p.y - 20).setDepth(p.y - 20);
    this.keeper.setPosition(p.x + 70, p.y - 30).setDepth(p.y - 30);
  }

  /** Relic Keeper walks off and reappears at the new gate. */
  async moveRelic(from: string, to: string): Promise<void> {
    const s = this.scene;
    const a = this.pos(from);
    await new Promise<void>((resolve) => {
      s.tweens.add({ targets: [this.relic, this.keeper], alpha: 0, y: '-=60', duration: 380, ease: 'Quad.In', onComplete: () => resolve() });
    });
    void a;
    this.placeRelic(to);
    this.relic.y -= 60;
    this.keeper.y -= 60;
    await new Promise<void>((resolve) => {
      s.tweens.add({ targets: [this.relic, this.keeper], alpha: 1, y: '+=60', duration: 420, ease: 'Bounce.Out', onComplete: () => resolve() });
    });
  }

  relicPos(): { x: number; y: number } {
    return { x: this.relic.x, y: this.relic.y - 150 };
  }

  keeperSprite(): Phaser.GameObjects.Sprite {
    return this.keeper;
  }

  // --- Paths --------------------------------------------------------------------------------
  private makeTextures(): void {
    const s = this.scene;
    if (!s.textures.exists('fork-chevron')) {
      // Cream double chevron with a teal outline (points along +x).
      const g = s.make.graphics({ x: 0, y: 0 }, false);
      const chevron = (ox: number, fill: number, line: number) => {
        g.fillStyle(fill, 1);
        g.lineStyle(4, line, 1);
        g.beginPath();
        g.moveTo(ox, 6);
        g.lineTo(ox + 16, 20);
        g.lineTo(ox, 34);
        g.lineTo(ox + 8, 34);
        g.lineTo(ox + 24, 20);
        g.lineTo(ox + 8, 6);
        g.closePath();
        g.fillPath();
        g.strokePath();
      };
      g.fillStyle(0x0b1a24, 0.25);
      g.fillEllipse(26, 24, 50, 20);
      chevron(6, 0xfff4dc, 0x117a77);
      chevron(22, 0xffe08a, 0x117a77);
      g.generateTexture('fork-chevron', 56, 40);
      g.destroy();
    }
    if (!s.textures.exists('fx-beam')) {
      // Vertical light shaft: soft horizontal falloff, fading out towards the top.
      const tex = s.textures.createCanvas('fx-beam', 64, 512);
      if (tex) {
        const ctx = tex.getContext();
        const img = ctx.createImageData(64, 512);
        for (let y = 0; y < 512; y++) {
          const v = Math.pow(y / 511, 1.6);
          for (let x = 0; x < 64; x++) {
            const u = (x - 31.5) / 32;
            const a = Math.exp(-u * u * 5) * v;
            const i = (y * 64 + x) * 4;
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
    if (!s.textures.exists('path-stone')) {
      const g = s.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x8d6a45, 1);
      g.fillEllipse(24, 17, 46, 28);
      g.fillStyle(0xeadbb5, 1);
      g.fillEllipse(24, 14, 42, 24);
      g.fillStyle(0xfff4dc, 0.55);
      g.fillEllipse(20, 11, 22, 10);
      g.generateTexture('path-stone', 48, 32);
      g.clear();
      // Floating stepping stone
      g.fillStyle(0x4a3f55, 1);
      g.fillTriangle(10, 22, 70, 22, 40, 64);
      g.fillStyle(0x7d5c3e, 1);
      g.fillEllipse(40, 24, 72, 26);
      g.fillStyle(0x6cc24a, 1);
      g.fillEllipse(40, 18, 70, 24);
      g.fillStyle(0xa8e27a, 0.6);
      g.fillEllipse(34, 14, 36, 10);
      g.generateTexture('path-step', 80, 66);
      g.clear();
      // Bridge plank
      g.fillStyle(0x5f3b1c, 1);
      g.fillRoundedRect(0, 0, 30, 70, 5);
      g.fillStyle(0xb07a45, 1);
      g.fillRoundedRect(2, 2, 26, 64, 4);
      g.lineStyle(2, 0x7a4f28, 0.7);
      g.lineBetween(8, 6, 8, 62);
      g.lineBetween(20, 6, 20, 62);
      g.generateTexture('bridge-plank', 30, 70);
      g.destroy();
    }
  }

  private edgeStyle(from: string, to: string): 'path' | 'steps' | 'bridge' {
    return this.def.edgeStyles?.[`${from}>${to}`] ?? 'path';
  }

  private curve(a: BoardNodeDef, b: BoardNodeDef): Phaser.Curves.QuadraticBezier {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = (hash(a.id + b.id) - 0.5) * 0.28 * len;
    return new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(a.x, a.y), new Phaser.Math.Vector2(mx + (-dy / len) * bend, my + (dx / len) * bend), new Phaser.Math.Vector2(b.x, b.y));
  }

  private drawPaths(): void {
    const s = this.scene;
    for (const a of this.def.nodes) {
      for (const toId of a.next) {
        const b = this.graph.node(toId);
        const style = this.edgeStyle(a.id, toId);
        const curve = this.curve(a, b);
        const len = curve.getLength();
        const layer = b.metadata?.detour || a.metadata?.detour ? this.detourLayer : null;
        if (this.bakedPaths && style !== 'bridge') continue;
        if (style === 'path') {
          const n = Math.max(2, Math.floor(len / 21));
          for (let i = 1; i < n; i++) {
            const pt = curve.getPoint(i / n);
            const st = s.add.image(pt.x, pt.y, 'path-stone').setDepth(DEPTH.paths);
            const r = hash(`${a.id}${toId}${i}`);
            st.setScale(0.8 + r * 0.35, 0.8 + r * 0.25).setAngle((r - 0.5) * 30);
            if (layer) layer.add(st);
          }
        } else if (style === 'steps') {
          const n = Math.max(2, Math.floor(len / 58));
          for (let i = 1; i < n; i++) {
            const pt = curve.getPoint(i / n);
            const st = s.add.image(pt.x, pt.y + 6, 'path-step').setDepth(DEPTH.paths).setScale(0.62 + hash(`${a.id}${i}`) * 0.2);
            if (layer) layer.add(st);
            s.tweens.add({ targets: st, y: pt.y, duration: 1500 + i * 180, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
          }
        } else {
          this.drawBridgeSegment(curve, len);
        }
      }
    }
  }

  private bridgeSegments: { curve: Phaser.Curves.QuadraticBezier; len: number }[] = [];

  private drawBridgeSegment(curve: Phaser.Curves.QuadraticBezier, len: number): void {
    this.bridgeSegments.push({ curve, len });
  }

  private renderBridge(broken: boolean): void {
    const s = this.scene;
    this.bridgeLayer.removeAll(true);
    const ropes = s.add.graphics();
    this.bridgeLayer.add(ropes);
    let segIndex = 0;
    const total = this.bridgeSegments.length;
    for (const { curve, len } of this.bridgeSegments) {
      const n = Math.max(2, Math.floor(len / 26));
      const pts: Phaser.Math.Vector2[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const pt = curve.getPoint(t);
        // Sag in the middle of the whole bridge.
        const global = (segIndex + t) / total;
        pt.y += Math.sin(global * Math.PI) * 26;
        pts.push(pt);
        if (i === n) continue;
        const brokenHere = broken && global > 0.22 && global < 0.8;
        if (brokenHere) continue;
        const tan = curve.getTangent(t);
        const plank = s.add.image(pt.x, pt.y, 'bridge-plank').setDepth(DEPTH.paths + 1);
        plank.setRotation(Math.atan2(tan.y, tan.x)).setScale(0.9, 0.95);
        this.bridgeLayer.add(plank);
      }
      ropes.lineStyle(5, 0x5f3b1c, 1);
      const off = broken ? 0 : 1;
      for (const side of [-1, 1]) {
        ropes.beginPath();
        pts.forEach((p, i) => {
          const global = (segIndex + i / n) / total;
          if (broken && global > 0.22 && global < 0.8) return;
          const y = p.y + side * 30 - 10 * off;
          if (i === 0 || (broken && global <= 0.23 && i > 0 && (segIndex + (i - 1) / n) / total > 0.22)) ropes.moveTo(p.x, y);
          else ropes.lineTo(p.x, y);
        });
        ropes.strokePath();
      }
      segIndex++;
    }
    if (broken) {
      // Dangling rope ends.
      ropes.lineStyle(5, 0x5f3b1c, 1);
      const left = this.bridgeSegments[0]?.curve.getPoint(0.9);
      const right = this.bridgeSegments[total - 1]?.curve.getPoint(0.1);
      if (left) ropes.lineBetween(left.x, left.y, left.x + 12, left.y + 110);
      if (right) ropes.lineBetween(right.x, right.y, right.x - 12, right.y + 110);
    }
  }

  // --- Dynamic state ------------------------------------------------------------------------
  refresh(state: MatchState): void {
    const b = state.board;
    const broken = b.bridgeBroken !== null;
    if (broken !== this.bridgeBroken || this.bridgeLayer.length === 0) {
      this.bridgeBroken = broken;
      this.renderBridge(broken);
    }
    this.detourLayer.setAlpha(broken ? 1 : 0.28);
    for (const [id, v] of this.nodes) {
      // Closed spaces (the Cloud Steps while the bridge stands) sit dormant: solid but stone-grey.
      const g = this.graph.isOpen(id, b);
      v.tile.setAlpha(1);
      if (g) v.tile.clearTint();
      else v.tile.setTint(0x9fb0b8);
      // Surge glow
      const surged = !!b.surge && b.surge.nodes.includes(id);
      if (surged && !v.surge) {
        v.surge = this.scene.add.image(0, 0, 'fx-ring').setScale(0.9, 0.46).setTint(COLORS.crystal).setBlendMode(Phaser.BlendModes.ADD);
        v.overlay.add(v.surge);
        this.scene.tweens.add({ targets: v.surge, alpha: { from: 1, to: 0.35 }, duration: 600, yoyo: true, repeat: -1 });
        const x2 = addText(this.scene, 44, -36, '×2', 26, { color: CSS.white, stroke: '#0d4f57', strokeThickness: 6, weight: 700, fixed: true });
        x2.setName('x2');
        v.overlay.add(x2);
      } else if (!surged && v.surge) {
        v.surge.destroy();
        v.surge = undefined;
        v.overlay.getByName('x2')?.destroy();
      }
      // Traps
      const trap = b.traps.find((t) => t.nodeId === id);
      if (trap && !v.trap) {
        const c = this.scene.add.container(0, -6);
        const ring = this.scene.add.ellipse(0, 4, 70, 30).setStrokeStyle(4, PLAYER_COLORS[trap.owner], 1);
        const seed = this.scene.add.sprite(0, 0, 'items', '30').play('seed-idle');
        const o = centerOrigin('items', '30');
        seed.setOrigin(o.x, o.y).setScale(0.22);
        c.add([ring, seed]);
        v.overlay.add(c);
        v.trap = c;
      } else if (!trap && v.trap) {
        v.trap.destroy();
        v.trap = undefined;
      }
    }
    // Bouncy springs glow while active
    for (const id of ['spring-gi0', 'spring-gi1', 'spring-gi2']) {
      const d = this.decorations.get(id) as Phaser.GameObjects.Sprite | undefined;
      if (!d) continue;
      if (b.bouncy) d.setTint(0xfff0a0);
      else d.clearTint();
    }
    // Portal pair badges
    const pairs = new Map<string, number>();
    let k = 0;
    for (const id of Object.keys(b.portalLinks).sort()) {
      if (pairs.has(id)) continue;
      pairs.set(id, k);
      pairs.set(b.portalLinks[id], k);
      k++;
    }
    const symbols = ['◆', '●', '▲', '■'];
    const colors = [0x5ce1ff, 0xc49bff, 0xffe08a, 0x8bd346];
    for (const [id, badge] of this.portalBadges) {
      badge.removeAll(true);
      const idx = pairs.get(id) ?? 0;
      const color = colors[idx % colors.length];
      const g = this.scene.add.graphics();
      g.fillStyle(0x0b1a24, 0.35);
      g.fillEllipse(2, 6, 34, 14);
      g.fillStyle(color, 1);
      g.fillCircle(0, -4, 14);
      g.lineStyle(3, 0xffffff, 0.9);
      g.strokeCircle(0, -4, 14);
      const t = addText(this.scene, 0, -5, symbols[idx % symbols.length], 16, { color: '#1b1530', weight: 700, fixed: true });
      badge.add([g, t]);
      this.portalSprites.get(id)?.setTint(0xffffff, 0xffffff, color, color);
    }
    // Gate
    if (this.gate && this.gateBars) {
      const open = b.gatesOpen !== null;
      this.gate.setTint(open ? 0xbfffe0 : 0xffffff);
      this.gateBars.clear();
    }
    // Relic
    this.placeRelic(b.relicGate);
  }

  /** Flash a space (landing feedback). */
  pulseNode(id: string, color: number = COLORS.goldLight): void {
    const v = this.nodes.get(id);
    if (!v) return;
    const ring = this.scene.add.image(v.def.x, v.def.y, 'fx-ring').setScale(0.5, 0.25).setTint(color).setDepth(DEPTH.spaces + 2).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: ring, scaleX: 1.4, scaleY: 0.7, alpha: 0, duration: 520, ease: 'Quad.Out', onComplete: () => ring.destroy() });
    this.scene.tweens.add({ targets: v.tile, scaleX: v.tileScale * 1.12, scaleY: v.tileScale * 0.9, duration: 90, yoyo: true, ease: 'Quad.Out' });
  }

  /** Bounds of all nodes (for overview shots). */
  bounds(): Phaser.Geom.Rectangle {
    const xs = this.def.nodes.map((n) => n.x);
    const ys = this.def.nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return new Phaser.Geom.Rectangle(minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY);
  }
}
