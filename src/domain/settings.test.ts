import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES } from "../content";
import type { EquipmentTag } from "./models";
import {
  EQUIPMENT_LABELS,
  EQUIPMENT_TAGS,
  MAX_PROFILES,
  NAME_MAX_LENGTH,
  SettingsError,
  addProfile,
  defaultSettings,
  removeProfile,
  resetProfile,
  setPreferences,
  updateProfile,
  validateSettings,
} from "./settings";

const base = () => defaultSettings(DEFAULT_EQUIPMENT_PROFILES);

describe("defaultSettings", () => {
  it("übernimmt die drei vorbelegten Orte als Kopie", () => {
    const s = base();
    expect(s.equipmentProfiles.map((p) => p.id)).toEqual(["home", "martial-arts-gym", "fitness-gym"]);
    s.equipmentProfiles[0]!.tags.push("barbell");
    expect(DEFAULT_EQUIPMENT_PROFILES[0]!.tags).not.toContain("barbell");
  });

  it("ist gültig", () => {
    expect(validateSettings(base())).toEqual(base());
  });

  it("hat zu jedem Equipment eine Bezeichnung", () => {
    for (const tag of EQUIPMENT_TAGS) expect(EQUIPMENT_LABELS[tag]).toBeTruthy();
    for (const p of DEFAULT_EQUIPMENT_PROFILES) for (const t of p.tags) expect(EQUIPMENT_TAGS).toContain(t);
  });
});

describe("validateSettings", () => {
  it.each([
    ["null", null],
    ["Text", "x"],
    ["Liste", []],
    ["unbekannter Stil", { ...base(), style: "mma" }],
    ["Level 4", { ...base(), level: 4 }],
    ["Level als Text", { ...base(), level: "2" }],
    ["keine Orte", { ...base(), equipmentProfiles: [] }],
    ["Orte kein Array", { ...base(), equipmentProfiles: "x" }],
    ["Ort ohne ID", { ...base(), equipmentProfiles: [{ name: "A", tags: [] }] }],
    ["Ort mit leerem Namen", { ...base(), equipmentProfiles: [{ id: "a", name: "  ", tags: [] }] }],
    ["Ort mit zu langem Namen", { ...base(), equipmentProfiles: [{ id: "a", name: "x".repeat(NAME_MAX_LENGTH + 1), tags: [] }] }],
    ["Ort mit unbekanntem Equipment", { ...base(), equipmentProfiles: [{ id: "a", name: "A", tags: ["ring"] }] }],
    ["Ort mit doppeltem Equipment", { ...base(), equipmentProfiles: [{ id: "a", name: "A", tags: ["mat", "mat"] }] }],
    ["doppelte ID", { ...base(), equipmentProfiles: [{ id: "a", name: "A", tags: [] }, { id: "a", name: "B", tags: [] }] }],
    ["doppelter Name ohne Groß/Klein", { ...base(), equipmentProfiles: [{ id: "a", name: "Gym", tags: [] }, { id: "b", name: "gym", tags: [] }] }],
  ])("lehnt ab: %s", (_name, raw) => {
    expect(() => validateSettings(raw)).toThrow(SettingsError);
  });

  it("lehnt mehr als die Höchstzahl an Orten ab", () => {
    const profiles = Array.from({ length: MAX_PROFILES + 1 }, (_, i) => ({ id: `p${i}`, name: `Ort ${i}`, tags: [] }));
    expect(() => validateSettings({ ...base(), equipmentProfiles: profiles })).toThrow(/Höchstens/);
  });

  it("schneidet Leerraum ab und sortiert das Equipment", () => {
    const s = validateSettings({
      ...base(),
      equipmentProfiles: [{ id: "a", name: "  Garage ", tags: ["barbell", "heavy-bag", "mat"] }],
    });
    expect(s.equipmentProfiles[0]).toEqual({ id: "a", name: "Garage", tags: ["heavy-bag", "mat", "barbell"] });
  });

  it("erlaubt einen Ort ohne jedes Equipment", () => {
    expect(() => validateSettings({ ...base(), equipmentProfiles: [{ id: "a", name: "Park", tags: [] }] })).not.toThrow();
  });
});

describe("Auslage", () => {
  it("ist standardmäßig Rechtsauslage", () => {
    expect(base().stance).toBe("orthodox");
  });

  it("wird bei Einstellungen ohne Auslage mit der Vorgabe ergänzt", () => {
    const { stance: _stance, ...old } = base();
    expect(validateSettings(old).stance).toBe("orthodox");
  });

  it("lehnt unbekannte Auslagen ab", () => {
    expect(() => validateSettings({ ...base(), stance: "switch" })).toThrow(/Unbekannte Auslage/);
    expect(() => validateSettings({ ...base(), stance: null })).toThrow(SettingsError);
  });

  it("lässt sich setzen, ohne Stil und Level zu ändern", () => {
    const s = setPreferences(base(), { stance: "southpaw" });
    expect([s.stance, s.style, s.level]).toEqual(["southpaw", "kickboxing", 2]);
    expect(() => setPreferences(base(), { stance: "x" as "orthodox" })).toThrow(SettingsError);
  });
});

