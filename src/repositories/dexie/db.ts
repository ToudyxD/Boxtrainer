import Dexie, { type EntityTable } from "dexie";
import type { Session } from "../../domain/models";

export interface StoredSettings {
  id: string;
  [key: string]: unknown;
}

export class BoxtrainerDb extends Dexie {
  sessions!: EntityTable<Session, "id">;
  settings!: EntityTable<StoredSettings, "id">;

  constructor(name = "boxtrainer") {
    super(name);
    this.version(1).stores({ sessions: "id, date" });
    this.version(2).stores({ sessions: "id, date", settings: "id" });
  }
}

/** Bittet den Browser, die Daten nicht automatisch zu löschen. Liefert, ob die Anfrage gewährt wurde. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!("storage" in navigator) || typeof navigator.storage.persist !== "function") return false;
  return navigator.storage.persist();
}
