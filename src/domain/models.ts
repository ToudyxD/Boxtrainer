export type Style = "boxing" | "kickboxing";
export type Stance = "southpaw" | "orthodox";
export type Level = 1 | 2 | 3;
export type Side = "front" | "rear";

export type TechniqueCategory = "punch" | "kick" | "knee" | "defense" | "footwork";

export interface Technique {
  id: string;
  announce: string;
  name: string;
  category: TechniqueCategory;
  side: Side | null;
  styles: Style[];
  level: Level;
  punchNumber?: number;
  cues: string[];
}

export interface Combo {
  id: string;
  techniqueIds: string[];
  styles: Style[];
  level: Level;
  themes: string[];
}

export type EquipmentTag =
  | "heavy-bag"
  | "jump-rope"
  | "mirror"
  | "dumbbells"
  | "kettlebell"
  | "barbell"
  | "pull-up-bar"
  | "mat"
  | "medicine-ball";

export interface EquipmentProfile {
  id: string;
  name: string;
  tags: EquipmentTag[];
}

export type ExerciseCategory = "drill" | "strength" | "conditioning" | "mobility" | "core";

export type ExerciseFormat =
  | { kind: "time"; seconds: number }
  | { kind: "reps"; reps: number; sets: number }
  | { kind: "per-side"; seconds: number };

export interface Exercise {
  id: string;
  name: string;
  category: ExerciseCategory;
  equipment: EquipmentTag[];
  styles: Style[];
  level: Level;
  format: ExerciseFormat;
  intensity: 1 | 2 | 3;
  description: string;
  cues: string[];
  themes?: string[];
  phases?: Array<"warmup" | "cooldown">;
}

export interface Library {
  techniques: Technique[];
  combos: Combo[];
  exercises: Exercise[];
}

export type BlockType =
  | "warmup"
  | "shadow"
  | "drill"
  | "bag"
  | "strength"
  | "conditioning"
  | "core"
  | "circuit"
  | "cooldown";

export type AnnounceMode = "combos" | "cues-only" | "none";

export interface Block {
  id: string;
  type: BlockType;
  rounds: number;
  roundSeconds: number;
  restSeconds: number;
  announceMode: AnnounceMode;
  announceDensity: 1 | 2 | 3;
  comboIds: string[];
  exerciseIds: string[];
  focusTheme?: string;
}

export type TrainingType = "technique" | "stamina" | "strength" | "strength-endurance" | "single";

export interface Training {
  id: string;
  type: TrainingType;
  equipmentProfileId: string;
  targetMinutes: number;
  focusTheme?: string;
  blocks: Block[];
}

export interface Profile {
  style: Style;
  stance: Stance;
  level: Level;
  activeEquipmentProfileId: string;
}

export interface Session {
  id: string;
  date: string;
  training: Training;
  completedBlockIds: string[];
  actualSeconds: number;
  rpe: number;
  note: string;
}
