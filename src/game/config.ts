import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './constants';
import { REALTIME_CLOCK } from './debug/debug';

export function makeConfig(parent: HTMLElement, scenes: Phaser.Types.Scenes.SceneType[]): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO, // WebGL, falling back to Canvas
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#0d3b47',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false,
      // Atlases are power-of-two, so mipmaps keep down-scaled sprites smooth without blurring.
      mipmapFilter: 'LINEAR_MIPMAP_LINEAR',
      powerPreference: 'high-performance',
      batchSize: 4096,
    },
    // Gleamtrail polls gamepads and keyboard itself (src/game/input); Phaser's own plugins stay off.
    input: { keyboard: false, gamepad: false, mouse: true, touch: false },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    // ?realtime (testing on software-rendered browsers) keeps game time locked to wall time even
    // at very low frame rates instead of Phaser's hitch smoothing.
    fps: { target: 60, smoothStep: !REALTIME_CLOCK },
    audio: { noAudio: true },
    disableContextMenu: true,
    banner: false,
    scene: scenes,
  };
}
