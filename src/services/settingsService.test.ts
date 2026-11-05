import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES } from "../content";
import { SettingsError, addProfile, setPreferences, updateProfile } from "../domain/settings";
import { BoxtrainerDb } from "../repositories/dexie/db";
import { DexieSessionRepository } from "../repositories/dexie/sessionRepository";
import { DexieSettingsRepository } from "../repositories/dexie/settingsRepository";
import type { Session } from "../domain/models";
import { SettingsService } from "./settingsService";

let counter = 0;
const make = () => {
  const name = `settings-test-${counter++}`;
  const db = new BoxtrainerDb(name);
  return { db, name, service: new SettingsService(new DexieSettingsRepository(db), DEFAULT_EQUIPMENT_PROFILES) };
};

describe("SettingsService", () => {
  it("liefert ohne gespeicherte Daten die Vorbelegung", async () => {
    const { service } = make();
    const { settings, fromDefaults } = await service.load();
    expect(fromDefaults).toBe(true);
    expect(settings).toEqual(service.defaultSettings());
  });

  it("speichert und lädt unverändert", async () => {
    const { service } = make();
    let s = (await service.load()).settings;
    s = setPreferences(s, { style: "boxing", level: 3, stance: "southpaw" });
    s = updateProfile(s, "home", { name: "Wohnzimmer", tags: ["mat", "dumbbells"] });
    s = addProfile(s, { name: "Garage", tags: ["heavy-bag"] }, "custom-1");
    await service.save(s);

    const loaded = await service.load();
    expect(loaded.fromDefaults).toBe(false);
    expect(loaded.settings).toEqual(s);
  });

  it("überschreibt beim zweiten Speichern statt zu verdoppeln", async () => {
    const { service, db } = make();
    const s = service.defaultSettings();
    await service.save(s);
    await service.save(setPreferences(s, { level: 1 }));
    expect(await db.settings.count()).toBe(1);
    expect((await service.load()).settings.level).toBe(1);
  });

  it("liefert normalisierte Werte zurück", async () => {
    const { service } = make();
    const s = service.defaultSettings();
    const saved = await service.save({ ...s, equipmentProfiles: [{ id: "a", name: " Park ", tags: ["mat", "heavy-bag"] }] });
    expect(saved.equipmentProfiles[0]).toEqual({ id: "a", name: "Park", tags: ["heavy-bag", "mat"] });
  });

  it("speichert ungültige Einstellungen nicht", async () => {
    const { service, db } = make();
    const s = service.defaultSettings();
    await expect(service.save({ ...s, level: 7 as 3 })).rejects.toThrow(SettingsError);
    expect(await db.settings.count()).toBe(0);
  });

  it("wirft beim Laden beschädigter Daten", async () => {
    const { service, db } = make();
    await db.settings.put({ id: "main", style: "mma", level: 2, equipmentProfiles: [] });
    await expect(service.load()).rejects.toThrow(SettingsError);
  });

  it("liest Einstellungen ohne Auslage aus einer älteren Version", async () => {
    const { service, db } = make();
    await db.settings.put({ id: "main", style: "boxing", level: 1, equipmentProfiles: [{ id: "a", name: "Park", tags: [] }] });
    const { settings } = await service.load();
    expect(settings.stance).toBe("orthodox");
    expect(settings.style).toBe("boxing");
  });

  it("gibt dem Aufrufer keine gemeinsame Vorbelegung heraus", async () => {
    const { service } = make();
    const a = service.defaultSettings();
    a.equipmentProfiles[0]!.tags.push("barbell");
    expect(service.defaultSettings().equipmentProfiles[0]!.tags).not.toContain("barbell");
  });
});

describe("Datenbank-Update auf Version 2", () => {
  it("behält vorhandene Sessions beim Hinzufügen der Einstellungen", async () => {
    const name = `upgrade-test-${counter++}`;
    const old = new Dexie(name);
    old.version(1).stores({ sessions: "id, date" });
    const session = {
      id: "s1",
      date: "2026-11-01T10:00:00.000Z",
      training: { id: "t", type: "single", equipmentProfileId: "home", targetMinutes: 10, blocks: [] },
      completedBlockIds: [],
      actualSeconds: 60,
      rpe: 5,
      note: "",
    } as Session;
    await old.table("sessions").add(session);
    old.close();

    const db = new BoxtrainerDb(name);
    expect(await new DexieSessionRepository(db).list()).toEqual([session]);
    const service = new SettingsService(new DexieSettingsRepository(db), DEFAULT_EQUIPMENT_PROFILES);
    await service.save(service.defaultSettings());
    expect((await service.load()).fromDefaults).toBe(false);
    expect(await new DexieSessionRepository(db).list()).toEqual([session]);
  });
});
