// Audio file overrides.
//
// Gleamtrail ships with procedurally generated placeholder audio, so no files are required.
// To replace a sound or a music loop, drop a file into public/assets/audio/ and map its key
// here (paths are relative to the site root). Missing or undecodable files fall back to the
// procedural version automatically.
//
// Example:
//   confirm: 'assets/audio/confirm.ogg',
//   board: 'assets/audio/board_theme.ogg',
import type { MusicKey } from '../audio/music';
import type { SfxKey } from '../audio/sfx';

export const AUDIO_FILES: Partial<Record<SfxKey | MusicKey, string>> = {};

export const MUSIC_CAPTIONS: Record<MusicKey, string> = {
  menu: '♪ Party welcome theme ♪',
  board: '♪ Suncoil stroll ♪',
  boardFinal: '♪ Final round fanfare-march ♪',
  minigame: '♪ Quickstep clash ♪',
  results: '♪ Podium tune ♪',
  final: '♪ Grand celebration ♪',
};
