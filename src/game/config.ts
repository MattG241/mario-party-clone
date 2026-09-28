import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './constants';
import { REALTIME_CLOCK } from './debug/debug';
import { GradePipeline } from './effects/GradePipeline';
import { LITE } from './perf';

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
      // Atlases are power-of-two, so mipmaps keep down-scaled sprites smooth without blurring
      // (Lite skips them: a third more texture memory, and slow to build on TV chips).
      mipmapFilter: LITE ? '' : 'LINEAR_MIPMAP_LINEAR',
      // Multisampled canvas edges cost a lot of fill rate and memory on weak GPUs.
      antialiasGL: !LITE,
      powerPreference: 'high-performance',
      batchSize: 4096,
      // Phaser picks its single-texture shader only for phones; TV browsers (Tizen, webOS) report
      // Linux and would get the desktop one, which samples every bound texture for every pixel.
      ...(LITE ? { defaultPipeline: 'MobilePipeline' } : {}),
    },
    // Gleamtrail polls gamepads and keyboard itself (src/game/input); Phaser's own plugins stay off.
    input: { keyboard: false, gamepad: false, mouse: true, touch: false },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    // ?realtime (testing on software-rendered browsers) keeps game time locked to wall time even
    // at very low frame rates instead of Phaser's hitch smoothing.
    // Lite holds a steady 30 fps rather than stuttering between rates.
    fps: { target: 60, smoothStep: !REALTIME_CLOCK, ...(LITE ? { limit: 30 } : {}) },
    pipeline: { Grade: GradePipeline } as unknown as Phaser.Types.Core.PipelineConfig,
    audio: { noAudio: true },
    disableContextMenu: true,
    banner: false,
    scene: scenes,
  };
}
