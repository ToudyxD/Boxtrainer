import { createBackup, parseBackup, validateRpe } from "../domain/backup";
import type { HistoryEntry } from "../domain/generator";
import type { Session, Training } from "../domain/models";
import type { SessionRepository } from "../repositories/types";

export interface RecordInput {
  training: Training;
  completedBlockIds: string[];
  actualSeconds: number;
  rpe: number;
  note: string;
}

export interface ImportResult {
  added: number;
  skipped: number;
}

export class SessionService {
  constructor(
    private readonly repo: SessionRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async record(input: RecordInput): Promise<Session> {
    validateRpe(input.rpe);
    if (!Number.isFinite(input.actualSeconds) || input.actualSeconds < 0) {
      throw new RangeError(`Ungültige Dauer: ${input.actualSeconds}`);
    }
    const blockIds = new Set(input.training.blocks.map((b) => b.id));
    const unknown = input.completedBlockIds.find((id) => !blockIds.has(id));
    if (unknown !== undefined) throw new Error(`Block ${unknown} gehört nicht zum Training`);

    const session: Session = {
      id: this.newId(),
      date: this.now().toISOString(),
      training: input.training,
      completedBlockIds: input.completedBlockIds,
      actualSeconds: Math.round(input.actualSeconds),
      rpe: input.rpe,
      note: input.note.trim(),
    };
    await this.repo.add(session);
    return session;
  }

  list(): Promise<Session[]> {
    return this.repo.list();
  }

  remove(id: string): Promise<void> {
    return this.repo.remove(id);
  }

  /** Verlauf für den Generator: nur tatsächlich absolvierte Blöcke zählen, neueste zuerst. */
  async history(): Promise<HistoryEntry[]> {
    return (await this.repo.list()).map((s) => {
      const done = new Set(s.completedBlockIds);
      const blocks = s.training.blocks.filter((b) => done.has(b.id));
      return {
        date: s.date,
        ...(s.training.focusTheme ? { focusTheme: s.training.focusTheme } : {}),
        comboIds: blocks.flatMap((b) => b.comboIds),
        exerciseIds: blocks.flatMap((b) => b.exerciseIds),
      };
    });
  }

  async exportBackup(): Promise<string> {
    return JSON.stringify(createBackup(await this.repo.list(), this.now()), null, 2);
  }

  async importBackup(text: string): Promise<ImportResult> {
    const backup = parseBackup(text);
    const added = await this.repo.addMissing(backup.sessions);
    return { added, skipped: backup.sessions.length - added };
  }
}
