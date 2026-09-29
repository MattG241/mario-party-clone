import Phaser from 'phaser';
import { audio } from '../audio/AudioManager';
import { CAMERA_ZOOM, GAME_HEIGHT, GAME_WIDTH } from '../constants';
import type { Controls } from '../input/Controls';
import { settings } from '../save/SettingsManager';
import type { BoardScene } from '../scenes/BoardScene';
import type { PlayerState } from '../state/MatchState';
import { UI } from '../ui/Style';
import { addText } from '../ui/theme';

/** Screen px per second the view pans at full stick. */
const PAN_SPEED = 1150;
/** Closest the map zooms in. */
const MAX_ZOOM = 1.3;
/** Where the off-screen Star Coin pointer may sit: clear of the HUD corners and the prompt bar. */
const SAFE = { left: 150, right: GAME_WIDTH - 150, top: 230, bottom: GAME_HEIGHT - 230 };

/** "7 steps", "1 step", "here!" (standing on it), "–" (no way there right now). */
function stepsLabel(n: number): string {
  if (!Number.isFinite(n)) return '–';
  if (n === 0) return 'here!';
  return `${n} step${n === 1 ? '' : 's'}`;
}

/** The map card's line for the player looking: "12 steps away", "You're on it!". */
function awayLabel(n: number): string {
  if (!Number.isFinite(n)) return 'Out of reach';
  return n === 0 ? "You're on it!" : `${stepsLabel(n)} away`;
}

/**
 * The map (X before spinning): the camera leaves the player so they can look around the board.
 * The left stick or D-pad pans, LB / RB (or the right stick, or the triggers) zoom, and a card marks
 * the Star Coin with how many steps away it is (pointing at it from the edge when it's out of view;
 * everyone's own count is on the HUD). B or X hands the camera back to the player.
 */
