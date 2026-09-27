import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS } from '../constants';
import { CHARACTER_ANIMATIONS } from '../characters/CharacterAnimations';
import { CHARACTERS } from '../data/characters';
import { ITEMS, type ItemId } from '../data/items';
import { npcFrame, type NpcId } from '../data/npcs';
import { EffectsManager } from '../effects/EffectsManager';
import type { Button } from '../input/buttons';
import type { Controls } from '../input/Controls';
import { settings } from '../save/SettingsManager';
import { currentRelicPrice, isFinalRound, type MatchState, type PlayerState } from '../state/MatchState';
import { computeStandings } from '../state/scoring';
import { showBanner, type BannerOpts } from '../ui/Banner';
import { PromptBar, type PromptSpec } from '../ui/ControllerPrompt';
import { DialogBox, type DialogLine } from '../ui/DialogBox';
import { drawPanel } from '../ui/Panel';
import { PlayerBadge } from '../ui/PlayerBadge';
import { PlayerHUD } from '../ui/PlayerHUD';
import { addText, addTitle } from '../ui/theme';
import { centerOrigin, standOrigin } from '../util/spriteUtil';

export interface ListOption {
  label: string;
  detail?: string;
  right?: string;
  disabled?: boolean;
  icon?: { texture: string; frame?: string; scale: number };
  slot?: number;
}

export interface ListMenuSpec {
  title: string;
  subtitle?: string;
  npc?: { id: NpcId; pose: string };
  options: ListOption[];
  /** Human controls (omit for CPU presentation). */
  controls?: Controls;
  slot?: number;
  /** CPU decision to animate toward (index, or -1 for "cancel"). */
  cpuIndex?: number;
  cancellable?: boolean;
  cancelLabel?: string;
  onFocus?: (index: number) => void;
  width?: number;
}

type Poller = (dt: number) => boolean;

/**
 * Board overlay: HUD, round plaque, banners, prompts, menus and dialogs. Every interactive
 * widget returns a Promise so the turn flow can simply await it.
 */
export class BoardUIScene extends Phaser.Scene {
  hud!: PlayerHUD;
  /** Screen-space effects (chips flying into the HUD, etc.). */
  fx!: EffectsManager;
  dialog!: DialogBox;
  prompts!: PromptBar;
  private roundPlaque!: Phaser.GameObjects.Container;
  private roundText!: Phaser.GameObjects.Text;
  private relicText!: Phaser.GameObjects.Text;
  private pollers = new Set<Poller>();
  private scoreboard: Phaser.GameObjects.Container | null = null;
  /** Returns true when the flow wants pending menus cancelled (debug interrupts). */
  interruptCheck: () => boolean = () => false;
  private stateRef!: MatchState;

  constructor() {
    super('BoardUI');
  }

  init(data: { state: MatchState }): void {
    this.stateRef = data.state;
  }

  create(): void {
    this.pollers.clear();
    this.scoreboard = null;
    this.fx = new EffectsManager(this);
    this.hud = new PlayerHUD(this, this.stateRef);
    this.dialog = new DialogBox(this, 3000);
    this.prompts = new PromptBar(this, GAME_WIDTH / 2, GAME_HEIGHT - 40, [], { size: 40, fontSize: 28 }).setDepth(900);
    // Round pill: compact and translucent, matching the corner HUD.
    this.roundPlaque = this.add.container(GAME_WIDTH / 2, 44).setDepth(600);
    const g = this.add.graphics();
    g.fillStyle(0x06141a, 0.25);
    g.fillRoundedRect(-146, -28, 300, 64, 32);
    g.fillStyle(0x0c2630, 0.8);
    g.fillRoundedRect(-150, -32, 300, 64, 32);
    g.lineStyle(3, COLORS.gold, 0.95);
    g.strokeRoundedRect(-150, -32, 300, 64, 32);
    this.roundText = addText(this, 0, -8, 'ROUND 1 / 10', 26, { color: CSS.goldLight, weight: 700 });
    this.relicText = addText(this, 0, 16, '', 16, { color: CSS.cream, weight: 600 });
    this.roundPlaque.add([g, this.roundText, this.relicText]);
    this.refresh(this.stateRef);
  }

