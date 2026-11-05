import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { blockSeconds } from "./blockTime";
import { exerciseCovers } from "./bodyAreas";
import {
  generateSingleBlock,
  generateTraining,
  replaceBlock,
  rerollBlock,
  trainingSeconds,
  type ContentInput,
  type GeneratorInput,
} from "./generator";
import type { BlockType, BodyTarget, EquipmentProfile, Level, Style, Training } from "./models";
import { maxRounds } from "./templates";

const library = loadLibrary();
const byId = new Map(library.exercises.map((e) => [e.id, e]));
const STYLES: Style[] = ["boxing", "kickboxing"];
const LEVELS: Level[] = [1, 2, 3];
const PROFILES = DEFAULT_EQUIPMENT_PROFILES;

const profile = (id: string): EquipmentProfile => PROFILES.find((p) => p.id === id)!;

const content = (equipmentId = "martial-arts-gym", style: Style = "kickboxing", level: Level = 2): ContentInput => ({
  equipment: profile(equipmentId),
  style,
  level,
  history: [],
});

const training = (over: Partial<GeneratorInput> = {}): Training =>
  generateTraining({ ...content(), type: "technique", targetMinutes: 75, seed: 1, ...over }, library);

const block = (t: Training, type: BlockType) => t.blocks.find((b) => b.type === type)!;

/** Rundenlänge, die eine Übung laut Katalog mitbringt (Seitenübungen: beide Seiten). */
const lengthOf = (id: string): number => {
  const f = byId.get(id)!.format;
  if (f.kind === "time") return f.seconds;
  if (f.kind === "per-side") return f.seconds * 2;
  throw new Error(`${id}: ${f.kind}`);
};

const covered = (ids: readonly string[], target: BodyTarget): boolean => ids.some((id) => exerciseCovers(byId.get(id)!, target));

describe("Aufwärmen und Cooldown mit eigener Länge je Übung", () => {
  it("jede Runde dauert so lang wie ihre Übung", () => {
    for (const type of ["warmup", "cooldown"] as const) {
      const b = block(training(), type);
      expect(b.exerciseSeconds, type).toHaveLength(b.exerciseIds.length);
      b.exerciseIds.forEach((id, i) => expect(b.exerciseSeconds![i], `${type} ${id}`).toBe(lengthOf(id)));
    }
  });

  it("Aufwärmen: kein Eintrag über 45 s, mindestens 20 s", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const s of block(training({ seed }), "warmup").exerciseSeconds!) {
        expect(s).toBeLessThanOrEqual(45);
        expect(s).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("Aufwärmen läuft in zwei Durchgängen, Cooldown in einem", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const t = training({ seed });
      const w = block(t, "warmup");
      const c = block(t, "cooldown");
      expect(w.rounds, `Seed ${seed}`).toBe(w.exerciseIds.length * 2);
      expect(c.rounds, `Seed ${seed}`).toBe(c.exerciseIds.length);
    }
  });

  it("Aufwärmen dauert 7 bis 11 Minuten, Cooldown 4 bis 8", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const t = training({ seed });
      const w = blockSeconds(block(t, "warmup")) / 60;
      const c = blockSeconds(block(t, "cooldown")) / 60;
      expect(w, `Aufwärmen Seed ${seed}: ${w.toFixed(1)} min`).toBeGreaterThan(7);
      expect(w, `Aufwärmen Seed ${seed}: ${w.toFixed(1)} min`).toBeLessThan(11);
      expect(c, `Cooldown Seed ${seed}: ${c.toFixed(1)} min`).toBeGreaterThan(4);
      expect(c, `Cooldown Seed ${seed}: ${c.toFixed(1)} min`).toBeLessThan(8);
    }
  });

  it("hat keine Pausen zwischen den Runden", () => {
    const t = training();
    for (const type of ["warmup", "cooldown"] as const) {
      expect(block(t, type).restSeconds).toBe(0);
      expect(block(t, type).exerciseRest).toBeUndefined();
    }
  });

  it("bleibt von der Zieldauer unabhängig", () => {
    const short = training({ targetMinutes: 60 });
    const long = training({ targetMinutes: 90 });
    for (const type of ["warmup", "cooldown"] as const) expect(block(short, type).rounds).toBe(block(long, type).rounds);
  });

  it("Seitenübungen zählen beide Seiten in einer Runde", () => {
    const only = { ...library, exercises: library.exercises.filter((e) => !e.phases?.includes("warmup") || e.id === "leg-swings") };
    const b = block(generateTraining({ ...content(), type: "technique", targetMinutes: 75, seed: 1 }, only), "warmup");
    expect(b.exerciseIds).toEqual(["leg-swings"]);
    expect(b.exerciseSeconds).toEqual([40]);
  });

  it.each(PROFILES.flatMap((p) => STYLES.flatMap((s) => LEVELS.map((l) => [p.id, s, l] as const))))(
    "%s / %s / Level %i: Trainings treffen weiter die Zieldauer",
    (equipmentId, style, level) => {
      for (const type of ["technique", "stamina", "power", "strength", "strength-endurance"] as const) {
        const minutes = trainingSeconds(training({ ...content(equipmentId, style, level), type, seed: 3 })) / 60;
        expect(minutes, `${type}: ${minutes.toFixed(1)} min`).toBeGreaterThan(67.5);
        expect(minutes, `${type}: ${minutes.toFixed(1)} min`).toBeLessThan(82.5);
      }
    },
  );
});

