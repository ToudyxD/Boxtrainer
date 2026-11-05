import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { BackupError, parseBackup } from "./backup";
import { blockSeconds, roundSecondsAt } from "./blockTime";
import { BLOCK_LABELS, buildClipManifest } from "./cues";
import {
  generateSingleBlock,
  generateTraining,
  replaceBlock,
  rerollBlock,
  setRounds,
  trainingSeconds,
  type ContentInput,
  type GeneratorInput,
} from "./generator";
import type { EquipmentProfile, Level, Style, Training } from "./models";
import { buildTimeline } from "./timeline";

const library = loadLibrary();
const byId = new Map(library.exercises.map((e) => [e.id, e]));
const STYLES: Style[] = ["boxing", "kickboxing"];
const LEVELS: Level[] = [1, 2, 3];

const profile = (id: string): EquipmentProfile => DEFAULT_EQUIPMENT_PROFILES.find((p) => p.id === id)!;

const content = (equipmentId = "martial-arts-gym", style: Style = "kickboxing", level: Level = 2): ContentInput => ({
  equipment: profile(equipmentId),
  style,
  level,
  history: [],
});

const training = (over: Partial<GeneratorInput> = {}): Training =>
  generateTraining({ ...content(), type: "power", targetMinutes: 75, seed: 1, ...over }, library);

const powerBlock = (t: Training) => t.blocks.find((b) => b.type === "power")!;

describe("blockTime", () => {
  it("nutzt ohne Liste die feste Rundenlänge", () => {
    expect(roundSecondsAt({ roundSeconds: 180 }, 7)).toBe(180);
    expect(blockSeconds({ rounds: 3, roundSeconds: 180, restSeconds: 60 })).toBe(660);
  });

  it("wiederholt die Liste zyklisch", () => {
    const b = { rounds: 5, roundSeconds: 45, restSeconds: 30, exerciseSeconds: [60, 30] };
    expect([0, 1, 2, 3, 4].map((r) => roundSecondsAt(b, r))).toEqual([60, 30, 60, 30, 60]);
    expect(blockSeconds(b)).toBe(60 + 30 + 60 + 30 + 60 + 4 * 30);
  });

  it("behandelt eine leere Liste wie keine Liste", () => {
    expect(roundSecondsAt({ roundSeconds: 45, exerciseSeconds: [] }, 2)).toBe(45);
  });
});

