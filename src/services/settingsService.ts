import type { EquipmentProfile } from "../domain/models";
import { defaultSettings, validateSettings, type Settings } from "../domain/settings";
import type { SettingsRepository } from "../repositories/types";

export interface LoadedSettings {
  settings: Settings;
  /** Es war noch nichts gespeichert; die Vorbelegung gilt. */
  fromDefaults: boolean;
}

export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly defaults: readonly EquipmentProfile[],
  ) {}

  defaultSettings(): Settings {
    return defaultSettings(this.defaults);
  }

  /** Wirft SettingsError, wenn die gespeicherten Daten ungültig sind. */
  async load(): Promise<LoadedSettings> {
    const stored = await this.repo.load();
    if (stored === undefined) return { settings: this.defaultSettings(), fromDefaults: true };
    return { settings: validateSettings(stored), fromDefaults: false };
  }

  /** Prüft vor dem Speichern und liefert die normalisierten Einstellungen. */
  async save(settings: Settings): Promise<Settings> {
    const valid = validateSettings(settings);
    await this.repo.save(valid);
    return valid;
  }
}
