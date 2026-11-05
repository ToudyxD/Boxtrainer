import type { BodyArea, BodyGroup, BodyTarget, Exercise } from "./models";

export const BODY_AREA_GROUP: Record<BodyArea, BodyGroup> = {
  "thigh-front": "legs",
  hamstrings: "legs",
  calves: "legs",
  hips: "legs",
  glutes: "legs",
  chest: "upper",
  back: "upper",
  shoulders: "upper",
  neck: "upper",
  biceps: "arms",
  triceps: "arms",
  forearms: "arms",
  abs: "core",
  obliques: "core",
  "lower-back": "core",
  "full-body": "full",
};

export const BODY_AREA_LABELS: Record<BodyArea, string> = {
  "thigh-front": "Oberschenkel vorn",
  hamstrings: "Hamstrings",
  calves: "Waden",
  hips: "Hüfte",
  glutes: "Gesäß",
  chest: "Brust",
  back: "Rücken",
  shoulders: "Schultern",
  neck: "Nacken",
  biceps: "Bizeps",
  triceps: "Trizeps",
  forearms: "Unterarme",
  abs: "Bauch",
  obliques: "Seite und Rotation",
  "lower-back": "Unterer Rücken",
  "full-body": "Ganzkörper",
};

export const BODY_GROUP_LABELS: Record<BodyGroup, string> = {
  legs: "Beine",
  upper: "Oberkörper",
  arms: "Arme",
  core: "Rumpf",
  full: "Ganzkörper",
};

export const BODY_AREAS = Object.keys(BODY_AREA_GROUP) as BodyArea[];

/** Hauptbereiche, die eine Übung beansprucht. */
export function exerciseGroups(exercise: Pick<Exercise, "bodyAreas">): Set<BodyGroup> {
  return new Set(exercise.bodyAreas.map((area) => BODY_AREA_GROUP[area]));
}

/** Beansprucht die Übung den Haupt- oder Unterbereich? */
export function exerciseCovers(exercise: Pick<Exercise, "bodyAreas">, target: BodyTarget): boolean {
  return exerciseGroups(exercise).has(target as BodyGroup) || exercise.bodyAreas.includes(target as BodyArea);
}
