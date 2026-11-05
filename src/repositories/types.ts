import type { Session } from "../domain/models";

export interface SettingsRepository {
  /** Rohdaten wie gespeichert, oder undefined, wenn noch nichts gespeichert wurde. */
  load(): Promise<unknown | undefined>;
  save(settings: unknown): Promise<void>;
}

export interface SessionRepository {
  /** Wirft, wenn die ID bereits existiert. */
  add(session: Session): Promise<void>;
  get(id: string): Promise<Session | undefined>;
  /** Neueste zuerst. */
  list(): Promise<Session[]>;
  remove(id: string): Promise<void>;
  /** Fügt nur Sessions mit unbekannter ID ein und liefert die Anzahl der neu angelegten. */
  addMissing(sessions: readonly Session[]): Promise<number>;
}
