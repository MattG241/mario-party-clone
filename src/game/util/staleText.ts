import Phaser from 'phaser';

/**
 * Updating a Text after its screen has closed (a reference left over from an earlier visit) throws
 * deep inside Phaser, because its texture is gone, and that stops the whole game. Skip the update
 * instead and report it, so a missed label can never freeze a party.
 */
export function guardStaleText(report: (msg: string) => void): void {
  const proto = Phaser.GameObjects.Text.prototype as unknown as { updateText(this: Phaser.GameObjects.Text): Phaser.GameObjects.Text };
  const update = proto.updateText;
  proto.updateText = function () {
    if (!(this.frame as { data?: unknown } | undefined)?.data) {
      report(`Skipped an update to a closed text: "${String(this.text).slice(0, 40)}"`);
      return this;
    }
    return update.call(this);
  };
}