describe("setPreferences", () => {
  it("ändert Stil und Level", () => {
    const s = setPreferences(base(), { style: "boxing", level: 3 });
    expect([s.style, s.level]).toEqual(["boxing", 3]);
  });

  it("lässt nicht angegebene Werte unverändert", () => {
    expect(setPreferences(base(), { level: 1 }).style).toBe("kickboxing");
  });

  it("lehnt ungültige Werte ab", () => {
    expect(() => setPreferences(base(), { level: 9 as 3 })).toThrow(SettingsError);
    expect(() => setPreferences(base(), { style: "mma" as "boxing" })).toThrow(SettingsError);
  });

  it("verändert das Original nicht", () => {
    const s = base();
    setPreferences(s, { level: 3 });
    expect(s.level).toBe(2);
  });
});

describe("Orte bearbeiten", () => {
  it("legt einen neuen Ort an", () => {
    const s = addProfile(base(), { name: "Garage", tags: ["heavy-bag", "mat"] }, "custom-1");
    expect(s.equipmentProfiles).toHaveLength(4);
    expect(s.equipmentProfiles.at(-1)).toEqual({ id: "custom-1", name: "Garage", tags: ["heavy-bag", "mat"] });
  });

  it("lehnt doppelte Namen und IDs beim Anlegen ab", () => {
    expect(() => addProfile(base(), { name: "Zuhause", tags: [] }, "x")).toThrow(/existiert bereits/);
    expect(() => addProfile(base(), { name: "Neu", tags: [] }, "home")).toThrow(/Doppelte Ort-ID/);
  });

  it("lehnt ab, wenn die Höchstzahl erreicht ist", () => {
    let s = base();
    for (let i = s.equipmentProfiles.length; i < MAX_PROFILES; i++) s = addProfile(s, { name: `Ort ${i}`, tags: [] }, `p${i}`);
    expect(() => addProfile(s, { name: "Zu viel", tags: [] }, "extra")).toThrow(/Höchstens/);
  });

  it("ändert Name und Equipment eines Orts", () => {
    const s = updateProfile(base(), "home", { name: "Wohnzimmer", tags: ["mat", "jump-rope", "dumbbells"] });
    const home = s.equipmentProfiles.find((p) => p.id === "home")!;
    expect(home.name).toBe("Wohnzimmer");
    expect(home.tags).toEqual(["jump-rope", "mat", "dumbbells"]);
    expect(s.equipmentProfiles.map((p) => p.id)).toEqual(["home", "martial-arts-gym", "fitness-gym"]);
  });

  it("erlaubt den eigenen Namen beizubehalten", () => {
    expect(() => updateProfile(base(), "home", { tags: ["mat"] })).not.toThrow();
    expect(() => updateProfile(base(), "home", { name: "Zuhause" })).not.toThrow();
  });

  it("lehnt Namen anderer Orte, leere Namen und unbekanntes Equipment ab", () => {
    expect(() => updateProfile(base(), "home", { name: "Kampfsportgym" })).toThrow(/existiert bereits/);
    expect(() => updateProfile(base(), "home", { name: "" })).toThrow(SettingsError);
    expect(() => updateProfile(base(), "home", { tags: ["ring" as EquipmentTag] })).toThrow(/Unbekanntes Equipment/);
  });

  it("wirft bei unbekannter ID", () => {
    expect(() => updateProfile(base(), "nope", { name: "X" })).toThrow(/existiert nicht/);
    expect(() => removeProfile(base(), "nope")).toThrow(/existiert nicht/);
  });

  it("entfernt einen Ort, aber nie den letzten", () => {
    let s = removeProfile(base(), "fitness-gym");
    expect(s.equipmentProfiles.map((p) => p.id)).toEqual(["home", "martial-arts-gym"]);
    s = removeProfile(s, "home");
    expect(() => removeProfile(s, "martial-arts-gym")).toThrow(/Mindestens ein Ort/);
  });

  it("stellt einen vorbelegten Ort wieder her", () => {
    const changed = updateProfile(base(), "martial-arts-gym", { name: "Mein Gym", tags: [] });
    const reset = resetProfile(changed, "martial-arts-gym", DEFAULT_EQUIPMENT_PROFILES);
    expect(reset.equipmentProfiles.find((p) => p.id === "martial-arts-gym")).toEqual(
      DEFAULT_EQUIPMENT_PROFILES.find((p) => p.id === "martial-arts-gym"),
    );
  });

  it("kann einen eigenen Ort nicht zurücksetzen", () => {
    const s = addProfile(base(), { name: "Garage", tags: [] }, "custom-1");
    expect(() => resetProfile(s, "custom-1", DEFAULT_EQUIPMENT_PROFILES)).toThrow(/keine Vorbelegung/);
  });

  it("scheitert beim Zurücksetzen, wenn der Originalname inzwischen vergeben ist", () => {
    let s = updateProfile(base(), "home", { name: "Wohnzimmer" });
    s = addProfile(s, { name: "Zuhause", tags: [] }, "custom-1");
    expect(() => resetProfile(s, "home", DEFAULT_EQUIPMENT_PROFILES)).toThrow(/existiert bereits/);
  });
});