describe("Einzelblock Aufwärmen und Cooldown", () => {
  it.each([
    ["warmup", 10],
    ["warmup", 20],
    ["warmup", 30],
    ["cooldown", 10],
    ["cooldown", 20],
  ] as Array<[BlockType, number]>)("%s mit %i min wählt die passendste Zahl an Durchgängen", (blockType, minutes) => {
    for (let seed = 1; seed <= 10; seed++) {
      const t = generateSingleBlock({ ...content(), blockType, targetMinutes: minutes, seed }, library);
      const b = t.blocks[0]!;
      const entries = b.exerciseIds.length;
      expect(b.rounds % entries, `Seed ${seed}`).toBe(0);
      const gapFor = (k: number) => Math.abs(blockSeconds({ ...b, rounds: entries * k }) - minutes * 60);
      const k = b.rounds / entries;
      expect(gapFor(k), `Seed ${seed}`).toBeLessThanOrEqual(gapFor(Math.max(k - 1, 1)));
      if (entries * (k + 1) <= maxRounds(blockType)) expect(gapFor(k), `Seed ${seed}`).toBeLessThanOrEqual(gapFor(k + 1));
    }
  });

  it("Tauschen gegen Aufwärmen setzt Längen und Durchgänge", () => {
    const t = training();
    const swapped = replaceBlock(t, 2, "warmup", content(), library, 5).blocks[2]!;
    expect(swapped.type).toBe("warmup");
    expect(swapped.exerciseSeconds).toHaveLength(swapped.exerciseIds.length);
    expect(swapped.rounds).toBe(swapped.exerciseIds.length * 2);
  });

  it("Neu würfeln hält Rundenzahl und Längen stimmig", () => {
    const t = training();
    const i = t.blocks.findIndex((b) => b.type === "cooldown");
    for (let seed = 1; seed <= 10; seed++) {
      const b = rerollBlock(t, i, content(), library, seed).blocks[i]!;
      expect(b.rounds).toBe(t.blocks[i]!.rounds);
      b.exerciseIds.forEach((id, n) => expect(b.exerciseSeconds![n]).toBe(lengthOf(id)));
    }
  });
});

describe("Abdeckung in Kraft, Rumpf und Zirkel", () => {
  const strength = (equipmentId: string, level: Level, seed: number) =>
    block(training({ ...content(equipmentId, "kickboxing", level), type: "strength", seed }), "strength");

  it("Kraft deckt immer Beine und Oberkörper ab", () => {
    for (const p of PROFILES) {
      for (const level of LEVELS) {
        for (let seed = 1; seed <= 25; seed++) {
          const ids = strength(p.id, level, seed).exerciseIds;
          expect(covered(ids, "legs"), `${p.id} L${level} Seed ${seed}: Beine`).toBe(true);
          expect(covered(ids, "upper"), `${p.id} L${level} Seed ${seed}: Oberkörper`).toBe(true);
        }
      }
    }
  });

  it("Kraft enthält mit Hanteln oder Klimmzugstange immer eine Rückenübung", () => {
    for (let seed = 1; seed <= 25; seed++) {
      expect(covered(strength("fitness-gym", 2, seed).exerciseIds, "back"), `Seed ${seed}`).toBe(true);
    }
  });

  it("Kraft bleibt ohne Equipment möglich und wirft nicht wegen fehlendem Rücken", () => {
    const none: EquipmentProfile = { id: "none", name: "Nichts", tags: [] };
    const b = block(generateTraining({ ...content(), equipment: none, type: "strength", targetMinutes: 75, seed: 2 }, library), "strength");
    expect(b.exerciseIds.length).toBeGreaterThan(0);
    expect(covered(b.exerciseIds, "back")).toBe(false);
  });

  it("Rumpf enthält Bauch und Seite", () => {
    for (const p of PROFILES) {
      for (let seed = 1; seed <= 25; seed++) {
        const ids = block(training({ ...content(p.id), type: "strength", seed }), "core").exerciseIds;
        expect(covered(ids, "abs"), `${p.id} Seed ${seed}: Bauch`).toBe(true);
        expect(covered(ids, "obliques"), `${p.id} Seed ${seed}: Seite`).toBe(true);
      }
    }
  });

  it("Zirkel deckt Beine, Oberkörper und Rumpf ab", () => {
    for (const p of PROFILES) {
      for (const level of LEVELS) {
        for (let seed = 1; seed <= 25; seed++) {
          const ids = block(
            training({ ...content(p.id, "kickboxing", level), type: "strength-endurance", targetMinutes: 75, seed }),
            "circuit",
          ).exerciseIds;
          for (const g of ["legs", "upper", "core"] as const) expect(covered(ids, g), `${p.id} L${level} Seed ${seed}: ${g}`).toBe(true);
        }
      }
    }
  });

  it("Einzelblöcke Kraft, Rumpf und Zirkel behalten die Abdeckung", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const s = generateSingleBlock({ ...content(), blockType: "strength", targetMinutes: 20, seed }, library).blocks[0]!;
      expect(covered(s.exerciseIds, "legs")).toBe(true);
      const c = generateSingleBlock({ ...content(), blockType: "core", targetMinutes: 10, seed }, library).blocks[0]!;
      expect(covered(c.exerciseIds, "abs") && covered(c.exerciseIds, "obliques")).toBe(true);
    }
  });

  it("wertet Übungen aus dem Verlauf weiterhin ab", () => {
    const first = block(training({ ...content(), type: "strength", seed: 5 }), "core").exerciseIds;
    let withHistory = 0;
    let without = 0;
    for (let seed = 100; seed < 160; seed++) {
      const count = (history: GeneratorInput["history"]) =>
        block(training({ ...content(), type: "strength", seed, history }), "core").exerciseIds.filter((id) => first.includes(id)).length;
      withHistory += count([{ date: "2026-11-01", comboIds: [], exerciseIds: first }]);
      without += count([]);
    }
    expect(withHistory).toBeLessThan(without);
  });
});
