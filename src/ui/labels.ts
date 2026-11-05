import type { Level, Stance, Style } from "../domain/models";

export const LEVEL_LABELS: Record<Level, string> = { 1: "Grundlagen", 2: "Aufbau", 3: "Fortgeschritten" };
export const STYLE_LABELS: Record<Style, string> = { boxing: "Boxen", kickboxing: "Kickboxen (K-1)" };
export const STANCE_LABELS: Record<Stance, string> = { orthodox: "Rechtsauslage", southpaw: "Linksauslage" };