  override update(_t: number, dt: number): void {
    for (const p of [...this.pollers]) {
      if (p(dt)) this.pollers.delete(p);
    }
  }

  /** Run `fn` every frame until it returns a value. */
  poll<T>(fn: (dt: number) => T | undefined): Promise<T> {
    return new Promise((resolve) => {
      this.pollers.add((dt) => {
        const v = fn(dt);
        if (v !== undefined) {
          resolve(v);
          return true;
        }
        return false;
      });
    });
  }

  wait(ms: number): Promise<void> {
    let t = 0;
    return this.poll((dt) => ((t += dt) >= ms || this.interruptCheck() ? true : undefined)).then(() => undefined);
  }

  refresh(state: MatchState): void {
    this.stateRef = state;
    this.roundText.setText(isFinalRound(state) ? `FINAL ROUND ${state.round}/${state.config.rounds}` : `ROUND ${state.round} / ${state.config.rounds}`);
    const price = currentRelicPrice(state);
    this.relicText.setText(price < 20 ? `Relic Rush! Relic costs ${price}` : `Prism Relic · ${price} chips`);
    this.hud?.update(state);
  }

  setPrompts(specs: PromptSpec[], slot?: number): void {
    this.prompts.setPrompts(specs, slot);
  }

  banner(o: BannerOpts): Promise<void> {
    return showBanner(this, o);
  }

  /** "KIP QUILL · YOUR TURN" */
  turnBanner(p: PlayerState): Promise<void> {
    const color = PLAYER_COLORS[p.slot];
    const name = CHARACTERS[p.characterId].name;
    return showBanner(this, {
      title: p.isCpu ? `${name.split(' ')[0].toUpperCase()}'S TURN` : 'YOUR TURN',
      subtitle: p.isCpu ? `${name.toUpperCase()} · CPU` : `${name.toUpperCase()} · PLAYER ${p.slot + 1}`,
      color,
      hold: settings.get().gameSpeed === 'fast' ? 500 : 800,
      size: 92,
      sound: 'confirm',
      decorate: (c) => {
        c.add(new PlayerBadge(this, -520, 18, p.slot, 44));
        // First frame of the character's own greeting animation.
        const wave = CHARACTER_ANIMATIONS[p.characterId].wave;
        const atlas = wave.atlas ?? CHARACTERS[p.characterId].atlas;
        const frame = String(wave.frames[0]);
        const portrait = this.add.sprite(520, 110, atlas, frame);
        const o = standOrigin(atlas, frame);
        portrait.setOrigin(o.x, o.y).setScale(0.8);
        c.add(portrait);
      },
    });
  }

  /** Wait for one of `buttons` from `controls`. */
  waitButton(controls: Controls, buttons: Button[]): Promise<Button | null> {
    return this.poll<Button | null>(() => {
      if (this.interruptCheck()) return null;
      for (const b of buttons) if (controls.pressed(b)) return b;
      return undefined;
    });
  }

  dialogLines(lines: DialogLine[], controls: Controls[], auto: boolean): Promise<void> {
    return this.dialog.run(lines, { controls, auto });
  }

