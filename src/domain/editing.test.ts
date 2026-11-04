import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { parseBackup } from "./backup";
import {
  GeneratorError,
  blockSeconds,
  generateSingleBlock,
  generateTraining,
  moveBlock,
  removeBlock,
  replaceBlock,
  rerollBlock,
  setRounds,
  trainingSeconds,
  type GeneratorInput,
  type SingleBlockInput,
} from "./generator";
import type { BlockType, EquipmentProfile, Training } from "./models";
import { BLOCK_TEMPLATES, TRAINING_TEMPLATES, maxRounds, trainingLabel } from "./templates";

const library = loadLibrary();
const BLOCK_TYPES = Object.keys(BLOCK_TEMPLATES) as BlockType[];

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

const single = (over: Partial<SingleBlockInput> = {}): SingleBlockInput => ({
  blockType: "shadow",
  equipment: profile("martial-arts-gym"),
  targetMinutes: 20,
  style: "kickboxing",
  level: 2,
  seed: 1,
  history: [],
  ...over,
});

const base = (): Training => generateTraining(input(), library);
const ids = (t: Training): string[] => t.blocks.map((b) => b.id);
const indexOf = (t: Training, type: BlockType): number => t.blocks.findIndex((b) => b.type === type);

describe("rerollBlock", () => {
  it("würfelt nur den gewählten Block neu", () => {
    const training = base();
    const i = indexOf(training, "bag");
    const next = rerollBlock(training, i, input(), library, 42);

    next.blocks.forEach((b, j) => {
      if (j !== i) expect(b).toBe(training.blocks[j]);
    });
    const before = training.blocks[i]!;
    const after = next.blocks[i]!;
    expect(after.comboIds).not.toEqual(before.comboIds);
    expect({ ...after, comboIds: [], exerciseIds: [] }).toEqual({ ...before, comboIds: [], exerciseIds: [] });
  });

  it("würfelt Übungsblöcke neu und hält das Equipment ein", () => {
    const home = profile("home");
    const training = generateTraining(input({ type: "strength", equipment: home }), library);
    const i = indexOf(training, "strength");
    const byId = new Map(library.exercises.map((e) => [e.id, e]));
    const changed = [1, 2, 3, 4, 5].some((seed) => {
      const after = rerollBlock(training, i, input({ equipment: home }), library, seed).blocks[i]!;
      for (const id of after.exerciseIds) {
        expect(byId.get(id)?.category).toBe("strength");
        for (const tag of byId.get(id)?.equipment ?? []) expect(home.tags).toContain(tag);
      }
      return after.exerciseIds.join() !== training.blocks[i]!.exerciseIds.join();
    });
    expect(changed).toBe(true);
  });

  it("ist bei gleichem Seed reproduzierbar", () => {
    const training = base();
    expect(rerollBlock(training, 1, input(), library, 7)).toEqual(rerollBlock(training, 1, input(), library, 7));
  });

  it("behält das Fokus-Thema des Blocks", () => {
    const training = generateTraining(input({ focusTheme: "Lowkick setzen" }), library);
    const i = indexOf(training, "shadow");
    const after = rerollBlock(training, i, input(), library, 9).blocks[i]!;
    expect(after.focusTheme).toBe("Lowkick setzen");
    const byId = new Map(library.combos.map((c) => [c.id, c]));
    expect(after.comboIds.filter((id) => byId.get(id)?.themes.includes("Lowkick setzen")).length).toBeGreaterThan(0);
  });

  it("verändert das Ausgangstraining nicht", () => {
    const training = base();
    const copy = structuredClone(training);
    rerollBlock(training, 0, input(), library, 3);
    expect(training).toEqual(copy);
  });

  it.each([-1, 6, 1.5, Number.NaN])("wirft bei ungültigem Index %s", (i) => {
    expect(() => rerollBlock(base(), i, input(), library, 1)).toThrow(GeneratorError);
  });

  it("wirft bei anderem Equipment-Profil", () => {
    expect(() => rerollBlock(base(), 0, input({ equipment: profile("home") }), library, 1)).toThrow(GeneratorError);
  });

  it("wirft, wenn keine passende Übung existiert", () => {
    const training = base();
    const noCore = { ...library, exercises: library.exercises.filter((e) => e.category !== "core") };
    expect(() => rerollBlock(training, indexOf(training, "core"), input(), noCore, 1)).toThrow(GeneratorError);
  });
});

