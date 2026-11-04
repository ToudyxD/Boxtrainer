import type { AnnounceMode, BlockType, EquipmentTag, ExerciseCategory, TrainingType } from "./models";

export interface BlockTemplate {
  key: string;
  type: BlockType;
  rounds: number;
  roundSeconds: number;
  restSeconds: number;
  announceMode: AnnounceMode;
  announceDensity: 1 | 2 | 3;
  scale?: { min: number; max: number; step?: number };
  requires?: EquipmentTag[];
  fallback?: { type: BlockType; requires: EquipmentTag[]; announceMode: AnnounceMode; announceDensity?: 1 | 2 | 3 };
  usesFocus?: boolean;
  exercises?: {
    categories: ExerciseCategory[];
    count: number;
    maxIntensity?: 1 | 2 | 3;
    phase?: "warmup" | "cooldown";
  };
}

export interface TrainingTemplate {
  type: TrainingType;
  label: string;
  blocks: BlockTemplate[];
}

const warmup: BlockTemplate = {
  key: "warmup",
  type: "warmup",
  rounds: 10,
  roundSeconds: 60,
  restSeconds: 0,
  announceMode: "cues-only",
  announceDensity: 1,
  exercises: { categories: ["mobility", "conditioning"], count: 5, maxIntensity: 2, phase: "warmup" },
};

const cooldown = (rounds: number): BlockTemplate => ({
  key: "cooldown",
  type: "cooldown",
  rounds,
  roundSeconds: 60,
  restSeconds: 0,
  announceMode: "cues-only",
  announceDensity: 1,
  exercises: { categories: ["mobility"], count: 7, maxIntensity: 1, phase: "cooldown" },
});

const shadow = (key: string, rounds: number, density: 1 | 2 | 3, scale: BlockTemplate["scale"], usesFocus = false): BlockTemplate => ({
  key,
  type: "shadow",
  rounds,
  roundSeconds: 180,
  restSeconds: 60,
  announceMode: "combos",
  announceDensity: density,
  scale,
  usesFocus,
});

const bag = (
  key: string,
  rounds: number,
  roundSeconds: number,
  restSeconds: number,
  density: 1 | 2 | 3,
  scale: BlockTemplate["scale"],
  usesFocus = false,
): BlockTemplate => ({
  key,
  type: "bag",
  rounds,
  roundSeconds,
  restSeconds,
  announceMode: "combos",
  announceDensity: density,
  scale,
  usesFocus,
  requires: ["heavy-bag"],
  fallback: { type: "shadow", requires: [], announceMode: "combos", announceDensity: 3 },
});

export const TRAINING_TEMPLATES: Record<TrainingType, TrainingTemplate> = {
  technique: {
    type: "technique",
    label: "Technik",
    blocks: [
      warmup,
      shadow("shadow", 3, 3, { min: 2, max: 4 }, true),
      {
        key: "drill",
        type: "drill",
        rounds: 3,
        roundSeconds: 300,
        restSeconds: 0,
        announceMode: "cues-only",
        announceDensity: 1,
        scale: { min: 2, max: 4 },
        usesFocus: true,
        exercises: { categories: ["drill"], count: 3 },
      },
      bag("bag", 5, 180, 60, 2, { min: 3, max: 6 }, true),
      {
        key: "core",
        type: "core",
        rounds: 8,
        roundSeconds: 45,
        restSeconds: 15,
        announceMode: "cues-only",
        announceDensity: 1,
        exercises: { categories: ["core"], count: 4 },
      },
      cooldown(7),
    ],
  },
  stamina: {
    type: "stamina",
    label: "Stamina",
    blocks: [
      warmup,
      shadow("shadow", 2, 3, { min: 1, max: 3 }),
      bag("bag", 8, 180, 45, 3, { min: 4, max: 10 }),
      {
        key: "conditioning",
        type: "conditioning",
        rounds: 8,
        roundSeconds: 60,
        restSeconds: 30,
        announceMode: "cues-only",
        announceDensity: 1,
        scale: { min: 4, max: 10 },
        exercises: { categories: ["conditioning"], count: 4 },
      },
      cooldown(8),
    ],
  },
  strength: {
    type: "strength",
    label: "Kraft",
    blocks: [
      warmup,
      shadow("shadow", 2, 3, { min: 1, max: 3 }),
      {
        key: "strength",
        type: "strength",
        rounds: 12,
        roundSeconds: 120,
        restSeconds: 60,
        announceMode: "cues-only",
        announceDensity: 1,
        scale: { min: 8, max: 16, step: 4 },
        exercises: { categories: ["strength"], count: 4 },
      },
      {
        key: "core",
        type: "core",
        rounds: 8,
        roundSeconds: 60,
        restSeconds: 15,
        announceMode: "cues-only",
        announceDensity: 1,
        exercises: { categories: ["core"], count: 4 },
      },
      cooldown(7),
    ],
  },
  "strength-endurance": {
    type: "strength-endurance",
    label: "Kraft-Ausdauer",
    blocks: [
      warmup,
      {
        key: "circuit",
        type: "circuit",
        rounds: 18,
        roundSeconds: 40,
        restSeconds: 20,
        announceMode: "cues-only",
        announceDensity: 1,
        scale: { min: 18, max: 42, step: 6 },
        exercises: { categories: ["strength", "conditioning", "core"], count: 6 },
      },
      bag("finisher", 3, 120, 60, 3, { min: 2, max: 5 }),
      cooldown(7),
    ],
  },
};