  // --- Item radial ----------------------------------------------------------------------------
  /**
   * Radial item picker. Humans use LB/RB or the stick, A to use, B to cancel. For CPUs pass
   * `cpuPick` and the cursor animates to it.
   */
  itemRadial(p: PlayerState, usable: ItemId[], controls?: Controls, cpuPick?: ItemId): Promise<ItemId | null> {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2 + 20;
    const root = this.add.container(cx, cy).setDepth(2000);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x06141a, 0.45);
    const ringG = this.add.graphics();
    ringG.fillStyle(COLORS.tealDeep, 0.9);
    ringG.fillCircle(0, 0, 250);
    ringG.lineStyle(8, COLORS.gold, 1);
    ringG.strokeCircle(0, 0, 250);
    ringG.lineStyle(3, COLORS.crystal, 0.6);
    ringG.strokeCircle(0, 0, 120);
    const title = addTitle(this, 0, -300, 'ITEMS', 52);
    const nameText = addText(this, 0, -18, '', 34, { color: CSS.cream, weight: 700 });
    const descText = addText(this, 0, 26, '', 22, { color: CSS.goldLight, weight: 500, wrap: 210 });
    root.add([dim, ringG, title, nameText, descText]);
    const items = p.items;
    const n = Math.max(1, items.length);
    const slots: { id: ItemId; x: number; y: number; ok: boolean; bg: Phaser.GameObjects.Graphics; icon: Phaser.GameObjects.GameObject }[] = [];
    items.forEach((id, i) => {
      const ang = -Math.PI / 2 + (i * Math.PI * 2) / n;
      const x = Math.cos(ang) * 175;
      const y = Math.sin(ang) * 175;
      const bg = this.add.graphics();
      const ic = ITEMS[id].icon;
      const icon = ic.frame !== undefined ? this.add.sprite(x, y, ic.texture, ic.frame) : this.add.image(x, y, ic.texture);
      if (ic.frame !== undefined) {
        const o = centerOrigin(ic.texture, ic.frame);
        icon.setOrigin(o.x, o.y);
        if (ic.anim) (icon as Phaser.GameObjects.Sprite).play(ic.anim);
      }
      icon.setScale(ic.scale * 0.72);
      const ok = usable.includes(id);
      if (!ok) icon.setAlpha(0.4);
      root.add([bg, icon]);
      slots.push({ id, x, y, ok, bg, icon });
    });
    const hint = new PromptBar(this, 0, 300, controls ? [{ button: 'LB', label: '' }, { button: 'RB', label: 'Choose' }, { button: 'A', label: 'Use' }, { button: 'B', label: 'Back' }] : [], { size: 36, fontSize: 24, slot: p.slot });
    root.add(hint);
    root.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: root, scale: 1, alpha: 1, duration: 200, ease: 'Back.Out' });
    audio.play('pop');
    let index = Math.max(0, slots.findIndex((s) => s.ok));
    const draw = () => {
      slots.forEach((s, i) => {
        s.bg.clear();
        const sel = i === index;
        s.bg.fillStyle(sel ? COLORS.goldLight : COLORS.cream, s.ok ? 1 : 0.6);
        s.bg.fillCircle(s.x, s.y, sel ? 72 : 62);
        s.bg.lineStyle(sel ? 8 : 4, sel ? COLORS.crystal : COLORS.teal, 1);
        s.bg.strokeCircle(s.x, s.y, sel ? 72 : 62);
      });
      const cur = slots[index];
      if (cur) {
        const def = ITEMS[cur.id];
        nameText.setText(def.name);
        descText.setText(cur.ok ? def.description : def.timing === 'passive' ? 'Used automatically at Prism Gates.' : def.timing === 'postRoll' ? 'Offered after you spin.' : 'Can’t be used right now.');
      } else {
        nameText.setText('No items');
        descText.setText('Buy items at markets or win them at events.');
      }
    };
    draw();
    const close = (result: ItemId | null) => {
      this.tweens.add({ targets: root, scale: 0.7, alpha: 0, duration: 150, onComplete: () => root.destroy() });
      return result;
    };
    if (!controls) {
      // CPU: hop the cursor to its pick, then confirm.
      const target = cpuPick ? slots.findIndex((s) => s.id === cpuPick) : -1;
      let t = 0;
      let step = 0;
      return this.poll<ItemId | null>((dt) => {
        t += dt;
        if (this.interruptCheck()) return close(null);
        if (t > 420 && step === 0) {
          step = 1;
          if (target >= 0) {
            index = target;
            audio.play('menuMove');
            draw();
          }
        }
        if (t > 900) {
          if (target >= 0) audio.play('confirm');
          return close(target >= 0 ? slots[target].id : null);
        }
        return undefined;
      });
    }
    let stickLock = false;
    return this.poll<ItemId | null>(() => {
      if (this.interruptCheck()) return close(null);
      if (slots.length > 0) {
        let moved = false;
        if (controls.pressed('RB') || controls.nav() === 'right') {
          index = (index + 1) % slots.length;
          moved = true;
        } else if (controls.pressed('LB') || controls.nav() === 'left') {
          index = (index - 1 + slots.length) % slots.length;
          moved = true;
        } else {
          const mag = Math.hypot(controls.moveX, controls.moveY);
          if (mag > 0.6 && !stickLock) {
            const ang = Math.atan2(controls.moveY, controls.moveX);
            let best = index;
            let bestD = Infinity;
            slots.forEach((s, i) => {
              const d = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(s.y, s.x) - ang));
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            });
            if (best !== index) {
              index = best;
              moved = true;
            }
            stickLock = false;
          }
        }
        if (moved) {
          audio.play('menuMove');
          draw();
        }
      }
      if (controls.pressed('A')) {
        const cur = slots[index];
        if (cur && cur.ok) {
          audio.play('confirm');
          return close(cur.id);
        }
        audio.play('error');
      }
      if (controls.pressed('B') || controls.pressed('Y')) {
        audio.play('cancel');
        return close(null);
      }
      return undefined;
    });
  }

  // --- Generic list menu ------------------------------------------------------------------------
  listMenu(spec: ListMenuSpec): Promise<number | null> {
    const w = spec.width ?? 900;
    const rowH = 92;
    const n = spec.options.length + (spec.cancellable ? 1 : 0);
    const h = 170 + n * (rowH + 12) + (spec.subtitle ? 40 : 0);
    const cx = GAME_WIDTH / 2 + (spec.npc ? 110 : 0);
    const cy = GAME_HEIGHT / 2 + 10;
    const root = this.add.container(cx, cy).setDepth(2000);
    const dim = this.add.rectangle(-cx + GAME_WIDTH / 2, 0, GAME_WIDTH, GAME_HEIGHT, 0x06141a, 0.4);
    const panel = this.add.graphics();
    drawPanel(panel, -w / 2, -h / 2, w, h, { radius: 32 });
    const title = addText(this, 0, -h / 2 + 52, spec.title, 42, { color: CSS.tealDark, weight: 700 });
    root.add([dim, panel, title]);
    if (spec.subtitle) root.add(addText(this, 0, -h / 2 + 96, spec.subtitle, 24, { color: CSS.inkSoft, weight: 500, wrap: w - 80 }));
    if (spec.npc) {
      const frame = npcFrame(spec.npc.id, spec.npc.pose);
      const npc = this.add.sprite(-w / 2 - 110, h / 2 - 10, 'npcs', frame);
      const o = standOrigin('npcs', frame);
      npc.setOrigin(o.x, o.y).setScale(0.95);
      root.add(npc);
    }
    const top = -h / 2 + (spec.subtitle ? 150 : 120);
    const rows: Phaser.GameObjects.Graphics[] = [];
    const labels: string[] = [];
    const all: ListOption[] = [...spec.options, ...(spec.cancellable ? [{ label: spec.cancelLabel ?? 'Never mind' }] : [])];
    all.forEach((o, i) => {
      const y = top + i * (rowH + 12) + rowH / 2;
      const g = this.add.graphics();
      rows.push(g);
      root.add(g);
      let tx = -w / 2 + 50;
      if (o.icon) {
        const ic = o.icon.frame !== undefined ? this.add.sprite(-w / 2 + 90, y, o.icon.texture, o.icon.frame) : this.add.image(-w / 2 + 90, y, o.icon.texture);
        if (o.icon.frame !== undefined) {
          const oo = centerOrigin(o.icon.texture, o.icon.frame);
          ic.setOrigin(oo.x, oo.y);
        }
        ic.setScale(o.icon.scale * 0.5);
        if (o.disabled) ic.setAlpha(0.45);
        root.add(ic);
        tx = -w / 2 + 150;
      }
      if (o.slot !== undefined) {
        root.add(new PlayerBadge(this, -w / 2 + 86, y, o.slot, 26));
        tx = -w / 2 + 140;
      }
      const lab = addText(this, tx, o.detail ? y - 16 : y - 2, o.label, 32, { color: o.disabled ? '#9a9486' : CSS.ink, weight: 700, align: 'left' });
      root.add(lab);
      if (o.detail) root.add(addText(this, tx, y + 22, o.detail, 20, { color: o.disabled ? '#9a9486' : CSS.inkSoft, weight: 500, align: 'left', wrap: w - 360 }));
      if (o.right) root.add(addText(this, w / 2 - 50, y - 2, o.right, 32, { color: o.disabled ? '#b44' : CSS.tealDark, weight: 700, align: 'right' }));
      labels.push(o.label);
    });
    const prompts = new PromptBar(this, 0, h / 2 + 44, spec.controls ? [{ button: 'STICK', label: 'Choose' }, { button: 'A', label: 'Select' }, ...(spec.cancellable ? [{ button: 'B' as const, label: 'Back' }] : [])] : [], { size: 36, fontSize: 24, slot: spec.slot });
    root.add(prompts);
    let index = all.findIndex((o) => !o.disabled);
    if (index < 0) index = all.length - 1;
    const draw = () => {
      all.forEach((o, i) => {
        const y = top + i * (rowH + 12);
        const g = rows[i];
        g.clear();
        const sel = i === index;
        g.fillStyle(COLORS.tealDark, 1);
        g.fillRoundedRect(-w / 2 + 30, y + 6, w - 60, rowH, 20);
        g.fillStyle(sel ? COLORS.goldLight : o.disabled ? 0xe4dccb : COLORS.cream, 1);
        g.fillRoundedRect(-w / 2 + 30, y, w - 60, rowH, 20);
        g.lineStyle(sel ? 6 : 3, sel ? COLORS.crystal : COLORS.teal, 1);
        g.strokeRoundedRect(-w / 2 + 30, y, w - 60, rowH, 20);
      });
      spec.onFocus?.(index);
    };
    draw();
    root.setScale(0.8).setAlpha(0);
    this.tweens.add({ targets: root, scale: 1, alpha: 1, duration: 180, ease: 'Back.Out' });
    audio.play('pop');
    const close = (v: number | null) => {
      this.tweens.add({ targets: root, alpha: 0, scale: 0.85, duration: 140, onComplete: () => root.destroy() });
      return v;
    };
    const cancelIndex = spec.cancellable ? all.length - 1 : -1;
    if (!spec.controls) {
      const target = spec.cpuIndex === undefined || spec.cpuIndex < 0 ? cancelIndex : spec.cpuIndex;
      let t = 0;
      let lastMove = 0;
      const fast = settings.get().gameSpeed === 'fast';
      return this.poll<number | null>((dt) => {
        t += dt;
        if (this.interruptCheck()) return close(null);
        if (t < (fast ? 300 : 550)) return undefined;
        if (index !== target && target >= 0 && t - lastMove > (fast ? 140 : 240)) {
          index += target > index ? 1 : -1;
          lastMove = t;
          audio.play('menuMove');
          draw();
          return undefined;
        }
        if (index === target || target < 0) {
          if (t - lastMove > (fast ? 220 : 420)) {
            audio.play('confirm');
            return close(target === cancelIndex || target < 0 ? null : target);
          }
        }
        return undefined;
      });
    }
    const c = spec.controls;
    return this.poll<number | null>(() => {
      if (this.interruptCheck()) return close(null);
      const nav = c.nav();
      if (nav === 'up' || nav === 'down') {
        const dir = nav === 'up' ? -1 : 1;
        for (let k = 0; k < all.length; k++) {
          index = (index + dir + all.length) % all.length;
          if (!all[index].disabled) break;
        }
        audio.play('menuMove');
        draw();
      }
      if (c.pressed('A')) {
        if (all[index].disabled) {
          audio.play('error');
          return undefined;
        }
        audio.play(index === cancelIndex ? 'cancel' : 'confirm');
        return close(index === cancelIndex ? null : index);
      }
      if (spec.cancellable && c.pressed('B')) {
        audio.play('cancel');
        return close(null);
      }
      return undefined;
    });
  }

  // --- Scoreboard ------------------------------------------------------------------------------
  showScoreboard(state: MatchState): void {
    if (this.scoreboard) return;
    const standings = computeStandings(state.players);
    const w = 1100;
    const h = 170 + standings.length * 120;
    const root = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(2500);
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x06141a, 0.55);
    const g = this.add.graphics();
    drawPanel(g, -w / 2, -h / 2, w, h, { radius: 34 });
    root.add([dim, g, addText(this, 0, -h / 2 + 60, `STANDINGS · ROUND ${state.round}/${state.config.rounds}`, 44, { color: CSS.tealDark, weight: 700 })]);
    standings.forEach((st, i) => {
      const p = state.players.find((pl) => pl.slot === st.slot)!;
      const y = -h / 2 + 150 + i * 120;
      const suffix = st.place === 1 ? 'st' : st.place === 2 ? 'nd' : st.place === 3 ? 'rd' : 'th';
      root.add(addText(this, -w / 2 + 70, y, `${st.place}${suffix}`, 40, { color: CSS.ink, weight: 700 }));
      root.add(new PlayerBadge(this, -w / 2 + 160, y, p.slot, 28));
      const portrait = this.add.sprite(-w / 2 + 240, y + 50, CHARACTERS[p.characterId].atlas, '0');
      const o = standOrigin(CHARACTERS[p.characterId].atlas, '0');
      portrait.setOrigin(o.x, o.y).setScale(0.42);
      root.add(portrait);
      root.add(addText(this, -w / 2 + 310, y, `${CHARACTERS[p.characterId].name}${p.isCpu ? ' (CPU)' : ''}`, 34, { color: CSS.ink, weight: 700, align: 'left' }));
      root.add(this.add.image(w / 2 - 420, y, 'prism-relic').setScale(0.18));
      root.add(addText(this, w / 2 - 385, y, `× ${p.relics}`, 34, { color: CSS.ink, weight: 700, align: 'left' }));
      const chip = this.add.sprite(w / 2 - 250, y, 'items', '0');
      const co = centerOrigin('items', '0');
      chip.setOrigin(co.x, co.y).setScale(0.2);
      root.add(chip);
      root.add(addText(this, w / 2 - 215, y, `× ${p.chips}`, 34, { color: CSS.ink, weight: 700, align: 'left' }));
      p.items.forEach((it, k) => {
        const ic = ITEMS[it].icon;
        const img = ic.frame !== undefined ? this.add.sprite(w / 2 - 120 + k * 48, y, ic.texture, ic.frame) : this.add.image(w / 2 - 120 + k * 48, y, ic.texture);
        if (ic.frame !== undefined) {
          const oo = centerOrigin(ic.texture, ic.frame);
          img.setOrigin(oo.x, oo.y);
        }
        img.setScale(ic.scale * 0.26);
        root.add(img);
      });
    });
    root.setAlpha(0);
    this.tweens.add({ targets: root, alpha: 1, duration: 140 });
    this.scoreboard = root;
  }

  hideScoreboard(): void {
    const sb = this.scoreboard;
    if (!sb) return;
    this.scoreboard = null;
    this.tweens.add({ targets: sb, alpha: 0, duration: 120, onComplete: () => sb.destroy() });
  }

  get scoreboardOpen(): boolean {
    return this.scoreboard !== null;
  }
}
