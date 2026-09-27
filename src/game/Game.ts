import Phaser from 'phaser';
import { audio } from './audio/AudioManager';
import { makeConfig } from './config';
import { debugInfo, logError } from './debug/debug';
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

declare global {
  interface Window {
    /** Test / diagnostics hook (read by the Playwright smoke test). */
    __GLEAMTRAIL__?: { game: Phaser.Game; ready: boolean; errors: string[]; session: typeof session; debug: typeof debugInfo };
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
  const game = new Phaser.Game(makeConfig(parent, scenes));

  // Input: poll every device once per frame, before any scene updates.
  input.attach(window);
  const applyInputSettings = () => {
    const s = settings.get();
    input.keyboard.setBindings(s.keyBindings);
    input.configure({ deadzone: s.deadzone, vibration: s.vibration });
  };
  applyInputSettings();
  settings.onChange((_, changed) => {
    if (changed.some((k) => k === 'keyBindings' || k === 'deadzone' || k === 'vibration')) applyInputSettings();
  });
  game.events.on(Phaser.Core.Events.PRE_STEP, (time: number) => {
    input.update(time);
    if (input.any.pressed('A') || input.any.pressed('MENU')) audio.unlock();
  });
  // Pause music when the tab is hidden.
  game.events.on(Phaser.Core.Events.HIDDEN, () => audio.stopMusic(0.2));

  window.__GLEAMTRAIL__ = { game, ready: false, errors: [], session, debug: debugInfo };
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
