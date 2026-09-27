import Phaser from 'phaser';

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
  rgb *= uTint;
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
}

export const DEFAULT_GRADE: GradeSettings = { gamma: 1.12, saturation: 1.12, contrast: 1.05, vignette: 0.22, tint: [1, 0.99, 0.97], tilt: 0, focusH: 0.22 };

/**
 * Camera colour grade shared by the world scenes: a mid-tone curve, saturation, contrast and a
 * vignette in a single full-screen pass (replacing the stock vignette FX, so it costs nothing extra).
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
  }
}

/** Grade a scene's main camera (no-op on the canvas renderer). */
export function applyGrade(scene: Phaser.Scene, overrides: Partial<GradeSettings> = {}, camera: Phaser.Cameras.Scene2D.Camera = scene.cameras.main): void {
  if (scene.renderer.type !== Phaser.WEBGL) return;
  camera.setPostPipeline(GradePipeline);
  const p = camera.getPostPipeline(GradePipeline);
  const pipe = (Array.isArray(p) ? p[0] : p) as GradePipeline | undefined;
  if (pipe) pipe.settings = { ...DEFAULT_GRADE, ...overrides };
}
