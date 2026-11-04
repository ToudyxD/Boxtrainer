import { useCallback, useEffect, useRef, useState } from "react";
import { BLOCK_LABELS } from "../domain/cues";
import type { Session } from "../domain/models";
import { trainingLabel } from "../domain/templates";
import { getSessionService } from "../services/appServices";
import { saveTextFile } from "./saveFile";

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const fmtMin = (seconds: number): string => `${Math.round(seconds / 60)} min`;

export function HistoryScreen() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await getSessionService().list());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<string | void>): Promise<void> => {
    setMessage("");
    try {
      const result = await action();
      if (result) setMessage(result);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const exportData = (): Promise<void> =>
    run(async () => {
      const json = await getSessionService().exportBackup();
      await saveTextFile(`boxtrainer-${new Date().toISOString().slice(0, 10)}.json`, json);
    });

  const importData = (file: File): Promise<void> =>
    run(async () => {
      const { added, skipped } = await getSessionService().importBackup(await file.text());
      return `${added} Einheiten importiert, ${skipped} bereits vorhanden.`;
    });

  return (
    <main>
      <h1>Verlauf</h1>

      {error && <p className="error">{error}</p>}
      {message && <p>{message}</p>}
      {sessions?.length === 0 && <p>Noch keine Einheit gespeichert.</p>}

      <ul className="history">
        {sessions?.map((s) => {
          const done = new Set(s.completedBlockIds);
          const expanded = open === s.id;
          return (
            <li key={s.id}>
              <button className="row-button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.id)}>
                <span>
                  <strong>{trainingLabel(s.training)}</strong>
                  {s.training.focusTheme ? ` · ${s.training.focusTheme}` : ""}
                </span>
                <span>
                  {fmtDate(s.date)} · {fmtMin(s.actualSeconds)} · RPE {s.rpe}
                </span>
              </button>
              {expanded && (
                <div className="details">
                  {s.note && <p>{s.note}</p>}
                  <ul>
                    {s.training.blocks.map((b) => (
                      <li key={b.id} className={done.has(b.id) ? "" : "skipped"}>
                        {done.has(b.id) ? "✓" : "–"} {BLOCK_LABELS[b.type]}
                      </li>
                    ))}
                  </ul>
                  {confirmDelete === s.id ? (
                    <button
                      className="danger"
                      onClick={() => {
                        setConfirmDelete(null);
                        setOpen(null);
                        void run(() => getSessionService().remove(s.id));
                      }}
                    >
                      Wirklich löschen
                    </button>
                  ) : (
                    <button className="ghost" onClick={() => setConfirmDelete(s.id)}>
                      Löschen
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <section>
        <h2>Datensicherung</h2>
        <p>Der Browser kann gespeicherte Daten löschen. Exportiere den Verlauf regelmäßig.</p>
        <div className="row">
          <button onClick={() => void exportData()}>Exportieren</button>
          <button className="ghost" onClick={() => fileInput.current?.click()}>
            Importieren
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importData(file);
          }}
        />
      </section>
    </main>
  );
}
