import Phaser from 'phaser';
import { PLAYER_COLORS } from '../constants';
import { CHARACTERS, type CharacterId } from '../data/characters';
import { PlayerBadge } from './PlayerBadge';

export interface PortraitOptions {
  /** Face the other way (right-hand HUD panels). */
  flip?: boolean;
  /** Where the portrait's centre ends up on screen; the circular mask is placed in world space. */
  worldX: number;
  worldY: number;
  /** Show the player's shape badge on the rim. */
  badge?: boolean;
}

/**
 * Round character portrait used by the HUDs: cream rim, character-tinted disc with a sheen, the
 * character's head and shoulders masked to the circle, and a ring in the player's colour.
 */
export function addPortrait(scene: Phaser.Scene, characterId: CharacterId, slot: number, r: number, opts: PortraitOptions): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0);
  const k = r / 56;
  const disc = scene.add.graphics();
  disc.fillStyle(0x06141a, 0.3);
  disc.fillCircle(3 * k, 5 * k, r + 4 * k);
  disc.fillStyle(0xfff4dc, 1);
  disc.fillCircle(0, 0, r + 4 * k);
  disc.fillStyle(CHARACTERS[characterId].color, 0.55);
  disc.fillCircle(0, 0, r);
  disc.fillStyle(0xffffff, 0.25);
  disc.fillEllipse(-r * 0.25, -r * 0.45, r * 1.1, r * 0.6);
  const portrait = scene.add.sprite(0, 74 * k, CHARACTERS[characterId].atlas, '0');
  portrait
    .setOrigin(0.5, 0.62)
    .setScale(0.62 * k)
    .setFlipX(!!opts.flip);
  const maskG = scene.make.graphics({ x: 0, y: 0 }, false);
  maskG.fillStyle(0xffffff);
  maskG.fillCircle(opts.worldX, opts.worldY, r);
  portrait.setMask(maskG.createGeometryMask());
  const ring = scene.add.graphics();
  ring.lineStyle(Math.max(3, 6 * k), PLAYER_COLORS[slot], 1);
  ring.strokeCircle(0, 0, r + k);
  root.add([disc, portrait, ring]);
  if (opts.badge !== false) root.add(new PlayerBadge(scene, opts.flip ? -r * 0.78 : r * 0.78, -r * 0.62, slot, Math.max(12, 16 * k)));
  return root;
}
