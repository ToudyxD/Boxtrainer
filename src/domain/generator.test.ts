import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { GeneratorError, generateTraining, trainingSeconds, type GeneratorInput, type HistoryEntry } from "./generator";
import type { EquipmentProfile, Level, Style } from "./models";
import type { TemplateTrainingType } from "./templates";

const library = loadLibrary();
const TYPES: TemplateTrainingType[] = ["technique", "stamina", "power", "strength", "strength-endurance"];
const STYLES: Style[] = ["boxing", "kickboxing"];
const LEVELS: Level[] = [1, 2, 3];

const profile = (id: string): EquipmentProfile => {
  const p = DEFAULT_EQUIPMENT_PROFILES.find((e) => e.id === id);
  if (!p) throw new Error(`Profil ${id} fehlt`);
  return p;
};

const input = (over: Partial<GeneratorInput> = {}): GeneratorInput => ({
  type: "technique",
  equipment: profile("martial-arts-gym"),
  targetMinutes: 75,
  style: "kickboxing",
  level: 2,
  seed: 1,
  history: [],
  ...over,
});

describe("bibliothek", () => {
  it("lädt und validiert", () => {
    expect(library.combos.length).toBeGreaterThanOrEqual(30);
    expect(library.exercises.length).toBeGreaterThanOrEqual(40);
  });
});

