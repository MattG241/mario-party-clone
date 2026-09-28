import Phaser from 'phaser';

/**
 * Run `fn` every frame until the returned stop() is called or the scene shuts down. Scene event
 * listeners outlive a shutdown, so a wait interrupted by leaving the scene (quitting from the pause
 * menu mid-spin, a debug skip) would otherwise wake up again, on destroyed objects, the next time
 * the scene starts.
 */
export function onSceneUpdate(scene: Phaser.Scene, fn: (time: number, dt: number) => void): () => void {
  const stop = () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, fn);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, stop);
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, fn);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, stop);
  return stop;
}