export async function mapView(scene: BoardScene, c: Controls, p: PlayerState): Promise<void> {
  const ui = scene.ui;
  const cam = scene.cameras.main;
  const rect = scene.overviewRect();
  const minZ = scene.overviewZoom() * 0.95;
  const reduced = settings.get().reducedMotion;
  const home = scene.moves.token(p.slot);
  // Open a little wider than the turn shot, still centred on the player.
  let zoom = Phaser.Math.Clamp(Math.sqrt(minZ * CAMERA_ZOOM.turn), minZ, MAX_ZOOM);
  let targetZ = zoom;
  let cx = Phaser.Math.Clamp(home.x, rect.left, rect.right);
  let cy = Phaser.Math.Clamp(home.y - 120, rect.top, rect.bottom);
  let vx = 0;
  let vy = 0;
  audio.play('whoosh', { volume: 0.5 });

  const root = ui.add.container(0, 0).setDepth(450);
  // "MAP" under the round card, so it's clear the camera is free.
  const head = ui.add.container(GAME_WIDTH / 2, 112);
  const hg = ui.add.graphics();
  hg.fillStyle(UI.shadow, 0.25);
  hg.fillRoundedRect(-78, -17, 156, 38, 19);
  hg.fillStyle(UI.slate, UI.slateAlpha);
  hg.fillRoundedRect(-78, -20, 156, 38, 19);
  head.add([hg, addText(ui, 0, -1, 'MAP VIEW', 20, { color: '#ffffff', weight: 700, fixed: true })]);
  root.add(head);

  // Where the Star Coin is (a pointer at the screen edge when it's out of view).
  const coin = ui.add.container(0, 0);
  const coinG = ui.add.graphics();
  const coinIcon = ui.add.image(0, 0, 'prism-relic').setScale(0.17);
  const coinTitle = addText(ui, 0, -13, 'STAR COIN', 17, { color: UI.focusCss, weight: 700, align: 'left', fixed: true });
  const coinSteps = addText(ui, 0, 12, '', 22, { color: '#ffffff', weight: 700, align: 'left', fixed: true });
  const arrow = ui.add.graphics();
  coin.add([arrow, coinG, coinIcon, coinTitle, coinSteps]);
  root.add(coin);
  let cardW = 0;
  let shownAway = '';
  const drawCard = (text: string) => {
    shownAway = text;
    coinSteps.setText(text);
    const textW = Math.max(coinTitle.width, coinSteps.width);
    cardW = 18 + 40 + 10 + textW + 22;
    const x0 = -cardW / 2;
    coinIcon.setPosition(x0 + 18 + 20, 0);
    coinTitle.setX(x0 + 68);
    coinSteps.setX(x0 + 68);
    coinG.clear();
    coinG.fillStyle(UI.shadow, 0.25);
    coinG.fillRoundedRect(x0, -30, cardW, 64, 30);
    coinG.fillStyle(UI.slate, UI.slateAlpha);
    coinG.fillRoundedRect(x0, -33, cardW, 64, 30);
    coinG.lineStyle(3, UI.focus, 1);
    coinG.strokeRoundedRect(x0 + 1.5, -31.5, cardW - 3, 61, 29);
  };

  /** World → screen for the camera as it stands (after bounds clamping). */
  const toScreen = (x: number, y: number) => {
    const mx = cam.scrollX + GAME_WIDTH / 2;
    const my = cam.scrollY + GAME_HEIGHT / 2;
    return { x: (x - mx) * cam.zoom + GAME_WIDTH / 2, y: (y - my) * cam.zoom + GAME_HEIGHT / 2 };
  };

  const layout = (time: number) => {
    const away = awayLabel(scene.stepsToStarCoin(p));
    if (away !== shownAway) drawCard(away);
    // The card floats over the Star Coin, or points at it from the edge of the view.
    const rp = scene.board.relicPos();
    const s = toScreen(rp.x, rp.y);
    const inside = s.x > SAFE.left - 60 && s.x < SAFE.right + 60 && s.y > SAFE.top - 40 && s.y < SAFE.bottom + 120;
    arrow.clear();
    arrow.fillStyle(UI.focus, 1);
    if (inside) {
      coin.setPosition(s.x, s.y - 100 - (reduced ? 0 : Math.sin(time / 300) * 5));
      arrow.fillTriangle(-13, 30, 13, 30, 0, 50);
      return;
    }
    const px = Phaser.Math.Clamp(s.x, SAFE.left + cardW / 2 - 60, SAFE.right - cardW / 2 + 60);
    const py = Phaser.Math.Clamp(s.y, SAFE.top, SAFE.bottom);
    coin.setPosition(px, py);
    // A gold arrowhead just outside the card's rim, aimed at the coin.
    const ang = Math.atan2(s.y - py, s.x - px);
    const rx = cardW / 2 + 16;
    const ry = 50;
    const k = 1 / Math.sqrt((Math.cos(ang) / rx) ** 2 + (Math.sin(ang) / ry) ** 2);
    const tip = { x: Math.cos(ang) * (k + 16), y: Math.sin(ang) * (k + 16) };
    const back = (da: number) => ({ x: tip.x - Math.cos(ang + da) * 26, y: tip.y - Math.sin(ang + da) * 26 });
    const l = back(0.5);
    const r = back(-0.5);
    arrow.fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
  };

  ui.setPrompts(
    [
      { button: 'STICK', label: 'Look around' },
      { button: 'LB', label: 'Zoom out' },
      { button: 'RB', label: 'Zoom in' },
      { button: 'B', label: 'Back' },
    ],
    p.slot,
  );
  await scene.focus(cx, cy, zoom, reduced ? 0 : 420);
  layout(scene.time.now);
  root.setAlpha(0);
  ui.tweens.add({ targets: root, alpha: 1, duration: 180 });

  await ui.poll((dt) => {
    if (ui.interruptCheck() || c.pressed('B') || c.pressed('X')) return true;
    const s = Math.min(dt, 50) / 1000;
    // Pan with a little easing, so a flick of the stick glides rather than jerks.
    const a = Math.min(1, dt * 0.012);
    vx += ((c.moveX * PAN_SPEED) / zoom - vx) * a;
    vy += ((c.moveY * PAN_SPEED) / zoom - vy) * a;
    cx = Phaser.Math.Clamp(cx + vx * s, rect.left, rect.right);
    cy = Phaser.Math.Clamp(cy + vy * s, rect.top, rect.bottom);
    const zin = (c.held('RB') ? 1 : 0) - (c.held('LB') ? 1 : 0) - c.aimY + c.rt - c.lt;
    if (Math.abs(zin) > 0.05) targetZ = Phaser.Math.Clamp(targetZ * Math.exp(Phaser.Math.Clamp(zin, -1, 1) * 1.5 * s), minZ, MAX_ZOOM);
    zoom += (targetZ - zoom) * Math.min(1, dt * 0.012);
    cam.setZoom(zoom);
    cam.centerOn(cx, cy);
    layout(scene.time.now);
    return undefined;
  });

  audio.play('cancel', { volume: 0.5 });
  ui.setPrompts([]);
  ui.tweens.add({ targets: root, alpha: 0, duration: 160, onComplete: () => root.destroy(true) });
  // Back to the turn shot the pre-roll prompt had.
  const t = scene.moves.token(p.slot);
  await scene.focus(t.x, t.y - 160, CAMERA_ZOOM.turn, reduced ? 0 : 450);
}
