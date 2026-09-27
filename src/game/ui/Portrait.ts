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
 * Round character portrait used by the HUDs: white rim, a slim ring in the player's colour, the
 * character's colour disc and their head and shoulders masked to the circle.
 */
export function addPortrait(scene: Phaser.Scene, characterId: CharacterId, slot: number, r: number, opts: PortraitOptions): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0);
  const k = r / 56;
  const disc = scene.add.graphics();
  disc.fillStyle(0x0a1120, 0.28);
  disc.fillCircle(0, 4 * k, r + 6 * k);
  disc.fillStyle(0xffffff, 1);
  disc.fillCircle(0, 0, r + 6 * k);
  disc.fillStyle(PLAYER_COLORS[slot], 1);
  disc.fillCircle(0, 0, r + 1 * k);
  disc.fillStyle(CHARACTERS[characterId].color, 1);
  disc.fillCircle(0, 0, r - 3 * k);
  disc.fillStyle(0xffffff, 0.22);
  disc.fillCircle(0, -r * 0.35, r * 0.62);
  const portrait = scene.add.sprite(0, 74 * k, CHARACTERS[characterId].atlas, '0');
  portrait
    .setOrigin(0.5, 0.62)
    .setScale(0.62 * k)
    .setFlipX(!!opts.flip);
  const maskG = scene.make.graphics({ x: 0, y: 0 }, false);
  maskG.fillStyle(0xffffff);
  maskG.fillCircle(opts.worldX, opts.worldY, r - 3 * k);
  portrait.setMask(maskG.createGeometryMask());
  root.add([disc, portrait]);
  if (opts.badge !== false) root.add(new PlayerBadge(scene, opts.flip ? -r * 0.78 : r * 0.78, -r * 0.62, slot, Math.max(12, 16 * k)));
  return root;
}
