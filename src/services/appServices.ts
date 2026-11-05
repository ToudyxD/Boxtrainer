import { DEFAULT_EQUIPMENT_PROFILES } from "../content";
import { BoxtrainerDb } from "../repositories/dexie/db";
import { DexieSessionRepository } from "../repositories/dexie/sessionRepository";
import { DexieSettingsRepository } from "../repositories/dexie/settingsRepository";
import { SessionService } from "./sessionService";
import { SettingsService } from "./settingsService";

let db: BoxtrainerDb | undefined;
let sessionService: SessionService | undefined;
let settingsService: SettingsService | undefined;

function getDb(): BoxtrainerDb {
  db ??= new BoxtrainerDb();
  return db;
}

export function getSessionService(): SessionService {
  sessionService ??= new SessionService(new DexieSessionRepository(getDb()));
  return sessionService;
}

export function getSettingsService(): SettingsService {
  settingsService ??= new SettingsService(new DexieSettingsRepository(getDb()), DEFAULT_EQUIPMENT_PROFILES);
  return settingsService;
}
