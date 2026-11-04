import type { Session } from "../../domain/models";
import type { SessionRepository } from "../types";
import type { BoxtrainerDb } from "./db";

export class DexieSessionRepository implements SessionRepository {
  constructor(private readonly db: BoxtrainerDb) {}

  async add(session: Session): Promise<void> {
    await this.db.sessions.add(session);
  }

  get(id: string): Promise<Session | undefined> {
    return this.db.sessions.get(id);
  }

  list(): Promise<Session[]> {
    return this.db.sessions.orderBy("date").reverse().toArray();
  }

  async remove(id: string): Promise<void> {
    await this.db.sessions.delete(id);
  }

  async addMissing(sessions: readonly Session[]): Promise<number> {
    return this.db.transaction("rw", this.db.sessions, async () => {
      const existing = await this.db.sessions.bulkGet(sessions.map((s) => s.id));
      const fresh = sessions.filter((_, i) => existing[i] === undefined);
      await this.db.sessions.bulkAdd(fresh);
      return fresh.length;
    });
  }
}
