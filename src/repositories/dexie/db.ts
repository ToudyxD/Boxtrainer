import Dexie, { type EntityTable } from "dexie";
import type { Session } from "../../domain/models";

export class BoxtrainerDb extends Dexie {
  sessions!: EntityTable<Session, "id">;

  constructor(name = "boxtrainer") {
    super(name);
    this.version(1).stores({ sessions: "id, date" });
  }
}

/** Bittet den Browser, die Daten nicht automatisch zu löschen. Liefert, ob die Anfrage gewährt wurde. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!("storage" in navigator) || typeof navigator.storage.persist !== "function") return false;
  return navigator.storage.persist();
}
