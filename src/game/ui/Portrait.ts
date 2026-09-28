import Phaser from 'phaser';
import { PLAYER_COLORS } from '../constants';
import { CHARACTERS, type CharacterId } from '../data/characters';
import { HERO_DATA, HERO_FEET } from '../data/heroSprites.generated';
import { PlayerBadge } from './PlayerBadge';

/**
 * Place a portrait sprite (idle frame '0') so the character's face sits `faceY` below the portrait
 * centre. 3D heroes are framed on their face anchor; the 2D sheets keep a fixed crop.
 */
export function placePortraitSprite(sprite: Phaser.GameObjects.Sprite, characterId: CharacterId, scale: number, faceY: number, flip: boolean): void {
  const face = HERO_DATA.points[characterId]?.face;
  sprite.setScale(scale).setFlipX(flip);
  if (face && sprite.texture.key === `hero_${characterId}`) {
    sprite.setOrigin(HERO_FEET.x / HERO_FEET.size, HERO_FEET.y / HERO_FEET.size);
    sprite.setPosition((flip ? face[0] : -face[0]) * scale, faceY - face[1] * scale);
  } else {
    sprite.setOrigin(0.5, 0.62).setPosition(0, faceY + 95 * scale);
  }
}

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
  const portrait = scene.add.sprite(0, 0, CHARACTERS[characterId].atlas, '0');
  placePortraitSprite(portrait, characterId, 0.62 * k, 0.26 * r, !!opts.flip);
  const maskG = scene.make.graphics({ x: 0, y: 0 }, false);
  maskG.fillStyle(0xffffff);
  maskG.fillCircle(opts.worldX, opts.worldY, r - 3 * k);
  portrait.setMask(maskG.createGeometryMask());
  root.add([disc, portrait]);
  if (opts.badge !== false) root.add(new PlayerBadge(scene, opts.flip ? -r * 0.78 : r * 0.78, -r * 0.62, slot, Math.max(12, 16 * k)));
  return root;
}
