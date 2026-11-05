import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { BODY_AREAS, BODY_AREA_GROUP, BODY_AREA_LABELS, exerciseGroups } from "./bodyAreas";
import { ContentError, validateExercises } from "./content";
import { generateSingleBlock, generateTraining, rerollBlock, type ContentInput } from "./generator";
import type { BodyArea, BodyGroup, Exercise, Level, Style, Training } from "./models";

const library = loadLibrary();
const byId = new Map(library.exercises.map((e) => [e.id, e]));
const COVER: BodyGroup[] = ["legs", "upper", "core"];
const STYLES: Style[] = ["boxing", "kickboxing"];
const LEVELS: Level[] = [1, 2, 3];

const groupsOf = (ids: readonly string[]): Set<BodyGroup> =>
  new Set(ids.flatMap((id) => [...exerciseGroups(byId.get(id)!)]));

const sample = (over: Partial<Exercise> = {}): Exercise => ({ ...library.exercises[0]!, ...over });

describe("Körperbereiche der Übungen", () => {
  it("jede Übung hat mindestens einen gültigen Bereich", () => {
    for (const e of library.exercises) {
      expect(e.bodyAreas.length, e.id).toBeGreaterThan(0);
      for (const a of e.bodyAreas) expect(BODY_AREAS, `${e.id}: ${a}`).toContain(a);
    }
  });

  it("jeder Bereich hat eine Bezeichnung und einen Hauptbereich", () => {
    for (const a of BODY_AREAS) {
      expect(BODY_AREA_LABELS[a]).toBeTruthy();
      expect(BODY_AREA_GROUP[a]).toBeTruthy();
    }
  });

  it("leitet Hauptbereiche aus den Unterbereichen ab", () => {
    expect(exerciseGroups({ bodyAreas: ["hips", "obliques"] })).toEqual(new Set(["legs", "core"]));
    expect(exerciseGroups({ bodyAreas: ["full-body"] })).toEqual(new Set(["full"]));
  });

  it("Liegestütze beanspruchen Brust, Trizeps und Schultern", () => {
    expect(byId.get("push-up")?.bodyAreas).toEqual(["chest", "triceps", "shoulders"]);
  });

  it("Aufwärmen und Cooldown decken Beine, Oberkörper und Rumpf ab", () => {
    for (const phase of ["warmup", "cooldown"] as const) {
      const pool = library.exercises.filter((e) => e.phases?.includes(phase));
      expect(pool.length).toBeGreaterThanOrEqual(8);
      const covered = groupsOf(pool.map((e) => e.id));
      for (const g of COVER) expect(covered, `${phase}: ${g}`).toContain(g);
    }
  });

  it("es gibt Aufwärmübungen für Handgelenke, Nacken, Brust, Waden und Seite", () => {
    const areas = new Set(library.exercises.filter((e) => e.phases?.includes("warmup")).flatMap((e) => e.bodyAreas));
    for (const a of ["forearms", "neck", "chest", "calves", "obliques"] as BodyArea[]) expect(areas).toContain(a);
  });
});

describe("Validierung der Körperbereiche", () => {
  it("lehnt leere Bereiche ab", () => {
    expect(() => validateExercises([sample({ bodyAreas: [] })])).toThrow(ContentError);
  });

  it("lehnt unbekannte Bereiche ab", () => {
    expect(() => validateExercises([sample({ bodyAreas: ["knee" as BodyArea] })])).toThrow(/unbekannter Körperbereich/);
  });

  it("lehnt doppelte Bereiche ab", () => {
    expect(() => validateExercises([sample({ bodyAreas: ["hips", "hips"] })])).toThrow(/doppelter/);
  });

  it("lehnt full-body in Kombination ab", () => {
    expect(() => validateExercises([sample({ bodyAreas: ["full-body", "hips"] })])).toThrow(/full-body/);
  });

  it("akzeptiert die Bibliothek", () => {
    expect(() => validateExercises(library.exercises)).not.toThrow();
  });
});

describe("Abdeckung in Aufwärmen und Cooldown", () => {
  const input = (equipmentId: string, style: Style, level: Level, seed: number): Parameters<typeof generateTraining>[0] => ({
    type: "technique",
    equipment: DEFAULT_EQUIPMENT_PROFILES.find((p) => p.id === equipmentId)!,
    targetMinutes: 75,
    style,
    level,
    seed,
    history: [],
  });

  const expectCovered = (training: Training, label: string): void => {
    for (const type of ["warmup", "cooldown"] as const) {
      const block = training.blocks.find((b) => b.type === type)!;
      expect(new Set(block.exerciseIds).size, `${label} ${type}: doppelte Übung`).toBe(block.exerciseIds.length);
      const groups = groupsOf(block.exerciseIds);
      for (const g of COVER) expect(groups, `${label} ${type}: ${g}`).toContain(g);
    }
  };

  it.each(DEFAULT_EQUIPMENT_PROFILES.flatMap((p) => STYLES.flatMap((s) => LEVELS.map((l) => [p.id, s, l] as const))))(
    "%s / %s / Level %i deckt über 25 Seeds alle Hauptbereiche ab",
    (equipmentId, style, level) => {
      for (let seed = 1; seed <= 25; seed++) {
        expectCovered(generateTraining(input(equipmentId, style, level, seed), library), `Seed ${seed}`);
      }
    },
  );

  it("Aufwärmen hat 8 Übungen, Cooldown 7", () => {
    const t = generateTraining(input("home", "boxing", 1, 3), library);
    expect(t.blocks.find((b) => b.type === "warmup")?.exerciseIds).toHaveLength(8);
    expect(t.blocks.find((b) => b.type === "cooldown")?.exerciseIds).toHaveLength(7);
  });

  it("variiert die Auswahl zwischen Seeds", () => {
    const sets = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) =>
        [...generateTraining(input("home", "kickboxing", 2, seed), library).blocks[0]!.exerciseIds].sort().join(),
      ),
    );
    expect(sets.size).toBeGreaterThan(1);
  });

  it("bleibt bei gleichem Seed reproduzierbar", () => {
    expect(generateTraining(input("home", "kickboxing", 2, 9), library)).toEqual(
      generateTraining(input("home", "kickboxing", 2, 9), library),
    );
  });

  it("Einzelblock Aufwärmen und Neu würfeln behalten die Abdeckung", () => {
    const content: ContentInput = {
      equipment: DEFAULT_EQUIPMENT_PROFILES.find((p) => p.id === "home")!,
      style: "kickboxing",
      level: 2,
      history: [],
    };
    for (let seed = 1; seed <= 15; seed++) {
      const single = generateSingleBlock({ ...content, blockType: "warmup", targetMinutes: 10, seed }, library);
      for (const g of COVER) expect(groupsOf(single.blocks[0]!.exerciseIds), `Seed ${seed}: ${g}`).toContain(g);
      const rerolled = rerollBlock(single, 0, content, library, seed + 100);
      for (const g of COVER) expect(groupsOf(rerolled.blocks[0]!.exerciseIds), `Seed ${seed}: ${g}`).toContain(g);
    }
  });

  it("wirft nicht, wenn für einen Bereich keine Übung existiert", () => {
    const noCore = {
      ...library,
      exercises: library.exercises.filter((e) => !(e.phases?.includes("warmup") && exerciseGroups(e).has("core"))),
    };
    const t = generateTraining(input("home", "kickboxing", 2, 4), noCore);
    const warmup = t.blocks[0]!;
    expect(warmup.exerciseIds.length).toBeGreaterThan(0);
    expect(groupsOf(warmup.exerciseIds)).not.toContain("core");
  });
});