describe("replaceBlock", () => {
  it("tauscht den Blocktyp und lässt die anderen Blöcke unverändert", () => {
    const training = base();
    const i = indexOf(training, "core");
    const next = replaceBlock(training, i, "conditioning", input(), library, 5);

    expect(next.blocks[i]?.type).toBe("conditioning");
    expect(next.blocks[i]?.exerciseIds.length).toBeGreaterThan(0);
    expect(next.blocks[i]?.rounds).toBe(BLOCK_TEMPLATES.conditioning.rounds);
    next.blocks.forEach((b, j) => {
      if (j !== i) expect(b).toBe(training.blocks[j]);
    });
  });

  it("vergibt eine neue, eindeutige ID", () => {
    const training = base();
    const next = replaceBlock(training, 2, "shadow", input(), library, 5);
    expect(ids(training)).not.toContain(next.blocks[2]?.id);
    expect(new Set(ids(next)).size).toBe(next.blocks.length);
  });

  it("wendet die Equipment-Ersatzregel an", () => {
    const home = profile("home");
    const training = generateTraining(input({ equipment: home }), library);
    const next = replaceBlock(training, 0, "bag", input({ equipment: home }), library, 5);
    expect(next.blocks[0]?.type).toBe("shadow");
    expect(next.blocks[0]?.announceDensity).toBe(3);
    expect(next.blocks[0]?.comboIds.length).toBeGreaterThanOrEqual(4);
  });

  it("übernimmt das Fokus-Thema nur bei Blöcken, die es nutzen", () => {
    const training = generateTraining(input({ focusTheme: "Jab als Türöffner" }), library);
    expect(replaceBlock(training, 0, "drill", input(), library, 1).blocks[0]?.focusTheme).toBe("Jab als Türöffner");
    expect(replaceBlock(training, 1, "core", input(), library, 1).blocks[1]?.focusTheme).toBeUndefined();
  });

  it("wirft bei ungültigem Index oder Blocktyp", () => {
    expect(() => replaceBlock(base(), 99, "shadow", input(), library, 1)).toThrow(GeneratorError);
    expect(() => replaceBlock(base(), 0, "sparring" as BlockType, input(), library, 1)).toThrow(GeneratorError);
  });

  it("wirft bei anderem Equipment-Profil", () => {
    expect(() => replaceBlock(base(), 0, "core", input({ equipment: profile("home") }), library, 1)).toThrow(GeneratorError);
  });
});

describe("removeBlock", () => {
  it("entfernt den Block und behält die übrigen IDs", () => {
    const training = base();
    const next = removeBlock(training, 2);
    expect(ids(next)).toEqual(ids(training).filter((_, i) => i !== 2));
    expect(trainingSeconds(next)).toBe(trainingSeconds(training) - blockSeconds(training.blocks[2]!));
  });

  it("verweigert das Entfernen des letzten Blocks", () => {
    const one = generateSingleBlock(single(), library);
    expect(() => removeBlock(one, 0)).toThrow(GeneratorError);
  });

  it("wirft bei ungültigem Index", () => {
    expect(() => removeBlock(base(), 6)).toThrow(GeneratorError);
  });
});

describe("setRounds", () => {
  it("setzt die Rundenzahl und ändert die Dauer", () => {
    const training = base();
    const i = indexOf(training, "bag");
    const next = setRounds(training, i, 2);
    expect(next.blocks[i]?.rounds).toBe(2);
    expect(next.blocks[i]?.id).toBe(training.blocks[i]?.id);
    expect(trainingSeconds(next)).toBeLessThan(trainingSeconds(training));
  });

  it.each([1, 20])("akzeptiert %i", (r) => {
    expect(setRounds(base(), 1, r).blocks[1]?.rounds).toBe(r);
  });

  it.each([0, 21, -3, 2.5, Number.NaN])("lehnt %s ab", (r) => {
    expect(() => setRounds(base(), 1, r)).toThrow(GeneratorError);
  });

  it("erlaubt beim Zirkel das Vorlagen-Maximum", () => {
    const training = generateTraining(input({ type: "strength-endurance", targetMinutes: 90 }), library);
    const i = indexOf(training, "circuit");
    expect(maxRounds("circuit")).toBe(42);
    expect(setRounds(training, i, 42).blocks[i]?.rounds).toBe(42);
    expect(() => setRounds(training, i, 43)).toThrow(GeneratorError);
  });

  it("wirft bei ungültigem Index", () => {
    expect(() => setRounds(base(), -1, 3)).toThrow(GeneratorError);
  });
});

describe("moveBlock", () => {
  it("verschiebt einen Block nach hinten und nach vorn", () => {
    const training = base();
    const [a, b, c, d, e, f] = ids(training);
    expect(ids(moveBlock(training, 1, 3))).toEqual([a, c, d, b, e, f]);
    expect(ids(moveBlock(training, 4, 0))).toEqual([e, a, b, c, d, f]);
    expect(ids(moveBlock(training, 2, 2))).toEqual(ids(training));
  });

  it("wirft bei ungültigen Indizes", () => {
    expect(() => moveBlock(base(), 0, 6)).toThrow(GeneratorError);
    expect(() => moveBlock(base(), 7, 0)).toThrow(GeneratorError);
  });
});

