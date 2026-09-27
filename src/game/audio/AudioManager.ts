import { AUDIO_FILES, MUSIC_CAPTIONS } from '../data/audio';
import { settings } from '../save/SettingsManager';
import { MusicEngine, type MusicKey } from './music';
import { SFX, SFX_CAPTIONS, type SfxKey, type Voice } from './sfx';

export type { SfxKey } from './sfx';
export type { MusicKey } from './music';

/**
 * Gleamtrail audio: procedural SFX + music through Web Audio, with optional file overrides
 * (see src/game/data/audio.ts). Volumes follow the settings; captions are emitted for
 * subtitles.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private music: MusicEngine | null = null;
  private fileMusic: { key: MusicKey; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private lastPlayed = new Map<SfxKey, number>();
  private wantedMusic: MusicKey | null = null;
  private captionListeners = new Set<(text: string) => void>();
  private initialised = false;

  init(): void {
    if (this.initialised) return;
    this.initialised = true;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      // Gentle limiter so stacked effects never clip harshly.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 6;
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.master.connect(comp).connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.music = new MusicEngine(ctx, this.musicBus, this.noiseBuf);
      this.applyVolumes();
      settings.onChange((_, changed) => {
        if (changed.some((k) => k === 'masterVolume' || k === 'musicVolume' || k === 'sfxVolume')) this.applyVolumes();
      });
      void this.loadFiles();
    } catch {
      this.ctx = null;
    }
  }

  /** Browsers start audio suspended until a user gesture; call this from input handlers. */
  unlock(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'suspended') return;
    ctx
      .resume()
      .then(() => {
        if (this.wantedMusic) {
          const key = this.wantedMusic;
          this.wantedMusic = null;
          this.playMusic(key);
        }
      })
      .catch(() => undefined);
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  get available(): boolean {
    return this.ctx !== null;
  }

  private applyVolumes(): void {
    const s = settings.get();
    const t = this.ctx?.currentTime ?? 0;
    this.master?.gain.setTargetAtTime(s.masterVolume, t, 0.03);
    this.musicBus?.gain.setTargetAtTime(s.musicVolume * 0.55, t, 0.03);
    this.sfxBus?.gain.setTargetAtTime(s.sfxVolume, t, 0.03);
  }

  private async loadFiles(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      Object.entries(AUDIO_FILES).map(async ([key, url]) => {
        if (!url) return;
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(key, buf);
        } catch {
          // Fall back to the procedural version.
        }
      }),
    );
  }

  onCaption(listener: (text: string) => void): () => void {
    this.captionListeners.add(listener);
    return () => this.captionListeners.delete(listener);
  }

  /** Post a caption for subtitles (used for sounds and for important non-verbal cues). */
  caption(text: string): void {
    if (!settings.get().subtitles) return;
    for (const l of this.captionListeners) l(text);
  }

  play(key: SfxKey, opts: { rate?: number; volume?: number; throttleMs?: number } = {}): void {
    const caption = SFX_CAPTIONS[key];
    if (caption) this.caption(caption);
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuf || ctx.state !== 'running') return;
    const now = performance.now();
    const last = this.lastPlayed.get(key) ?? 0;
    if (now - last < (opts.throttleMs ?? 28)) return;
    this.lastPlayed.set(key, now);
    const out = ctx.createGain();
    out.gain.value = opts.volume ?? 1;
    out.connect(this.sfxBus);
    const file = this.buffers.get(key);
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.playbackRate.value = opts.rate ?? 1;
      src.connect(out);
      src.start();
      src.onended = () => out.disconnect();
      return;
    }
    const voice: Voice = { ctx, out, noise: this.noiseBuf };
    try {
      SFX[key](voice, ctx.currentTime + 0.005, opts.rate ?? 1);
    } catch {
      // A failed effect must never interrupt gameplay.
    }
    window.setTimeout(() => out.disconnect(), 3000);
  }

  playMusic(key: MusicKey): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    if (ctx.state !== 'running') {
      this.wantedMusic = key;
      return;
    }
    if (this.currentMusic === key) return;
    this.caption(MUSIC_CAPTIONS[key]);
    const file = this.buffers.get(key);
    this.stopFileMusic(0.6);
    if (file) {
      this.music?.stop(0.6);
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.6);
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.loop = true;
      src.connect(gain).connect(this.musicBus);
      src.start();
      this.fileMusic = { key, src, gain };
      return;
    }
    this.music?.play(key);
  }

  get currentMusic(): MusicKey | null {
    return this.fileMusic?.key ?? this.music?.currentKey ?? null;
  }

  stopMusic(fade = 0.6): void {
    this.wantedMusic = null;
    this.music?.stop(fade);
    this.stopFileMusic(fade);
  }

  private stopFileMusic(fade: number): void {
    const fm = this.fileMusic;
    if (!fm || !this.ctx) return;
    const t = this.ctx.currentTime;
    fm.gain.gain.setValueAtTime(Math.max(0.0001, fm.gain.gain.value), t);
    fm.gain.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    fm.src.stop(t + fade + 0.05);
    this.fileMusic = null;
  }
}

export const audio = new AudioManager();
