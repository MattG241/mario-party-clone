import Phaser from 'phaser';
import { LITE } from '../perf';

const FRAG = `
#define SHADER_NAME GLEAMTRAIL_GRADE_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform float uGamma;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform vec3 uTint;
uniform vec2 uTexel;
uniform float uTilt;
uniform float uFocusH;
uniform float uGlow;
uniform float uGlowThreshold;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform vec3 uLift;
varying vec2 outTexCoord;

void main() {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  // Tilt-shift: a sharp horizontal band through the middle, softening towards top and bottom.
  if (uTilt > 0.0) {
    float d = abs(outTexCoord.y - 0.5);
    float r = uTilt * smoothstep(uFocusH, uFocusH + 0.3, d);
    if (r > 0.35) {
      vec4 acc = c;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 0.5236 + (i < 6 ? 0.0 : 0.2618);
        float rr = i < 6 ? 0.5 * r : r;
        acc += texture2D(uMainSampler, outTexCoord + vec2(cos(a), sin(a)) * rr * uTexel);
      }
      c = acc / 13.0;
    }
  }
  // Bloom-lite: bright neighbours (golden-angle spiral of taps) bleed a soft glow onto this pixel.
  vec3 glow = vec3(0.0);
  if (uGlow > 0.0) {
    for (int i = 0; i < 12; i++) {
      float fi = float(i) + 0.5;
      float a = fi * 2.39996;
      float rr = sqrt(fi / 12.0) * 18.0;
      vec4 s = texture2D(uMainSampler, outTexCoord + vec2(cos(a), sin(a)) * rr * uTexel);
      vec3 srgb = s.rgb;
      float sl = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
      glow += srgb * max(sl - uGlowThreshold, 0.0) / max(sl, 0.001);
    }
    glow *= uGlow / 12.0;
  }
  if (c.a <= 0.0) {
    gl_FragColor = c;
    return;
  }
  // Framebuffers hold premultiplied colour.
  vec3 rgb = c.rgb / c.a;
  // Deepen the mid-tones, then saturation and a gentle contrast pivot around mid-grey.
  rgb = pow(max(rgb, 0.0), vec3(uGamma));
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(l), rgb, uSaturation);
  rgb = (rgb - 0.5) * uContrast + 0.5;
  // Lift the blacks a touch towards a cool blue-green, so deep shade reads as air, not ink.
  rgb = uLift + rgb * (1.0 - uLift);
  rgb *= uTint;
  // Split toning: cool shadows, warm highlights (adds depth without shifting the mid-tones much).
  float tl = dot(clamp(rgb, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
  rgb *= mix(uShadowTint, uHighTint, smoothstep(0.12, 0.88, tl));
  rgb += glow;
  // Soft oval vignette.
  vec2 d = (outTexCoord - 0.5) * vec2(1.0, 0.82);
  float v = smoothstep(0.78, 0.28, length(d));
  rgb *= mix(1.0 - uVignette, 1.0, v);
  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0) * c.a, c.a);
}
`;

export interface GradeSettings {
  gamma: number;
  saturation: number;
  contrast: number;
  vignette: number;
  tint: [number, number, number];
  /** Tilt-shift blur radius in pixels at the top/bottom edges (0 = off). */
  tilt: number;
  /** Half-height of the sharp band (texture space, 0..0.5). */
  focusH: number;
  /** Bloom strength (0 = off) and the luminance above which pixels glow. */
  glow: number;
  glowThreshold: number;
  shadowTint: [number, number, number];
  highTint: [number, number, number];
  /** Black level lift per channel (0 = none). */
  lift: [number, number, number];
}

export const DEFAULT_GRADE: GradeSettings = {
  gamma: 1.0,
  saturation: 1.12,
  contrast: 1.08,
  vignette: 0.1,
  tint: [1, 1, 0.99],
  tilt: 0,
  focusH: 0.22,
  // Off by default: a full-screen bloom is costly on weak GPUs; the rendered art has its bloom
  // baked in (scripts/art/bloom.py). Scenes can still opt in.
  glow: 0,
  glowThreshold: 0.8,
  shadowTint: [0.96, 0.98, 1.04],
  highTint: [1.03, 1.0, 0.96],
  lift: [0.016, 0.024, 0.034],
};

/**
 * Camera colour grade shared by the world scenes: a mid-tone curve, saturation, contrast, a
 * black lift, split toning, a light bloom and a vignette in a single full-screen pass.
 */
export class GradePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  settings: GradeSettings = { ...DEFAULT_GRADE };

  constructor(game: Phaser.Game) {
    super({ game, name: 'Grade', fragShader: FRAG });
  }

  override onPreRender(): void {
    const s = this.settings;
    this.set1f('uGamma', s.gamma);
    this.set1f('uSaturation', s.saturation);
    this.set1f('uContrast', s.contrast);
    this.set1f('uVignette', s.vignette);
    this.set3f('uTint', s.tint[0], s.tint[1], s.tint[2]);
    this.set2f('uTexel', 1 / Math.max(1, this.renderer.width), 1 / Math.max(1, this.renderer.height));
    this.set1f('uTilt', s.tilt);
    this.set1f('uFocusH', s.focusH);
    this.set1f('uGlow', s.glow);
    this.set1f('uGlowThreshold', s.glowThreshold);
    this.set3f('uShadowTint', s.shadowTint[0], s.shadowTint[1], s.shadowTint[2]);
    this.set3f('uHighTint', s.highTint[0], s.highTint[1], s.highTint[2]);
    this.set3f('uLift', s.lift[0], s.lift[1], s.lift[2]);
  }
}

/** Grade a scene's main camera (no-op on the canvas renderer). */
export function applyGrade(scene: Phaser.Scene, overrides: Partial<GradeSettings> = {}, camera: Phaser.Cameras.Scene2D.Camera = scene.cameras.main): void {
  // Lite graphics skip the full-screen pass (a big share of the frame on TV-class GPUs).
  if (scene.renderer.type !== Phaser.WEBGL || LITE) return;
  camera.setPostPipeline(GradePipeline);
  const p = camera.getPostPipeline(GradePipeline);
  const pipe = (Array.isArray(p) ? p[0] : p) as GradePipeline | undefined;
  if (pipe) pipe.settings = { ...DEFAULT_GRADE, ...overrides };
}
