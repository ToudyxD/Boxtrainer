import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { BackupError, parseBackup } from "./backup";
import { ContentError, validateExercises } from "./content";
import { blockSeconds, restSecondsAt, roundSecondsAt } from "./blockTime";
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
import type { EquipmentProfile, Exercise, Level, Style, Training } from "./models";
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

const allowedSeconds = (id: string): number[] => {
  const f = byId.get(id)!.format;
  if (f.kind === "time") return [f.seconds];
  if (f.kind === "series") return f.seconds;
  if (f.kind === "reps" && f.seconds !== undefined) return [f.seconds];
  throw new Error(`${id}: kein Zeitformat`);
};

const restOf = (id: string): number | undefined => {
  const f = byId.get(id)!.format;
  return f.kind === "time" || f.kind === "series" || f.kind === "reps" ? f.restSeconds : undefined;
};

/** Bibliothek, in der keine Übung eine eigene Pause hat. */
const withoutRests = (lib: typeof library): typeof library => ({
  ...lib,
  exercises: lib.exercises.map((e) => {
    const f = e.format;
    if (f.kind === "time" || f.kind === "series" || f.kind === "reps") {
      const { restSeconds: _rest, ...rest } = f;
      return { ...e, format: rest as typeof f };
    }
    return e;
  }),
});

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
    expect(secs("power-hooks")).toMatchObject({ kind: "reps", reps: 30, unit: "Schläge" });
    expect(secs("dempsey-roll")).toMatchObject({ kind: "time", seconds: 30 });
    for (const name of ["Power Hooks", "Dempsey Roll", "Raffal Hook", "Backhand Power Punch", "Double Hook", "Non Stop Punch"]) {
      expect(power.map((e) => e.name), name).toContain(name);
    }
  });

  it("brauchen den Sandsack und ein Format mit Dauer", () => {
    for (const e of power) {
      expect(e.equipment, e.id).toEqual(["heavy-bag"]);
      expect(["time", "series", "reps"], e.id).toContain(e.format.kind);
      expect(allowedSeconds(e.id).length, e.id).toBeGreaterThan(0);
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
      expect(allowedSeconds(id), id).toContain(block.exerciseSeconds![i]);
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
      if (block.exerciseRest) expect(block.exerciseRest).toHaveLength(block.exerciseIds.length);
      block.exerciseIds.forEach((id, n) => expect(allowedSeconds(id)).toContain(block.exerciseSeconds![n]));
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
    const lost = roundSecondsAt(block, block.rounds - 1) + restSecondsAt(block, block.rounds - 2);
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
    rests.forEach((r) => expect(r.end - r.start).toBe(restSecondsAt(block, r.roundIndex)));
  });

  it("gongt Start und Ende und sagt zu Rundenbeginn die Übung an", () => {
    for (const seg of rounds) {
      const events = tl.events.filter((e) => "blockId" in e && e.blockId === seg.blockId && e.roundIndex === seg.roundIndex);
      expect(events.some((e) => e.kind === "start-signal" && e.at === seg.start && e.signal === "gong")).toBe(true);
      expect(events.some((e) => e.kind === "end-signal" && e.at === seg.end)).toBe(true);
      expect(events.some((e) => e.kind === "intro" && e.at === seg.start && e.exerciseId === seg.exerciseId)).toBe(true);
    }
  });

  it("legt den Klapper 10 Sekunden vor das Ende zeitbasierter Runden, nicht vor Zählrunden", () => {
    for (const seg of rounds) {
      const f = byId.get(seg.exerciseId!)!.format;
      const counted = f.kind === "reps";
      const clapper = tl.events.some((e) => e.kind === "clapper" && e.blockId === block.id && e.at === seg.end - 10);
      expect(clapper, `${seg.exerciseId} (${seg.end - seg.start} s)`).toBe(!counted);
    }
  });

  it("die Gesamtdauer der Zeitleiste passt zum Training", () => {
    const transitions = t.blocks.length * 13;
    expect(tl.totalSeconds).toBe(trainingSeconds(t) + transitions);
  });
});

