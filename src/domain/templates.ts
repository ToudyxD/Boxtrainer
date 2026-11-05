import { BLOCK_LABELS } from "./cues";
import type { AnnounceMode, BlockType, BodyGroup, EquipmentTag, ExerciseCategory, Training, TrainingType } from "./models";

export type TemplateTrainingType = Exclude<TrainingType, "single">;

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
    /** Körperbereiche, die die Auswahl möglichst alle abdecken soll. */
    cover?: BodyGroup[];
  };
}

export interface TrainingTemplate {
  type: TemplateTrainingType;
  label: string;
  blocks: BlockTemplate[];
}

const warmup: BlockTemplate = {
  key: "warmup",
  type: "warmup",
  rounds: 12,
  roundSeconds: 45,
  restSeconds: 0,
  announceMode: "cues-only",
  announceDensity: 1,
  exercises: { categories: ["mobility", "conditioning"], count: 6, maxIntensity: 2, phase: "warmup", cover: ["legs", "upper", "core"] },
};

const cooldown = (rounds: number): BlockTemplate => ({
  key: "cooldown",
  type: "cooldown",
  rounds,
  roundSeconds: 60,
  restSeconds: 0,
  announceMode: "cues-only",
  announceDensity: 1,
  exercises: { categories: ["mobility"], count: 7, maxIntensity: 1, phase: "cooldown", cover: ["legs", "upper", "core"] },
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

export const TRAINING_TEMPLATES: Record<TemplateTrainingType, TrainingTemplate> = {
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

/** Katalog der einzeln startbaren Blöcke; dient auch als Vorlage für Tauschen und Neu würfeln. */
export const BLOCK_TEMPLATES: Record<BlockType, BlockTemplate> = {
  shadow: shadow("shadow", 3, 3, { min: 1, max: 20 }, true),
  bag: bag("bag", 5, 180, 60, 2, { min: 1, max: 20 }, true),
  drill: {
    key: "drill",
    type: "drill",
    rounds: 3,
    roundSeconds: 300,
    restSeconds: 0,
    announceMode: "cues-only",
    announceDensity: 1,
    scale: { min: 1, max: 12 },
    usesFocus: true,
    exercises: { categories: ["drill"], count: 3 },
  },
  core: {
    key: "core",
    type: "core",
    rounds: 8,
    roundSeconds: 45,
    restSeconds: 15,
    announceMode: "cues-only",
    announceDensity: 1,
    scale: { min: 4, max: 20 },
    exercises: { categories: ["core"], count: 4 },
  },
  conditioning: {
    key: "conditioning",
    type: "conditioning",
    rounds: 8,
    roundSeconds: 60,
    restSeconds: 30,
    announceMode: "cues-only",
    announceDensity: 1,
    scale: { min: 4, max: 20 },
    exercises: { categories: ["conditioning"], count: 4 },
  },
  strength: {
    key: "strength",
    type: "strength",
    rounds: 12,
    roundSeconds: 120,
    restSeconds: 60,
    announceMode: "cues-only",
    announceDensity: 1,
    scale: { min: 4, max: 20, step: 4 },
    exercises: { categories: ["strength"], count: 4 },
  },
  circuit: {
    key: "circuit",
    type: "circuit",
    rounds: 18,
    roundSeconds: 40,
    restSeconds: 20,
    announceMode: "cues-only",
    announceDensity: 1,
    scale: { min: 6, max: 42, step: 6 },
    exercises: { categories: ["strength", "conditioning", "core"], count: 6 },
  },
  warmup: { ...warmup, scale: { min: 6, max: 24, step: 6 } },
  cooldown: { ...cooldown(7), scale: { min: 5, max: 20 } },
};

export const MIN_ROUNDS = 1;
const DEFAULT_MAX_ROUNDS = 20;

/** Obergrenze für Runden eines Blocktyps: 20, außer die Vorlage erlaubt mehr. */
export function maxRounds(type: BlockType): number {
  return Math.max(DEFAULT_MAX_ROUNDS, BLOCK_TEMPLATES[type].scale?.max ?? 0);
}

export const TRAINING_TYPE_LABELS: Record<TrainingType, string> = {
  technique: TRAINING_TEMPLATES.technique.label,
  stamina: TRAINING_TEMPLATES.stamina.label,
  strength: TRAINING_TEMPLATES.strength.label,
  "strength-endurance": TRAINING_TEMPLATES["strength-endurance"].label,
  single: "Einzelblock",
};

export function trainingLabel(training: Training): string {
  const first = training.blocks[0];
  if (training.type === "single" && first) return `${TRAINING_TYPE_LABELS.single}: ${BLOCK_LABELS[first.type]}`;
  return TRAINING_TYPE_LABELS[training.type];
}
