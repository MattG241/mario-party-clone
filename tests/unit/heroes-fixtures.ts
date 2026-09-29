// CPU skill levels for the Hero Heights simulations: the same numbers as BaseMinigame's CPU_SKILL
// (copied, because BaseMinigame imports Phaser, which these Node tests don't load).
export const CPU_SKILL_TABLE = {
  easy: { reaction: 520, accuracy: 0.55, mistake: 0.24, aimNoise: 0.55, think: 700 },
  normal: { reaction: 300, accuracy: 0.78, mistake: 0.11, aimNoise: 0.28, think: 420 },
  hard: { reaction: 170, accuracy: 0.9, mistake: 0.05, aimNoise: 0.13, think: 240 },
} as const;