describe("Block-IDs", () => {
  it("bleiben nach einer Folge von Änderungen eindeutig und stabil", () => {
    const training = base();
    let t = removeBlock(training, 1);
    t = replaceBlock(t, 0, "shadow", input(), library, 2);
    t = replaceBlock(t, 3, "conditioning", input(), library, 3);
    t = moveBlock(t, 0, 4);
    t = rerollBlock(t, 2, input(), library, 4);
    t = setRounds(t, 1, 4);

    expect(new Set(ids(t)).size).toBe(t.blocks.length);
    const untouched = [training.blocks[2]!.id, training.blocks[3]!.id, training.blocks[5]!.id];
    for (const id of untouched) expect(ids(t)).toContain(id);
    expect(ids(t)).not.toContain(training.blocks[1]!.id);
  });
});

describe("generateSingleBlock", () => {
  it.each(BLOCK_TYPES.flatMap((type) => DEFAULT_EQUIPMENT_PROFILES.map((p) => [type, p.id] as const)))(
    "%s / %s erzeugt genau einen Block nahe 20 min",
    (blockType, equipmentId) => {
      const training = generateSingleBlock(single({ blockType, equipment: profile(equipmentId) }), library);
      expect(training.type).toBe("single");
      expect(training.blocks).toHaveLength(1);
      const minutes = trainingSeconds(training) / 60;
      expect(minutes).toBeGreaterThan(16);
      expect(minutes).toBeLessThan(24);
      expect(training.blocks[0]!.rounds).toBeLessThanOrEqual(maxRounds(training.blocks[0]!.type));
    },
  );

  it("ersetzt Sackarbeit ohne Sandsack durch Schattenboxen", () => {
    const training = generateSingleBlock(single({ blockType: "bag", equipment: profile("home") }), library);
    expect(training.blocks[0]?.type).toBe("shadow");
    expect(training.blocks[0]?.comboIds.length).toBeGreaterThanOrEqual(4);
  });

  it("ist bei gleichem Seed reproduzierbar", () => {
    expect(generateSingleBlock(single({ seed: 4 }), library)).toEqual(generateSingleBlock(single({ seed: 4 }), library));
  });

  it("nutzt das Fokus-Thema bei Blöcken mit Fokus", () => {
    const training = generateSingleBlock(single({ blockType: "drill", focusTheme: "Jab als Türöffner" }), library);
    expect(training.focusTheme).toBe("Jab als Türöffner");
    expect(training.blocks[0]?.focusTheme).toBe("Jab als Türöffner");
  });

  it("wählt ohne Vorgabe ein Fokus-Thema nur bei Blöcken mit Fokus", () => {
    expect(generateSingleBlock(single({ blockType: "shadow" }), library).focusTheme).toBeDefined();
    const core = generateSingleBlock(single({ blockType: "core" }), library);
    expect(core.focusTheme).toBeUndefined();
    expect(core.blocks[0]?.focusTheme).toBeUndefined();
  });

  it("lehnt ein Fokus-Thema bei Blöcken ohne Fokus ab", () => {
    expect(() => generateSingleBlock(single({ blockType: "core", focusTheme: "Jab als Türöffner" }), library)).toThrow(
      GeneratorError,
    );
  });

  it("wirft bei ungültiger Zieldauer oder unbekanntem Blocktyp", () => {
    expect(() => generateSingleBlock(single({ targetMinutes: 0 }), library)).toThrow(GeneratorError);
    expect(() => generateSingleBlock(single({ blockType: "sparring" as BlockType }), library)).toThrow(GeneratorError);
  });
});

describe("Vorlagen", () => {
  it("Block-Katalog nutzt dieselben Übungsvorgaben wie die Trainingsvorlagen", () => {
    for (const template of Object.values(TRAINING_TEMPLATES)) {
      for (const block of template.blocks) {
        if (block.exercises) expect(BLOCK_TEMPLATES[block.type].exercises, block.key).toEqual(block.exercises);
      }
    }
  });

  it("Trainingsvorlagen bleiben innerhalb der Rundengrenzen", () => {
    for (const template of Object.values(TRAINING_TEMPLATES)) {
      for (const block of template.blocks) {
        expect(block.scale?.max ?? block.rounds, block.key).toBeLessThanOrEqual(maxRounds(block.type));
      }
    }
  });

  it("beschriftet Einzelblöcke mit dem Blocktyp", () => {
    expect(trainingLabel(generateSingleBlock(single({ blockType: "core" }), library))).toBe("Einzelblock: Rumpf");
    expect(trainingLabel(base())).toBe("Technik");
  });
});

describe("Backup mit Einzelblock", () => {
  it("akzeptiert Sessions vom Typ single", () => {
    const training = generateSingleBlock(single(), library);
    const session = {
      id: "s1",
      date: "2026-11-04T10:00:00.000Z",
      training,
      completedBlockIds: ids(training),
      actualSeconds: 1200,
      rpe: 6,
      note: "",
    };
    const text = JSON.stringify({ app: "boxtrainer", version: 1, exportedAt: "2026-11-04T11:00:00.000Z", sessions: [session] });
    expect(parseBackup(text).sessions[0]?.training).toEqual(training);
  });
});
