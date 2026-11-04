import { useMemo, useState } from "react";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { BLOCK_LABELS } from "../domain/cues";
import { GeneratorError, availableThemes, blockSeconds, generateTraining, trainingSeconds } from "../domain/generator";
import type { Level, Style, Training, TrainingType } from "../domain/models";
import { TRAINING_TEMPLATES } from "../domain/templates";
import { useStoredState } from "./useStoredState";

export interface StartRequest {
  training: Training;
  seed: number;
  style: Style;
  level: Level;
}

interface Config {
  type: TrainingType;
  equipmentId: string;
  minutes: number;
  style: Style;
  level: Level;
  focus: string;
}

const DEFAULT_CONFIG: Config = {
  type: "technique",
  equipmentId: "martial-arts-gym",
  minutes: 75,
  style: "kickboxing",
  level: 2,
  focus: "",
};

const LEVEL_LABELS: Record<Level, string> = { 1: "Grundlagen", 2: "Aufbau", 3: "Fortgeschritten" };
const STYLE_LABELS: Record<Style, string> = { boxing: "Boxen", kickboxing: "Kickboxen (K-1)" };
const fmtMin = (seconds: number): string => `${Math.round(seconds / 60)} min`;

export function ConfigScreen({ onStart }: { onStart: (req: StartRequest) => void }) {
  const library = useMemo(() => loadLibrary(), []);
  const [config, setConfig] = useStoredState<Config>("boxtrainer.config.v1", DEFAULT_CONFIG);
  const [seed, setSeed] = useState(() => Date.now() % 1_000_000);
  const [generated, setGenerated] = useState(false);

  const themes = availableThemes(library, config.style, config.level);
  const focus = themes.includes(config.focus) ? config.focus : "";
  const equipment = DEFAULT_EQUIPMENT_PROFILES.find((p) => p.id === config.equipmentId) ?? DEFAULT_EQUIPMENT_PROFILES[0]!;

  const result = useMemo(() => {
    try {
      const training = generateTraining(
        {
          type: config.type,
          equipment,
          targetMinutes: config.minutes,
          style: config.style,
          level: config.level,
          seed,
          history: [],
          ...(focus ? { focusTheme: focus } : {}),
        },
        library,
      );
      return { ok: true, training } as const;
    } catch (err) {
      if (err instanceof GeneratorError) return { ok: false, error: err.message } as const;
      throw err;
    }
  }, [config, equipment, focus, library, seed]);

  const update = (patch: Partial<Config>): void => {
    setConfig({ ...config, ...patch });
    setSeed(Date.now() % 1_000_000);
  };

  const exerciseName = (id: string): string => library.exercises.find((e) => e.id === id)?.name ?? id;

  return (
    <main>
      <h1>Training</h1>

      <section>
        <label>
          Typ
          <select value={config.type} onChange={(e) => update({ type: e.target.value as TrainingType })}>
            {Object.values(TRAINING_TEMPLATES).map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ort
          <select value={config.equipmentId} onChange={(e) => update({ equipmentId: e.target.value })}>
            {DEFAULT_EQUIPMENT_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dauer
          <select value={config.minutes} onChange={(e) => update({ minutes: Number(e.target.value) })}>
            {[45, 60, 75, 90].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        <label>
          Stil
          <select value={config.style} onChange={(e) => update({ style: e.target.value as Style })}>
            {Object.entries(STYLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Level
          <select value={config.level} onChange={(e) => update({ level: Number(e.target.value) as Level })}>
            {([1, 2, 3] as const).map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        {config.type === "technique" && (
          <label>
            Fokus-Thema
            <select value={focus} onChange={(e) => update({ focus: e.target.value })}>
              <option value="">Automatisch (am längsten nicht trainiert)</option>
              {themes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
        <button
          onClick={() => {
            setSeed(Date.now() % 1_000_000);
            setGenerated(true);
          }}
        >
          {generated ? "Neu würfeln" : "Training erstellen"}
        </button>
      </section>

      {generated && !result.ok && <p className="error">{result.error}</p>}

      {generated && result.ok && (
        <section>
          <h2>
            Vorschau · {fmtMin(trainingSeconds(result.training))}
            {result.training.focusTheme ? ` · ${result.training.focusTheme}` : ""}
          </h2>
          <ol className="blocks">
            {result.training.blocks.map((b) => (
              <li key={b.id}>
                <strong>{BLOCK_LABELS[b.type]}</strong>
                <span>
                  {b.rounds} × {b.roundSeconds >= 60 ? fmtMin(b.roundSeconds) : `${b.roundSeconds} s`}
                  {b.restSeconds > 0 ? `, ${b.restSeconds} s Pause` : ""} · {fmtMin(blockSeconds(b))}
                </span>
                {b.exerciseIds.length > 0 && <small>{b.exerciseIds.map(exerciseName).join(", ")}</small>}
                {b.comboIds.length > 0 && <small>{b.comboIds.length} Kombis im Pool</small>}
              </li>
            ))}
          </ol>
          <button onClick={() => onStart({ training: result.training, seed, style: config.style, level: config.level })}>
            Starten
          </button>
        </section>
      )}
    </main>
  );
}
