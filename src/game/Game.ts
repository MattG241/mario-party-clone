import Phaser from 'phaser';
import { audio } from './audio/AudioManager';
import { makeConfig } from './config';
import { decideLite, LITE, setLite } from './perf';
import { debugInfo, logError, URL_PARAMS } from './debug/debug';
import { input } from './input/InputManager';
import { ALL_MINIGAME_SCENES } from './minigames/registry';
import { settings } from './save/SettingsManager';
import { session } from './state/Session';
import { BoardBgScene } from './scenes/BoardBgScene';
import { BoardScene } from './scenes/BoardScene';
import { BoardUIScene } from './scenes/BoardUIScene';
import { BootScene } from './scenes/BootScene';
import { CharacterSelectScene } from './scenes/CharacterSelectScene';
import { DevLaunchScene } from './scenes/DevLaunchScene';
import { FinalResultsScene } from './scenes/FinalResultsScene';
import { GamepadDebugScene } from './scenes/GamepadDebugScene';
import { PadSetupScene } from './scenes/PadSetupScene';
import { GameSetupScene } from './scenes/GameSetupScene';
import { HowToPlayScene } from './scenes/HowToPlayScene';
import { MinigameIntroScene } from './scenes/MinigameIntroScene';
import { MinigameModeScene } from './scenes/MinigameModeScene';
import { PauseScene } from './scenes/PauseScene';
import { PreloadScene } from './scenes/PreloadScene';
import { ResultsScene } from './scenes/ResultsScene';
import { SettingsScene } from './scenes/SettingsScene';
import { SystemScene } from './scenes/SystemScene';
import { TitleScene } from './scenes/TitleScene';
import { guardStaleText } from './util/staleText';

declare global {
  interface Window {
    /** Test / diagnostics hook (read by the Playwright smoke test). */
    __GLEAMTRAIL__?: { game: Phaser.Game; ready: boolean; errors: string[]; session: typeof session; debug: typeof debugInfo; audio: typeof audio };
  }
}

export function createGame(parent: HTMLElement): Phaser.Game {
  const scenes: Phaser.Types.Scenes.SceneType[] = [
    BootScene,
    PreloadScene,
    TitleScene,
    CharacterSelectScene,
    GameSetupScene,
    MinigameModeScene,
    HowToPlayScene,
    SettingsScene,
    GamepadDebugScene,
    PadSetupScene,
    BoardBgScene,
    BoardScene,
    BoardUIScene,
    MinigameIntroScene,
    ...ALL_MINIGAME_SCENES,
    ResultsScene,
    FinalResultsScene,
    DevLaunchScene,
    PauseScene,
    // Always last so it draws on top of everything.
    SystemScene,
  ];
  // Graphics level first: it picks the textures and renderer options (see perf.ts).
  setLite(decideLite(settings.get().graphics));
  const game = new Phaser.Game(makeConfig(parent, scenes));
  watchFrameRate(game);

  // Input: poll every device once per frame, before any scene updates.
  input.attach(window);
  const applyInputSettings = () => {
    const s = settings.get();
    input.keyboard.setBindings(s.keyBindings);
    input.configure({ deadzone: s.deadzone, vibration: s.vibration, padMappings: s.padMappings, nintendoByLabel: s.nintendoByLabel });
  };
  applyInputSettings();
  settings.onChange((_, changed) => {
    if (changed.some((k) => k === 'keyBindings' || k === 'deadzone' || k === 'vibration' || k === 'padMappings' || k === 'nintendoByLabel')) applyInputSettings();
  });
  game.events.on(Phaser.Core.Events.PRE_STEP, (time: number) => {
    input.update(time);
    if (input.any.pressed('A') || input.any.pressed('MENU')) audio.unlock();
  });
  // Pause music when the tab is hidden.
  game.events.on(Phaser.Core.Events.HIDDEN, () => audio.stopMusic(0.2));

  window.__GLEAMTRAIL__ = { game, ready: false, errors: [], session, debug: debugInfo, audio };
  guardStaleText((msg) => {
    console.warn(msg);
    logError(msg);
    window.__GLEAMTRAIL__?.errors.push(msg);
  });
  window.addEventListener('error', (e) => {
    logError(String(e.message));
    window.__GLEAMTRAIL__?.errors.push(String(e.message));
  });
  window.addEventListener('unhandledrejection', (e) => {
    logError(String(e.reason));
    window.__GLEAMTRAIL__?.errors.push(String(e.reason));
  });
  return game;
}

/**
 * On "Auto" graphics, a device that can't hold even a slow frame rate on full graphics (well under
 * 20 fps once the title screen is up) switches itself to Lite and reloads, and remembers that.
 */
function watchFrameRate(game: Phaser.Game): void {
  if (LITE || settings.get().graphics !== 'auto') return;
  // Never under automation (tests and recordings run on slow software GL on purpose) or when the
  // URL picks a level.
  if (navigator.webdriver || ['lite', 'full', 'realtime'].some((k) => URL_PARAMS.has(k))) return;
  let frames = 0;
  let since = 0;
  game.events.on(Phaser.Core.Events.POST_STEP, () => {
    if (!window.__GLEAMTRAIL__?.ready) return;
    const now = performance.now();
    if (!since) since = now;
    frames++;
    const secs = (now - since) / 1000;
    if (secs < 6) return;
    const fps = frames / secs;
    frames = 0;
    since = now;
    if (fps < 18 && settings.get().graphics === 'auto') {
      settings.set({ graphics: 'lite' });
      window.location.reload();
    }
  });
}
