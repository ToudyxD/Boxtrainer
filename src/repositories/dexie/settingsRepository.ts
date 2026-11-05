import type { SettingsRepository } from "../types";
import type { BoxtrainerDb } from "./db";

const KEY = "main";

export class DexieSettingsRepository implements SettingsRepository {
  constructor(private readonly db: BoxtrainerDb) {}

  async load(): Promise<unknown | undefined> {
    const row = await this.db.settings.get(KEY);
    if (row === undefined) return undefined;
    const { id: _id, ...settings } = row;
    return settings;
  }

  async save(settings: unknown): Promise<void> {
    await this.db.settings.put({ ...(settings as object), id: KEY });
  }
}
