import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { BackupError } from "../domain/backup";
import { generateTraining } from "../domain/generator";
import type { Training } from "../domain/models";
import { BoxtrainerDb } from "../repositories/dexie/db";
import { DexieSessionRepository } from "../repositories/dexie/sessionRepository";
import { SessionService } from "./sessionService";

const library = loadLibrary();
const gym = DEFAULT_EQUIPMENT_PROFILES.find((p) => p.id === "martial-arts-gym")!;

const training = (seed = 1, focusTheme?: string): Training =>
  generateTraining(
    {
      type: "technique",
      equipment: gym,
      targetMinutes: 75,
      style: "kickboxing",
      level: 2,
      seed,
      history: [],
      ...(focusTheme ? { focusTheme } : {}),
    },
    library,
  );

let dbCounter = 0;
let clock: number;

const make = () => {
  const db = new BoxtrainerDb(`test-${dbCounter++}`);
  clock = Date.parse("2026-11-01T10:00:00Z");
  let ids = 0;
  const service = new SessionService(
    new DexieSessionRepository(db),
    () => new Date((clock += 3_600_000)),
    () => `id-${ids++}`,
  );
  return { db, service };
};

const input = (t: Training, over: Partial<Parameters<SessionService["record"]>[0]> = {}) => ({
  training: t,
  completedBlockIds: t.blocks.map((b) => b.id),
  actualSeconds: 4500,
  rpe: 7,
  note: "",
  ...over,
});

describe("SessionService", () => {
  let env: ReturnType<typeof make>;
  beforeEach(() => {
    env = make();
  });

  it("speichert eine Session und liest sie zurück", async () => {
    const t = training();
    const saved = await env.service.record(input(t, { note: "  lief gut  " }));
    const [loaded] = await env.service.list();
    expect(loaded).toEqual(saved);
    expect(loaded?.note).toBe("lief gut");
    expect(loaded?.training).toEqual(t);
  });

  it("liefert neueste Sessions zuerst", async () => {
    const a = await env.service.record(input(training(1)));
    const b = await env.service.record(input(training(2)));
    const c = await env.service.record(input(training(3)));
    expect((await env.service.list()).map((s) => s.id)).toEqual([c.id, b.id, a.id]);
  });

  it.each([0, 11, 7.5, Number.NaN])("lehnt RPE %s ab", async (rpe) => {
    await expect(env.service.record(input(training(), { rpe }))).rejects.toThrow(RangeError);
    expect(await env.service.list()).toHaveLength(0);
  });

  it("lehnt Block-IDs ab, die nicht zum Training gehören", async () => {
    await expect(env.service.record(input(training(), { completedBlockIds: ["nope"] }))).rejects.toThrow();
  });

  it("lehnt negative Dauer ab", async () => {
    await expect(env.service.record(input(training(), { actualSeconds: -1 }))).rejects.toThrow(RangeError);
  });

  it("entfernt Sessions", async () => {
    const s = await env.service.record(input(training()));
    await env.service.remove(s.id);
    expect(await env.service.list()).toHaveLength(0);
  });

  describe("history", () => {
    it("zählt nur absolvierte Blöcke und übernimmt das Fokus-Thema", async () => {
      const t = training(1, "Lowkick setzen");
      const first = t.blocks[0]!;
      const bag = t.blocks.find((b) => b.type === "bag")!;
      await env.service.record(input(t, { completedBlockIds: [first.id] }));

      const [entry] = await env.service.history();
      expect(entry?.focusTheme).toBe("Lowkick setzen");
      expect(entry?.exerciseIds).toEqual(first.exerciseIds);
      for (const id of bag.comboIds) expect(entry?.comboIds).not.toContain(id);
    });

    it("füttert den Generator: zuletzt trainiertes Thema wird nicht erneut gewählt", async () => {
      const themes = ["Jab als Türöffner", "Verteidigen und kontern", "Lowkick setzen", "Teep und Distanz", "Kniefinish"];
      for (const [i, theme] of themes.entries()) await env.service.record(input(training(i, theme)));
      const history = await env.service.history();

      const next = generateTraining(
        { type: "technique", equipment: gym, targetMinutes: 75, style: "kickboxing", level: 2, seed: 99, history },
        library,
      );
      expect(next.focusTheme).toBe("Körper und Kopf");
    });
  });

  describe("Backup", () => {
    it("exportiert und importiert verlustfrei in eine leere Datenbank", async () => {
      await env.service.record(input(training(1), { note: "a" }));
      await env.service.record(input(training(2), { note: "b", rpe: 9 }));
      const json = await env.service.exportBackup();

      const other = make();
      expect(await other.service.importBackup(json)).toEqual({ added: 2, skipped: 0 });
      expect(await other.service.list()).toEqual(await env.service.list());
    });

    it("überspringt bereits vorhandene Sessions beim Import", async () => {
      await env.service.record(input(training(1)));
      const json = await env.service.exportBackup();
      expect(await env.service.importBackup(json)).toEqual({ added: 0, skipped: 1 });
      expect(await env.service.list()).toHaveLength(1);
    });

    it("importiert nichts, wenn die Datei ungültig ist", async () => {
      await env.service.record(input(training(1)));
      const parsed = JSON.parse(await env.service.exportBackup());
      parsed.sessions.push({ ...parsed.sessions[0], id: "other", rpe: 42 });
      const before = await env.service.list();
      await expect(env.service.importBackup(JSON.stringify(parsed))).rejects.toThrow(BackupError);
      expect(await env.service.list()).toEqual(before);
    });
  });
});