const only = (...ids: string[]) => ({
  ...library,
  exercises: library.exercises.filter((e) => e.category !== "power" || ids.includes(e.id)),
});

const powerOf = (lib: typeof library, over: Partial<GeneratorInput> = {}) =>
  powerBlock(generateTraining({ ...content(), type: "power", targetMinutes: 75, seed: 2, ...over }, lib));

describe("Neue Power-Übungen", () => {
  const power = library.exercises.filter((e) => e.category === "power");
  const names = new Set(power.map((e) => e.name));

  it("enthält die Schläge, Tritte und Tempo-Übungen aus der Übersicht", () => {
    for (const name of [
      "Lead Hook Power", "Rear Hook Power", "Overhand", "Körperhaken", "Lead Uppercut Power", "Cross Haken Power",
      "Slip and Rip", "Triple Hook", "Peek-a-boo Hooks", "Power Teep", "Rear Lowkick", "Lead Lowkick", "Body Kick",
      "Cross Lowkick", "Hook Lowkick", "Clinch Knees", "Switch Kick", "Head Kick Power", "Tempo-Salve",
      "Eins-zwei-Sprint", "Power Pyramide",
    ]) {
      expect(names, name).toContain(name);
    }
  });

  it("Tritte und Knie gibt es nur für Kickboxen", () => {
    for (const id of ["power-teep", "rear-lowkick", "lead-lowkick", "body-kick", "cross-lowkick", "hook-lowkick", "clinch-knees", "switch-kick", "head-kick-power"]) {
      expect(byId.get(id)?.styles, id).toEqual(["kickboxing"]);
    }
  });

  it("Boxen bekommt keine Tritte", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const block = powerOf(library, { ...content("martial-arts-gym", "boxing", 3), seed });
      for (const id of block.exerciseIds) expect(byId.get(id)?.styles, id).toContain("boxing");
    }
  });

  it("jedes Level hat in beiden Stilen mindestens 5 Power-Übungen", () => {
    for (const style of STYLES) {
      for (const level of LEVELS) {
        const n = power.filter((e) => e.styles.includes(style) && e.level <= level).length;
        expect(n, `${style} Level ${level}`).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

describe("Pause je Übung und Serien", () => {
  it("Tempo-Übungen bringen ihre kürzere Pause mit", () => {
    const block = powerOf(only("tempo-burst", "one-two-sprint"));
    expect(block.exerciseIds.sort()).toEqual(["one-two-sprint", "tempo-burst"]);
    expect(block.exerciseSeconds).toEqual([20, 20]);
    expect(block.exerciseRest).toEqual([30, 30]);
  });

  it("Pausen je Übung sind 30 oder 60 Sekunden, bei Zählübungen gilt die Pause der Übung", () => {
    for (const e of library.exercises.filter((x) => x.category === "power")) {
      expect([30, 60], e.id).toContain(restOf(e.id));
    }
  });

  it("füllt bei Übungen ohne eigene Pause die Blockpause auf", () => {
    const lib = withoutRests(only("tempo-burst", "power-hooks"));
    const patched = {
      ...lib,
      exercises: lib.exercises.map((e) => (e.id === "tempo-burst" ? { ...e, format: { ...e.format, restSeconds: 15 } as typeof e.format } : e)),
    };
    const block = powerOf(patched);
    expect(block.exerciseRest).toHaveLength(block.exerciseIds.length);
    block.exerciseIds.forEach((id, i) => expect(block.exerciseRest![i]).toBe(id === "tempo-burst" ? 15 : block.restSeconds));
  });

  it("lässt exerciseRest weg, wenn keine Übung eine eigene Pause hat", () => {
    expect(powerOf(withoutRests(only("power-hooks", "dempsey-roll"))).exerciseRest).toBeUndefined();
  });

  it("Pyramide ergibt fünf aufeinanderfolgende Runden", () => {
    const block = powerOf(only("power-pyramid"));
    expect(block.exerciseIds).toEqual(Array(5).fill("power-pyramid"));
    expect(block.exerciseSeconds).toEqual([30, 45, 60, 45, 30]);
    expect(block.exerciseRest).toEqual([30, 30, 30, 30, 30]);
  });

  it("zählt Zeit und Pausen in der Dauer richtig", () => {
    const block = { rounds: 5, roundSeconds: 45, restSeconds: 30, exerciseSeconds: [30, 45, 60, 45, 30], exerciseRest: [20, 20, 20, 20, 20] };
    expect(blockSeconds(block)).toBe(210 + 4 * 20);
    expect(restSecondsAt(block, 2)).toBe(20);
    expect(restSecondsAt({ restSeconds: 30 }, 4)).toBe(30);
  });

  it("Zeitleiste nutzt die Pausen je Runde und lässt den Countdown bei kurzen Pausen weg", () => {
    const t = generateTraining({ ...content(), type: "power", targetMinutes: 75, seed: 2 }, only("tempo-burst", "power-hooks"));
    const block = powerBlock(t);
    const tl = buildTimeline(t, only("tempo-burst", "power-hooks"), { seed: 1, style: "kickboxing", level: 2 });
    const rests = tl.segments.filter((s) => s.kind === "rest" && s.blockId === block.id);
    expect(rests).toHaveLength(block.rounds - 1);
    for (const r of rests) {
      const len = restSecondsAt(block, r.roundIndex);
      expect(r.end - r.start).toBe(len);
      const ready = tl.events.some((e) => e.kind === "ready" && e.blockId === block.id && e.at === r.end - 10);
      expect(ready, `Pause ${r.roundIndex} (${len} s)`).toBe(len >= 25);
    }
  });

  it("Neu würfeln übernimmt neue Pausen und entfernt sie bei Blöcken ohne", () => {
    const t = generateTraining({ ...content(), type: "power", targetMinutes: 75, seed: 2 }, only("tempo-burst", "power-hooks"));
    const i = t.blocks.findIndex((b) => b.type === "power");
    const rerolled = rerollBlock(t, i, content(), only("tempo-burst", "power-hooks"), 5);
    expect(rerolled.blocks[i]?.exerciseRest).toHaveLength(rerolled.blocks[i]!.exerciseIds.length);
    const plain = rerollBlock(t, i, content(), withoutRests(only("power-hooks", "dempsey-roll")), 5);
    expect(plain.blocks[i]?.exerciseRest).toBeUndefined();
  });
});

describe("Validierung von Zeit- und Serienformaten", () => {
  const sample = (format: Exercise["format"]): Exercise => ({ ...library.exercises.find((e) => e.id === "power-hooks")!, format });

  it("akzeptiert die Bibliothek", () => {
    expect(() => validateExercises(library.exercises)).not.toThrow();
  });

  it.each([
    ["Dauer 0", { kind: "time", seconds: 0 }],
    ["negative Pause", { kind: "time", seconds: 30, restSeconds: -1 }],
    ["leere Serie", { kind: "series", seconds: [] }],
    ["Serie mit 0", { kind: "series", seconds: [30, 0] }],
    ["Serie mit negativer Pause", { kind: "series", seconds: [30], restSeconds: -5 }],
  ] as Array<[string, Exercise["format"]]>)("lehnt ab: %s", (_name, format) => {
    expect(() => validateExercises([sample(format)])).toThrow(ContentError);
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
    ["Pause: Länge passt nicht", [30]],
    ["Pause: negativ", [-1, 30, 30, 30, 30, 30]],
  ])("lehnt exerciseRest ab: %s", (_name, value) => {
    expect(() => parseBackup(file(session(training(), { exerciseRest: value })))).toThrow(BackupError);
  });

  it("akzeptiert exerciseRest passend zu den Übungen", () => {
    const t = training();
    const block = powerBlock(t);
    const rest = block.exerciseIds.map(() => 15);
    expect(parseBackup(file(session(t, { exerciseRest: rest }))).sessions).toHaveLength(1);
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