describe("generateTraining", () => {
  it("ist bei gleichem Seed reproduzierbar", () => {
    expect(generateTraining(input({ seed: 99 }), library)).toEqual(generateTraining(input({ seed: 99 }), library));
  });

  it("variiert zwischen Seeds", () => {
    const a = generateTraining(input({ seed: 1 }), library);
    const b = generateTraining(input({ seed: 2 }), library);
    expect(a.blocks.map((x) => x.comboIds)).not.toEqual(b.blocks.map((x) => x.comboIds));
  });

  it.each(TYPES.flatMap((t) => STYLES.flatMap((s) => LEVELS.map((l) => [t, s, l] as const))))(
    "%s / %s / Level %i erreicht für jedes Profil die Zieldauer von 75 min (±10 %%)",
    (type, style, level) => {
      for (const equipment of DEFAULT_EQUIPMENT_PROFILES) {
        const training = generateTraining(input({ type, style, level, equipment }), library);
        const minutes = trainingSeconds(training) / 60;
        expect(minutes, `${equipment.id}: ${minutes.toFixed(1)} min`).toBeGreaterThan(67.5);
        expect(minutes, `${equipment.id}: ${minutes.toFixed(1)} min`).toBeLessThan(82.5);
      }
    },
  );

  it.each([60, 90])("skaliert technik-training auf %i min", (target) => {
    const minutes = trainingSeconds(generateTraining(input({ targetMinutes: target }), library)) / 60;
    expect(Math.abs(minutes - target)).toBeLessThan(target * 0.1);
  });

  it("lässt Warm-up und Cooldown unverändert", () => {
    const short = generateTraining(input({ targetMinutes: 60 }), library);
    const long = generateTraining(input({ targetMinutes: 90 }), library);
    for (const type of ["warmup", "cooldown"] as const) {
      const find = (t: typeof short) => t.blocks.find((b) => b.type === type);
      expect(find(short)?.rounds).toBe(find(long)?.rounds);
    }
  });

  it("ersetzt Sackarbeit ohne Sandsack durch Schattenboxen", () => {
    const training = generateTraining(input({ equipment: profile("home") }), library);
    expect(training.blocks.some((b) => b.type === "bag")).toBe(false);
    expect(training.blocks.filter((b) => b.type === "shadow")).toHaveLength(2);
    const converted = training.blocks.filter((b) => b.type === "shadow").every((b) => b.comboIds.length >= 4);
    expect(converted).toBe(true);
    for (const b of training.blocks.filter((x) => x.type === "shadow")) expect(b.announceDensity).toBe(3);
  });

  it("behält Sackarbeit mit Sandsack", () => {
    const training = generateTraining(input(), library);
    expect(training.blocks.some((b) => b.type === "bag")).toBe(true);
  });

  it("nutzt nur Kombis passend zum Stil", () => {
    const training = generateTraining(input({ style: "boxing" }), library);
    const byId = new Map(library.combos.map((c) => [c.id, c]));
    for (const id of training.blocks.flatMap((b) => b.comboIds)) {
      expect(byId.get(id)?.styles).toContain("boxing");
    }
  });

  it("überschreitet das Level höchstens um eine Stufe", () => {
    const byId = new Map(library.combos.map((c) => [c.id, c]));
    for (let seed = 0; seed < 30; seed++) {
      const training = generateTraining(input({ level: 1, seed }), library);
      for (const id of training.blocks.flatMap((b) => b.comboIds)) {
        expect(byId.get(id)?.level).toBeLessThanOrEqual(2);
      }
    }
  });

  it("nutzt auf Level 3 keine höheren Stufen", () => {
    const byId = new Map(library.combos.map((c) => [c.id, c]));
    const training = generateTraining(input({ level: 3 }), library);
    for (const id of training.blocks.flatMap((b) => b.comboIds)) {
      expect(byId.get(id)?.level).toBeLessThanOrEqual(3);
    }
  });

  it("bevorzugt Kombis zum Fokus-Thema", () => {
    const byId = new Map(library.combos.map((c) => [c.id, c]));
    const training = generateTraining(input({ focusTheme: "Lowkick setzen" }), library);
    expect(training.focusTheme).toBe("Lowkick setzen");
    const ids = training.blocks.filter((b) => b.focusTheme).flatMap((b) => b.comboIds);
    const onTheme = ids.filter((id) => byId.get(id)?.themes.includes("Lowkick setzen")).length;
    expect(onTheme).toBeGreaterThan(ids.length / 3);
  });

  it("wählt Drills zum Fokus-Thema", () => {
    const byId = new Map(library.exercises.map((e) => [e.id, e]));
    const training = generateTraining(input({ focusTheme: "Jab als Türöffner" }), library);
    const drill = training.blocks.find((b) => b.type === "drill");
    const themed = drill?.exerciseIds.filter((id) => byId.get(id)?.themes?.includes("Jab als Türöffner")) ?? [];
    expect(themed.length).toBeGreaterThan(0);
  });

  it("lehnt Fokus-Thema ab, das für den Stil nicht existiert", () => {
    expect(() => generateTraining(input({ style: "boxing", focusTheme: "Lowkick setzen" }), library)).toThrow(GeneratorError);
  });

  it("nimmt ohne Thema das am längsten nicht trainierte", () => {
    const themes = [...new Set(library.combos.filter((c) => c.styles.includes("kickboxing") && c.level <= 2).flatMap((c) => c.themes))];
    const history: HistoryEntry[] = themes
      .filter((t) => t !== "Kniefinish")
      .map((t, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, focusTheme: t, comboIds: [], exerciseIds: [] }));
    const training = generateTraining(input({ history }), library);
    expect(training.focusTheme).toBe("Kniefinish");
  });

  it("wertet Kombis der letzten Sessions ab", () => {
    const first = generateTraining(input({ seed: 5 }), library);
    const used = first.blocks.flatMap((b) => b.comboIds);
    const history: HistoryEntry[] = [{ date: "2026-10-30", comboIds: used, exerciseIds: [] }];

    let withHistory = 0;
    let without = 0;
    for (let seed = 100; seed < 140; seed++) {
      const share = (h: HistoryEntry[]) => {
        const t = generateTraining(input({ seed, focusTheme: "Jab als Türöffner", history: h }), library);
        return t.blocks.flatMap((b) => b.comboIds).filter((id) => used.includes(id)).length;
      };
      withHistory += share(history);
      without += share([]);
    }
    expect(withHistory).toBeLessThan(without);
  });

  it("trainiert Kraft auch ohne jedes Equipment mit Körpergewicht", () => {
    const empty: EquipmentProfile = { id: "none", name: "Nichts", tags: [] };
    const training = generateTraining(input({ type: "strength", equipment: empty, level: 1, style: "boxing" }), library);
    const strength = training.blocks.find((b) => b.type === "strength");
    expect(strength?.exerciseIds.length).toBeGreaterThan(0);
  });

  it("wirft, wenn für einen Block keine Übung existiert", () => {
    const noStrength = { ...library, exercises: library.exercises.filter((e) => e.category !== "strength") };
    expect(() => generateTraining(input({ type: "strength" }), noStrength)).toThrow(GeneratorError);
  });

  it("wirft bei ungültiger Zieldauer", () => {
    expect(() => generateTraining(input({ targetMinutes: 0 }), library)).toThrow(GeneratorError);
  });

  it("verwendet nur Übungen, deren Equipment vorhanden ist", () => {
    const byId = new Map(library.exercises.map((e) => [e.id, e]));
    const home = profile("home");
    for (const type of TYPES) {
      const training = generateTraining(input({ type, equipment: home }), library);
      for (const id of training.blocks.flatMap((b) => b.exerciseIds)) {
        for (const tag of byId.get(id)?.equipment ?? []) expect(home.tags).toContain(tag);
      }
    }
  });
});
