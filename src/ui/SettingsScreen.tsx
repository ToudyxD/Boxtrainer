import { useState } from "react";
import { DEFAULT_EQUIPMENT_PROFILES } from "../content";
import type { EquipmentProfile, EquipmentTag, Level, Style } from "../domain/models";
import {
  EQUIPMENT_LABELS,
  EQUIPMENT_TAGS,
  MAX_PROFILES,
  NAME_MAX_LENGTH,
  SettingsError,
  addProfile,
  removeProfile,
  resetProfile,
  setPreferences,
  updateProfile,
  type Settings,
} from "../domain/settings";
import { LEVEL_LABELS, STYLE_LABELS } from "./labels";
import { useSettings } from "./SettingsContext";

interface Draft {
  /** ID des bearbeiteten Orts, "new" für einen neuen. */
  id: string;
  name: string;
  tags: EquipmentTag[];
}

const isDefault = (id: string): boolean => DEFAULT_EQUIPMENT_PROFILES.some((p) => p.id === id);
const newId = (): string => `custom-${Date.now().toString(36)}`;

function summary(p: EquipmentProfile): string {
  return p.tags.length === 0 ? "Kein Equipment" : p.tags.map((t) => EQUIPMENT_LABELS[t]).join(", ");
}

export function SettingsScreen() {
  const { settings, loadError, save } = useSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState("");

  const apply = async (change: (s: Settings) => Settings): Promise<boolean> => {
    setError("");
    try {
      await save(change(settings));
      return true;
    } catch (err) {
      if (err instanceof SettingsError) {
        setError(err.message);
        return false;
      }
      throw err;
    }
  };

  const startEdit = (p: EquipmentProfile): void => {
    setError("");
    setConfirmDelete(null);
    setDraft({ id: p.id, name: p.name, tags: [...p.tags] });
  };

  const startNew = (): void => {
    setError("");
    setConfirmDelete(null);
    setDraft({ id: "new", name: "", tags: [] });
  };

  const commit = async (): Promise<void> => {
    if (!draft) return;
    const ok = await apply((s) =>
      draft.id === "new"
        ? addProfile(s, { name: draft.name, tags: draft.tags }, newId())
        : updateProfile(s, draft.id, { name: draft.name, tags: draft.tags }),
    );
    if (ok) setDraft(null);
  };

  const toggleTag = (tag: EquipmentTag): void => {
    if (!draft) return;
    const tags = draft.tags.includes(tag) ? draft.tags.filter((t) => t !== tag) : [...draft.tags, tag];
    setDraft({ ...draft, tags });
  };

  const renderEditor = (d: Draft, existing: EquipmentProfile | undefined) => (
    <div className="editor">
      <label>
        Name
        <input
          type="text"
          value={d.name}
          maxLength={NAME_MAX_LENGTH}
          autoFocus
          onChange={(e) => setDraft({ ...d, name: e.target.value })}
        />
      </label>
      <fieldset>
        <legend>Equipment</legend>
        <div className="checks">
          {EQUIPMENT_TAGS.map((tag) => (
            <label key={tag} className="check">
              <input type="checkbox" checked={d.tags.includes(tag)} onChange={() => toggleTag(tag)} />
              <span>{EQUIPMENT_LABELS[tag]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {!d.tags.includes("heavy-bag") && (
        <p className="hint">Ohne Sandsack ersetzt die App Sackarbeit und Power durch Schattenboxen.</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="editor-actions">
        <button onClick={() => void commit()}>Speichern</button>
        <button className="ghost" onClick={() => setDraft(null)}>
          Abbrechen
        </button>
      </div>
      {existing && (
        <div className="editor-actions">
          {isDefault(existing.id) && (
            <button
              className="ghost"
              onClick={() => void apply((s) => resetProfile(s, existing.id, DEFAULT_EQUIPMENT_PROFILES)).then((ok) => ok && setDraft(null))}
            >
              Vorbelegung wiederherstellen
            </button>
          )}
          {settings.equipmentProfiles.length > 1 &&
            (confirmDelete === existing.id ? (
              <button
                className="danger"
                onClick={() => void apply((s) => removeProfile(s, existing.id)).then((ok) => ok && (setDraft(null), setConfirmDelete(null)))}
              >
                Ort löschen
              </button>
            ) : (
              <button className="ghost" onClick={() => setConfirmDelete(existing.id)}>
                Löschen
              </button>
            ))}
        </div>
      )}
    </div>
  );

  return (
    <main>
      <header className="screen-head">
        <h1>Einstellungen</h1>
      </header>

      {loadError && (
        <p className="warn">Gespeicherte Einstellungen konnten nicht gelesen werden, die Vorbelegung gilt: {loadError}</p>
      )}

      <h2 className="group-title">Profil</h2>
      <div className="list">
        <label className="field">
          <span>Stil</span>
          <select
            value={settings.style}
            onChange={(e) => void apply((s) => setPreferences(s, { style: e.target.value as Style }))}
          >
            {Object.entries(STYLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Level</span>
          <select
            value={settings.level}
            onChange={(e) => void apply((s) => setPreferences(s, { level: Number(e.target.value) as Level }))}
          >
            {([1, 2, 3] as const).map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint">Stil und Level bestimmen, welche Kombis und Übungen in deinen Trainings vorkommen.</p>
      {!draft && error && <p className="error">{error}</p>}

      <h2 className="group-title">Orte und Equipment</h2>
      <ul className="places">
        {settings.equipmentProfiles.map((p) => (
          <li key={p.id}>
            {draft?.id === p.id ? (
              renderEditor(draft, p)
            ) : (
              <div className="place-row">
                <span className="place-text">
                  <strong>{p.name}</strong>
                  <small>{summary(p)}</small>
                </span>
                <button className="ghost" onClick={() => startEdit(p)}>
                  Bearbeiten
                </button>
              </div>
            )}
          </li>
        ))}
        {draft?.id === "new" && <li>{renderEditor(draft, undefined)}</li>}
      </ul>
      {!draft && settings.equipmentProfiles.length < MAX_PROFILES && (
        <button className="ghost big" onClick={startNew}>
          Neuen Ort anlegen
        </button>
      )}
    </main>
  );
}
