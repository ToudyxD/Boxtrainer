import { useState } from "react";

interface Props {
  title: string;
  summary: string;
  onSave: (rpe: number, note: string) => Promise<void>;
  onDiscard: () => void;
}

const RPE_HINTS: Record<number, string> = {
  1: "sehr leicht",
  3: "leicht",
  5: "mittel",
  7: "hart",
  9: "sehr hart",
  10: "Maximum",
};

export function SessionLogForm({ title, summary, onSave, onDiscard }: Props) {
  const [rpe, setRpe] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (): Promise<void> => {
    if (rpe === null) return;
    setSaving(true);
    setError("");
    try {
      await onSave(rpe, note);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <main className="log-screen">
      <h1>{title}</h1>
      <p>{summary}</p>

      <section>
        <h2>Wie anstrengend war es? (RPE)</h2>
        <div className="rpe" role="radiogroup" aria-label="Belastung">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={rpe === n}
              className={rpe === n ? "selected" : "ghost"}
              onClick={() => setRpe(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <p>{rpe !== null ? (RPE_HINTS[rpe] ?? " ") : " "}</p>
        <label>
          Notiz (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </label>
      </section>

      {error && <p className="error">Speichern fehlgeschlagen: {error}</p>}

      <div className="controls">
        <button className="huge" disabled={rpe === null || saving} onClick={() => void save()}>
          Speichern
        </button>
        <button className="big ghost" disabled={saving} onClick={onDiscard}>
          Verwerfen
        </button>
      </div>
    </main>
  );
}
