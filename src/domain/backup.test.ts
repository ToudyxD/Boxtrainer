import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { BackupError, createBackup, parseBackup, validateRpe } from "./backup";
import { generateTraining } from "./generator";
import type { Session } from "./models";

const library = loadLibrary();
const training = generateTraining(
  {
    type: "stamina",
    equipment: DEFAULT_EQUIPMENT_PROFILES[1]!,
    targetMinutes: 75,
    style: "kickboxing",
    level: 2,
    seed: 5,
    history: [],
  },
  library,
);

const session = (over: Partial<Session> = {}): Session => ({
  id: "s1",
  date: "2026-11-01T10:00:00.000Z",
  training,
  completedBlockIds: training.blocks.map((b) => b.id),
  actualSeconds: 4500,
  rpe: 7,
  note: "ok",
  ...over,
});

const file = (sessions: unknown[], over: Record<string, unknown> = {}): string =>
  JSON.stringify({ app: "boxtrainer", version: 1, exportedAt: "2026-11-02T00:00:00.000Z", sessions, ...over });

describe("validateRpe", () => {
  it.each([1, 5, 10])("akzeptiert %i", (v) => expect(() => validateRpe(v)).not.toThrow());
  it.each([0, 11, -1, 5.5, Number.NaN, Number.POSITIVE_INFINITY])("lehnt %s ab", (v) =>
    expect(() => validateRpe(v)).toThrow(RangeError),
  );
});

describe("Backup", () => {
  it("überlebt einen Round-Trip unverändert", () => {
    const sessions = [session(), session({ id: "s2", rpe: 9, note: "Umlaute äöü" })];
    const parsed = parseBackup(JSON.stringify(createBackup(sessions, new Date("2026-11-02T00:00:00Z"))));
    expect(parsed.sessions).toEqual(sessions);
    expect(parsed.exportedAt).toBe("2026-11-02T00:00:00.000Z");
  });

  it("akzeptiert eine leere Liste", () => {
    expect(parseBackup(file([])).sessions).toEqual([]);
  });

  it.each([
    ["kein JSON", "{nope", /JSON/],
    ["fremde App", JSON.stringify({ app: "other", version: 1, sessions: [] }), /nicht aus dieser App/],
    ["falsche Version", file([], { version: 2 }), /Version/],
    ["sessions fehlt", JSON.stringify({ app: "boxtrainer", version: 1, exportedAt: "x" }), /sessions/],
  ])("lehnt ab: %s", (_name, text, pattern) => {
    expect(() => parseBackup(text)).toThrow(BackupError);
    expect(() => parseBackup(text)).toThrow(pattern);
  });

  it.each([
    ["RPE 0", { rpe: 0 }, /rpe/],
    ["RPE 11", { rpe: 11 }, /rpe/],
    ["RPE gebrochen", { rpe: 6.5 }, /rpe/],
    ["RPE als Text", { rpe: "7" }, /rpe/],
    ["ungültiges Datum", { date: "gestern" }, /date/],
    ["leere ID", { id: "" }, /id/],
    ["Notiz fehlt", { note: undefined }, /note/],
    ["negative Dauer", { actualSeconds: -5 }, /actualSeconds/],
    ["fremder Block", { completedBlockIds: ["x"] }, /completedBlockIds/],
    ["Training fehlt", { training: undefined }, /training/],
  ])("lehnt Session ab: %s", (_name, over, pattern) => {
    const text = file([{ ...session(), ...over }]);
    expect(() => parseBackup(text)).toThrow(BackupError);
    expect(() => parseBackup(text)).toThrow(pattern);
  });

  it("lehnt unbekannte Blocktypen ab", () => {
    const bad = { ...session(), training: { ...training, blocks: [{ ...training.blocks[0], type: "yoga" }] }, completedBlockIds: [] };
    expect(() => parseBackup(file([bad]))).toThrow(/Blocktyp/);
  });

  it("lehnt doppelte Session-IDs ab", () => {
    expect(() => parseBackup(file([session(), session()]))).toThrow(/Doppelte/);
  });

  it("nennt die Position des Fehlers", () => {
    expect(() => parseBackup(file([session(), session({ id: "s2", rpe: 99 })]))).toThrow(/sessions\[1\]/);
  });
});
