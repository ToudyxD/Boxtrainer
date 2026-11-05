import type { EquipmentProfile, EquipmentTag, Level, Style } from "./models";

export class SettingsError extends Error {}

export interface Settings {
  style: Style;
  level: Level;
  equipmentProfiles: EquipmentProfile[];
}

export const EQUIPMENT_TAGS: readonly EquipmentTag[] = [
  "heavy-bag",
  "jump-rope",
  "mirror",
  "mat",
  "medicine-ball",
  "dumbbells",
  "kettlebell",
  "barbell",
  "pull-up-bar",
];

export const EQUIPMENT_LABELS: Record<EquipmentTag, string> = {
  "heavy-bag": "Sandsack",
  "jump-rope": "Springseil",
  mirror: "Spiegel",
  mat: "Matte",
  "medicine-ball": "Medizinball",
  dumbbells: "Kurzhanteln",
  kettlebell: "Kettlebell",
  barbell: "Langhantel",
  "pull-up-bar": "Klimmzugstange",
};

export const NAME_MAX_LENGTH = 30;
export const MAX_PROFILES = 10;

const STYLES: readonly Style[] = ["boxing", "kickboxing"];
const LEVELS: readonly Level[] = [1, 2, 3];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function defaultSettings(defaults: readonly EquipmentProfile[]): Settings {
  return validateSettings({ style: "kickboxing", level: 2, equipmentProfiles: defaults.map((p) => ({ ...p, tags: [...p.tags] })) });
}

function checkStyle(style: unknown): Style {
  if (!STYLES.includes(style as Style)) throw new SettingsError(`Unbekannter Stil: ${String(style)}`);
  return style as Style;
}

function checkLevel(level: unknown): Level {
  if (!LEVELS.includes(level as Level)) throw new SettingsError(`Ungültiges Level: ${String(level)}`);
  return level as Level;
}

function checkName(name: unknown): string {
  if (typeof name !== "string") throw new SettingsError("Name muss Text sein");
  const trimmed = name.trim();
  if (trimmed === "") throw new SettingsError("Der Name darf nicht leer sein");
  if (trimmed.length > NAME_MAX_LENGTH) throw new SettingsError(`Der Name darf höchstens ${NAME_MAX_LENGTH} Zeichen haben`);
  return trimmed;
}

/** Prüft die Tags und bringt sie in die feste Reihenfolge. */
function checkTags(tags: unknown): EquipmentTag[] {
  if (!Array.isArray(tags)) throw new SettingsError("Equipment muss eine Liste sein");
  const unknown = tags.find((t) => !EQUIPMENT_TAGS.includes(t as EquipmentTag));
  if (unknown !== undefined) throw new SettingsError(`Unbekanntes Equipment: ${String(unknown)}`);
  if (new Set(tags).size !== tags.length) throw new SettingsError("Equipment darf nicht doppelt vorkommen");
  return EQUIPMENT_TAGS.filter((t) => tags.includes(t));
}

function checkUniqueNames(profiles: readonly EquipmentProfile[]): void {
  const seen = new Set<string>();
  for (const p of profiles) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) throw new SettingsError(`Der Ort "${p.name}" existiert bereits`);
    seen.add(key);
  }
}

function checkProfiles(raw: unknown): EquipmentProfile[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new SettingsError("Mindestens ein Ort ist nötig");
  if (raw.length > MAX_PROFILES) throw new SettingsError(`Höchstens ${MAX_PROFILES} Orte möglich`);
  const ids = new Set<string>();
  const profiles = raw.map((p, i): EquipmentProfile => {
    if (!isObject(p)) throw new SettingsError(`Ort ${i + 1}: Objekt erwartet`);
    if (typeof p["id"] !== "string" || p["id"] === "") throw new SettingsError(`Ort ${i + 1}: ID fehlt`);
    if (ids.has(p["id"])) throw new SettingsError(`Doppelte Ort-ID: ${p["id"]}`);
    ids.add(p["id"]);
    return { id: p["id"], name: checkName(p["name"]), tags: checkTags(p["tags"]) };
  });
  checkUniqueNames(profiles);
  return profiles;
}

/** Prüft Daten aus dem Speicher oder von der Oberfläche und liefert normalisierte Einstellungen. */
export function validateSettings(raw: unknown): Settings {
  if (!isObject(raw)) throw new SettingsError("Einstellungen: Objekt erwartet");
  return {
    style: checkStyle(raw["style"]),
    level: checkLevel(raw["level"]),
    equipmentProfiles: checkProfiles(raw["equipmentProfiles"]),
  };
}

export function setPreferences(settings: Settings, patch: { style?: Style; level?: Level }): Settings {
  return validateSettings({ ...settings, ...patch });
}

function indexOfProfile(settings: Settings, id: string): number {
  const index = settings.equipmentProfiles.findIndex((p) => p.id === id);
  if (index === -1) throw new SettingsError(`Ort "${id}" existiert nicht`);
  return index;
}

export function addProfile(settings: Settings, input: { name: string; tags: EquipmentTag[] }, id: string): Settings {
  return validateSettings({ ...settings, equipmentProfiles: [...settings.equipmentProfiles, { id, ...input }] });
}

export function updateProfile(settings: Settings, id: string, patch: { name?: string; tags?: EquipmentTag[] }): Settings {
  const index = indexOfProfile(settings, id);
  const profiles = settings.equipmentProfiles.map((p, i) => (i === index ? { ...p, ...patch } : p));
  return validateSettings({ ...settings, equipmentProfiles: profiles });
}

export function removeProfile(settings: Settings, id: string): Settings {
  const index = indexOfProfile(settings, id);
  if (settings.equipmentProfiles.length <= 1) throw new SettingsError("Mindestens ein Ort muss bleiben");
  return { ...settings, equipmentProfiles: settings.equipmentProfiles.filter((_, i) => i !== index) };
}

/** Stellt Name und Equipment eines vorbelegten Orts wieder her. */
export function resetProfile(settings: Settings, id: string, defaults: readonly EquipmentProfile[]): Settings {
  const original = defaults.find((p) => p.id === id);
  if (!original) throw new SettingsError(`Für "${id}" gibt es keine Vorbelegung`);
  return updateProfile(settings, id, { name: original.name, tags: [...original.tags] });
}