describe("Power-Übungen", () => {
  const power = library.exercises.filter((e) => e.category === "power");

  it("enthält die genannten Übungen mit ihrer Dauer", () => {
    const secs = (id: string) => byId.get(id)?.format;
    expect(secs("power-hooks")).toEqual({ kind: "time", seconds: 60 });
    expect(secs("dempsey-roll")).toEqual({ kind: "time", seconds: 30 });
    for (const name of ["Power Hooks", "Dempsey Roll", "Raffal Hook", "Backhand Power Punch", "Double Hook", "Non Stop Punch"]) {
      expect(power.map((e) => e.name), name).toContain(name);
    }
  });

  it("brauchen den Sandsack und ein Zeitformat", () => {
    for (const e of power) {
      expect(e.equipment, e.id).toEqual(["heavy-bag"]);
      expect(e.format.kind, e.id).toBe("time");
      expect(e.intensity, e.id).toBe(3);
    }
  });

  it("hat für Boxen und Kickboxen auf jedem Level genug Auswahl", () => {
    for (const style of STYLES) {
      for (const level of LEVELS) {
        const pool = power.filter((e) => e.styles.includes(style) && e.level <= level);
        expect(pool.length, `${style} Level ${level}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("Block-Label und Sprach-Clip für Power existieren", () => {
    expect(BLOCK_LABELS.power).toBe("Power");
    expect(buildClipManifest(library).some((c) => c.id === "block-power" && c.text === "Power")).toBe(true);
  });
});

describe("Power-Block im Training", () => {
  it("bringt je Übung die Rundenlänge mit", () => {
    const block = powerBlock(training());
    expect(block.exerciseSeconds).toHaveLength(block.exerciseIds.length);
    block.exerciseIds.forEach((id, i) => {
      const format = byId.get(id)!.format;
      expect(format.kind === "time" && block.exerciseSeconds![i] === format.seconds, id).toBe(true);
      expect(byId.get(id)?.category).toBe("power");
    });
  });

  it("nutzt nur Übungen zum Stil und Level", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const t = training({ ...content("martial-arts-gym", "boxing", 1), seed });
      for (const id of powerBlock(t).exerciseIds) {
        expect(byId.get(id)?.styles, id).toContain("boxing");
        expect(byId.get(id)!.level, id).toBeLessThanOrEqual(2);
      }
    }
  });

  it.each(DEFAULT_EQUIPMENT_PROFILES.flatMap((p) => STYLES.flatMap((s) => LEVELS.map((l) => [p.id, s, l] as const))))(
    "%s / %s / Level %i erreicht 75 min (±10 %%) über 10 Seeds",
    (equipmentId, style, level) => {
      for (let seed = 1; seed <= 10; seed++) {
        const t = training({ ...content(equipmentId, style, level), seed });
        const minutes = trainingSeconds(t) / 60;
        expect(minutes, `Seed ${seed}: ${minutes.toFixed(1)} min`).toBeGreaterThan(67.5);
        expect(minutes, `Seed ${seed}: ${minutes.toFixed(1)} min`).toBeLessThan(82.5);
      }
    },
  );

  it("ist bei gleichem Seed reproduzierbar", () => {
    expect(training({ seed: 8 })).toEqual(training({ seed: 8 }));
  });

  it("ersetzt den Power-Block ohne Sandsack durch Schattenboxen", () => {
    const t = training(content("home"));
    expect(t.blocks.some((b) => b.type === "power" || b.type === "bag")).toBe(false);
    const converted = t.blocks.filter((b) => b.type === "shadow");
    expect(converted).toHaveLength(3);
    for (const b of converted) {
      expect(b.exerciseSeconds).toBeUndefined();
      expect(b.exerciseIds).toEqual([]);
      expect(b.comboIds.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("Power als Einzelblock", () => {
  it.each(Array.from({ length: 20 }, (_, i) => i + 1))("Seed %i trifft 20 min (±10 %%)", (seed) => {
    const t = generateSingleBlock({ ...content(), blockType: "power", targetMinutes: 20, seed }, library);
    expect(t.type).toBe("single");
    expect(t.blocks).toHaveLength(1);
    const minutes = trainingSeconds(t) / 60;
    expect(minutes).toBeGreaterThan(18);
    expect(minutes).toBeLessThan(22);
  });

  it("hat ohne Sandsack Schattenboxen als Ersatz", () => {
    const t = generateSingleBlock({ ...content("home"), blockType: "power", targetMinutes: 20, seed: 1 }, library);
    expect(t.blocks[0]?.type).toBe("shadow");
    expect(t.blocks[0]?.exerciseSeconds).toBeUndefined();
  });
});

describe("Bearbeiten von Power-Blöcken", () => {
  it("Neu würfeln hält Längen und Übungen parallel", () => {
    const t = training();
    const i = t.blocks.findIndex((b) => b.type === "power");
    let changed = false;
    for (let seed = 1; seed <= 10; seed++) {
      const block = rerollBlock(t, i, content(), library, seed).blocks[i]!;
      expect(block.exerciseSeconds).toHaveLength(block.exerciseIds.length);
      expect(block.rounds).toBe(t.blocks[i]!.rounds);
      expect(block.id).toBe(t.blocks[i]!.id);
      block.exerciseIds.forEach((id, n) => {
        const format = byId.get(id)!.format;
        expect(format.kind === "time" && block.exerciseSeconds![n] === format.seconds).toBe(true);
      });
      if (block.exerciseIds.join() !== t.blocks[i]!.exerciseIds.join()) changed = true;
    }
    expect(changed).toBe(true);
  });

  it("Tauschen gegen Power setzt Längen, Tauschen weg davon entfernt sie", () => {
    const t = generateTraining({ ...content(), type: "technique", targetMinutes: 75, seed: 1 }, library);
    const withPower = replaceBlock(t, 2, "power", content(), library, 3);
    expect(withPower.blocks[2]?.type).toBe("power");
    expect(withPower.blocks[2]?.exerciseSeconds?.length).toBe(withPower.blocks[2]?.exerciseIds.length);

    const back = replaceBlock(withPower, 2, "drill", content(), library, 4);
    expect(back.blocks[2]?.exerciseSeconds).toBeUndefined();
  });

  it("Runden ändern verändert die Dauer anhand der Übungslängen", () => {
    const t = training();
    const i = t.blocks.findIndex((b) => b.type === "power");
    const block = t.blocks[i]!;
    const shorter = setRounds(t, i, block.rounds - 1);
    const lost = roundSecondsAt(block, block.rounds - 1) + block.restSeconds;
    expect(trainingSeconds(t) - trainingSeconds(shorter)).toBe(lost);
  });
});

describe("Power in der Zeitleiste", () => {
  const t = training();
  const block = powerBlock(t);
  const tl = buildTimeline(t, library, { seed: 1, style: "kickboxing", level: 2 });
  const rounds = tl.segments.filter((s) => s.kind === "work" && s.blockId === block.id);

  it("spielt jede Runde in der Länge ihrer Übung", () => {
    expect(rounds).toHaveLength(block.rounds);
    rounds.forEach((seg, r) => {
      expect(seg.end - seg.start).toBe(block.exerciseSeconds![r % block.exerciseIds.length]);
      expect(seg.exerciseId).toBe(block.exerciseIds[r % block.exerciseIds.length]);
    });
  });

  it("setzt Pausen zwischen die Runden", () => {
    const rests = tl.segments.filter((s) => s.kind === "rest" && s.blockId === block.id);
    expect(rests).toHaveLength(block.rounds - 1);
    for (const r of rests) expect(r.end - r.start).toBe(block.restSeconds);
  });

  it("gongt Start und Ende und sagt zu Rundenbeginn die Übung an", () => {
    for (const seg of rounds) {
      const events = tl.events.filter((e) => "blockId" in e && e.blockId === seg.blockId && e.roundIndex === seg.roundIndex);
      expect(events.some((e) => e.kind === "start-signal" && e.at === seg.start && e.signal === "gong")).toBe(true);
      expect(events.some((e) => e.kind === "end-signal" && e.at === seg.end)).toBe(true);
      expect(events.some((e) => e.kind === "intro" && e.at === seg.start && e.exerciseId === seg.exerciseId)).toBe(true);
    }
  });

  it("legt den Klapper 10 Sekunden vor das Rundenende, auch bei 30-s-Runden", () => {
    const short = rounds.filter((s) => s.end - s.start === 30);
    expect(short.length).toBeGreaterThan(0);
    for (const seg of rounds) {
      expect(tl.events.some((e) => e.kind === "clapper" && e.blockId === block.id && e.at === seg.end - 10)).toBe(true);
    }
  });

  it("die Gesamtdauer der Zeitleiste passt zum Training", () => {
    const transitions = t.blocks.length * 13;
    expect(tl.totalSeconds).toBe(trainingSeconds(t) + transitions);
  });
});

describe("Backup mit Power", () => {
  const session = (t: Training, blockPatch: Record<string, unknown> = {}) => ({
    id: "s1",
    date: "2026-11-05T10:00:00.000Z",
    training: { ...t, blocks: t.blocks.map((b) => (b.type === "power" ? { ...b, ...blockPatch } : b)) },
    completedBlockIds: t.blocks.map((b) => b.id),
    actualSeconds: 4000,
    rpe: 8,
    note: "",
  });
  const file = (s: unknown) => JSON.stringify({ app: "boxtrainer", version: 1, exportedAt: "2026-11-05T11:00:00.000Z", sessions: [s] });

  it("übersteht einen Round-Trip", () => {
    const t = training();
    expect(parseBackup(file(session(t))).sessions[0]?.training).toEqual(t);
  });

  it.each([
    ["Länge passt nicht", [60]],
    ["Wert unter 1", [0, 30, 30, 30, 30, 30]],
    ["kein Array", "60"],
    ["Text statt Zahl", ["60", 30, 30, 30, 30, 30]],
  ])("lehnt exerciseSeconds ab: %s", (_name, value) => {
    expect(() => parseBackup(file(session(training(), { exerciseSeconds: value })))).toThrow(BackupError);
  });
});
