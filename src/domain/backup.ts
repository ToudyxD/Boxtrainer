import type { BlockType, Session, TrainingType } from "./models";

export class BackupError extends Error {}

export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: "boxtrainer";
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  sessions: Session[];
}

const BLOCK_TYPES: Record<BlockType, true> = {
  warmup: true,
  shadow: true,
  drill: true,
  bag: true,
  power: true,
  strength: true,
  conditioning: true,
  core: true,
  circuit: true,
  cooldown: true,
};

const TRAINING_TYPES: Record<TrainingType, true> = {
  technique: true,
  stamina: true,
  power: true,
  strength: true,
  "strength-endurance": true,
  single: true,
};

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function fail(path: string, message: string): never {
  throw new BackupError(`${path}: ${message}`);
}

function str(obj: Json, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== "string") fail(`${path}.${key}`, "Text erwartet");
  return v;
}

function num(obj: Json, key: string, path: string, min = 0): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) fail(`${path}.${key}`, `Zahl >= ${min} erwartet`);
  return v;
}

function strArray(obj: Json, key: string, path: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) fail(`${path}.${key}`, "Liste von Texten erwartet");
  return v as string[];
}

export function validateRpe(rpe: number): void {
  if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) throw new RangeError(`RPE muss eine ganze Zahl von 1 bis 10 sein: ${rpe}`);
}

function validateBlock(raw: unknown, path: string): string {
  if (!isObject(raw)) fail(path, "Objekt erwartet");
  const id = str(raw, "id", path);
  const type = str(raw, "type", path);
  if (!(type in BLOCK_TYPES)) fail(`${path}.type`, `unbekannter Blocktyp "${type}"`);
  num(raw, "rounds", path, 1);
  num(raw, "roundSeconds", path, 1);
  num(raw, "restSeconds", path);
  strArray(raw, "comboIds", path);
  const exerciseIds = strArray(raw, "exerciseIds", path);
  const seconds = raw["exerciseSeconds"];
  if (seconds !== undefined) {
    if (!Array.isArray(seconds) || seconds.some((s) => typeof s !== "number" || !Number.isFinite(s) || s < 1)) {
      fail(`${path}.exerciseSeconds`, "Liste von Zahlen >= 1 erwartet");
    }
    if (seconds.length !== exerciseIds.length) fail(`${path}.exerciseSeconds`, "muss genauso lang sein wie exerciseIds");
  }
  return id;
}

function validateSession(raw: unknown, index: number): Session {
  const path = `sessions[${index}]`;
  if (!isObject(raw)) fail(path, "Objekt erwartet");

  const id = str(raw, "id", path);
  if (id === "") fail(`${path}.id`, "darf nicht leer sein");
  const date = str(raw, "date", path);
  if (Number.isNaN(Date.parse(date))) fail(`${path}.date`, "kein gültiges Datum");

  const training = raw["training"];
  if (!isObject(training)) fail(`${path}.training`, "Objekt erwartet");
  const trainingType = str(training, "type", `${path}.training`);
  if (!(trainingType in TRAINING_TYPES)) fail(`${path}.training.type`, `unbekannter Typ "${trainingType}"`);
  const blocks = training["blocks"];
  if (!Array.isArray(blocks) || blocks.length === 0) fail(`${path}.training.blocks`, "nicht-leere Liste erwartet");
  const blockIds = new Set(blocks.map((b, i) => validateBlock(b, `${path}.training.blocks[${i}]`)));

  const completed = strArray(raw, "completedBlockIds", path);
  const unknown = completed.find((c) => !blockIds.has(c));
  if (unknown !== undefined) fail(`${path}.completedBlockIds`, `Block "${unknown}" gehört nicht zum Training`);

  const rpe = num(raw, "rpe", path, 1);
  try {
    validateRpe(rpe);
  } catch (err) {
    fail(`${path}.rpe`, err instanceof Error ? err.message : String(err));
  }

  return {
    id,
    date,
    training: training as unknown as Session["training"],
    completedBlockIds: completed,
    actualSeconds: num(raw, "actualSeconds", path),
    rpe,
    note: str(raw, "note", path),
  };
}

export function createBackup(sessions: readonly Session[], now: Date): BackupFile {
  return { app: "boxtrainer", version: BACKUP_VERSION, exportedAt: now.toISOString(), sessions: [...sessions] };
}

export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("Datei ist kein gültiges JSON");
  }
  if (!isObject(raw) || raw["app"] !== "boxtrainer") throw new BackupError("Datei stammt nicht aus dieser App");
  if (raw["version"] !== BACKUP_VERSION) throw new BackupError(`Nicht unterstützte Version: ${String(raw["version"])}`);
  const sessions = raw["sessions"];
  if (!Array.isArray(sessions)) throw new BackupError("sessions: Liste erwartet");

  const parsed = sessions.map(validateSession);
  const ids = new Set<string>();
  for (const s of parsed) {
    if (ids.has(s.id)) throw new BackupError(`Doppelte Session-ID: ${s.id}`);
    ids.add(s.id);
  }
  return {
    app: "boxtrainer",
    version: BACKUP_VERSION,
    exportedAt: str(raw, "exportedAt", "backup"),
    sessions: parsed,
  };
}
