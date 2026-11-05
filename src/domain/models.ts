export type Style = "boxing" | "kickboxing";
export type Level = 1 | 2 | 3;
export type Stance = "orthodox" | "southpaw";
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

export type ExerciseCategory = "drill" | "power" | "strength" | "conditioning" | "mobility" | "core";

export type BodyArea =
  | "thigh-front"
  | "hamstrings"
  | "calves"
  | "hips"
  | "glutes"
  | "chest"
  | "back"
  | "shoulders"
  | "neck"
  | "biceps"
  | "triceps"
  | "forearms"
  | "abs"
  | "obliques"
  | "lower-back"
  | "full-body";

export type BodyGroup = "legs" | "upper" | "arms" | "core" | "full";

/** Ein Hauptbereich oder ein Unterbereich. */
export type BodyTarget = BodyGroup | BodyArea;

export type ExerciseFormat =
  | { kind: "time"; seconds: number; restSeconds?: number }
  | { kind: "series"; seconds: number[]; restSeconds?: number }
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
  bodyAreas: BodyArea[];
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
  | "power"
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
  /** Rundenlänge je Übung (parallel zu exerciseIds), falls die Übungen ihre Dauer mitbringen. */
  exerciseSeconds?: number[];
  /** Pause nach der Runde je Übung (parallel zu exerciseIds); ohne Angabe gilt restSeconds. */
  exerciseRest?: number[];
  focusTheme?: string;
}

export type TrainingType = "technique" | "stamina" | "power" | "strength" | "strength-endurance" | "single";

export interface Training {
  id: string;
  type: TrainingType;
  equipmentProfileId: string;
  targetMinutes: number;
  focusTheme?: string;
  blocks: Block[];
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
