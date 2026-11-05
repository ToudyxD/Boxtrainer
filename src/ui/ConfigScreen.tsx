import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { BLOCK_LABELS } from "../domain/cues";
import {
  GeneratorError,
  availableThemes,
  blockSeconds,
  generateSingleBlock,
  generateTraining,
  moveBlock,
  removeBlock,
  replaceBlock,
  rerollBlock,
  setRounds,
  trainingSeconds,
  type ContentInput,
  type HistoryEntry,
} from "../domain/generator";
import type { Block, BlockType, Level, Style, Training } from "../domain/models";
import {
  BLOCK_TEMPLATES,
  MIN_ROUNDS,
  TRAINING_TEMPLATES,
  maxRounds,
  trainingLabel,
  type TemplateTrainingType,
} from "../domain/templates";
import { getSessionService } from "../services/appServices";
import { blockCategory } from "./blockStyle";
import { useStoredState } from "./useStoredState";

export interface StartRequest {
  training: Training;
  seed: number;
  style: Style;
  level: Level;
  pauseScale: number;
}

type Pace = "short" | "normal" | "long";
type Mode = "full" | "single";

const PACES: Record<Pace, { label: string; scale: number }> = {
  short: { label: "Kurz (dichte Ansagen)", scale: 0.5 },
  normal: { label: "Normal", scale: 1 },
  long: { label: "Lang (viel Zeit pro Kombi)", scale: 1.6 },
};

interface Config {
  mode: Mode;
  type: TemplateTrainingType;
  blockType: BlockType;
  equipmentId: string;
  minutes: number;
  singleMinutes: number;
  style: Style;
  level: Level;
  focus: string;
  pace: Pace;
}

const DEFAULT_CONFIG: Config = {
  mode: "full",
  type: "technique",
  blockType: "shadow",
  equipmentId: "martial-arts-gym",
  minutes: 75,
  singleMinutes: 20,
  style: "kickboxing",
  level: 2,
  focus: "",
  pace: "normal",
};

const FULL_MINUTES = [45, 60, 75, 90];
const SINGLE_MINUTES = [10, 15, 20, 30];
const BLOCK_TYPES = Object.keys(BLOCK_TEMPLATES) as BlockType[];

const LEVEL_LABELS: Record<Level, string> = { 1: "Grundlagen", 2: "Aufbau", 3: "Fortgeschritten" };
const STYLE_LABELS: Record<Style, string> = { boxing: "Boxen", kickboxing: "Kickboxen (K-1)" };
const newSeed = (): number => Date.now() % 1_000_000;

type Generated = { ok: true; training: Training; seed: number } | { ok: false; error: string };

function asGeneratorError(err: unknown): string {
  if (err instanceof GeneratorError) return err.message;
  throw err;
}

export function ConfigScreen({ onStart }: { onStart: (req: StartRequest) => void }) {
  const library = useMemo(() => loadLibrary(), []);
  const [config, setConfig] = useStoredState<Config>("boxtrainer.config.v1", DEFAULT_CONFIG);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [editError, setEditError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    getSessionService()
      .history()
      .then(setHistory)
      .catch((err: unknown) => {
        setHistory([]);
        setHistoryError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const themes = availableThemes(library, config.style, config.level);
  const focusFor = (cfg: Config): string =>
    availableThemes(library, cfg.style, cfg.level).includes(cfg.focus) ? cfg.focus : "";
  const equipmentFor = (cfg: Config) =>
    DEFAULT_EQUIPMENT_PROFILES.find((p) => p.id === cfg.equipmentId) ?? DEFAULT_EQUIPMENT_PROFILES[0]!;
  const contentInput = (cfg: Config): ContentInput => ({
    equipment: equipmentFor(cfg),
    style: cfg.style,
    level: cfg.level,
    history: history ?? [],
  });
  const showFocus = config.mode === "full" ? config.type === "technique" : BLOCK_TEMPLATES[config.blockType].usesFocus === true;

  const generate = (cfg: Config): void => {
    const seed = newSeed();
    const focus = focusFor(cfg);
    setEditError("");
    setExpanded(null);
    setSwapping(null);
    setConfirmRemove(null);
    try {
      const training =
        cfg.mode === "single"
          ? generateSingleBlock(
              {
                ...contentInput(cfg),
                blockType: cfg.blockType,
                targetMinutes: cfg.singleMinutes,
                seed,
                ...(focus && BLOCK_TEMPLATES[cfg.blockType].usesFocus ? { focusTheme: focus } : {}),
              },
              library,
            )
          : generateTraining(
              { ...contentInput(cfg), type: cfg.type, targetMinutes: cfg.minutes, seed, ...(focus ? { focusTheme: focus } : {}) },
              library,
            );
      setGenerated({ ok: true, training, seed });
    } catch (err) {
      setGenerated({ ok: false, error: asGeneratorError(err) });
    }
  };

  const update = (patch: Partial<Config>): void => {
    const next = { ...config, ...patch };
    setConfig(next);
    if (generated) generate(next);
  };

  const edit = (change: (t: Training) => Training): void => {
    if (!generated?.ok) return;
    try {
      setGenerated({ ...generated, training: change(generated.training) });
      setEditError("");
    } catch (err) {
      setEditError(asGeneratorError(err));
    }
    setSwapping(null);
    setConfirmRemove(null);
  };

  const exerciseName = (id: string): string => library.exercises.find((e) => e.id === id)?.name ?? id;
  const training = generated?.ok ? generated.training : null;

  const renderBlock = (b: Block, i: number, blocks: Block[]) => {
    const open = expanded === b.id;
    const ownLengths = b.exerciseSeconds !== undefined;
    const roundLength = b.roundSeconds >= 60 ? `${Math.round(b.roundSeconds / 60)} min` : `${b.roundSeconds} s`;
    return (
      <li key={b.id} className={`block ${blockCategory(b.type)}`}>
        <div className="block-head">
          <span className="block-name">{BLOCK_LABELS[b.type]}</span>
          <span className="block-meta">
            {ownLengths ? `${b.rounds} Runden` : `${b.rounds} × ${roundLength}`}
            {b.restSeconds > 0 ? `, ${b.restSeconds} s Pause` : ""}
          </span>
          <span className="dur">
            {Math.round(blockSeconds(b) / 60)}
            <small>min</small>
          </span>
        </div>
        {b.exerciseIds.length > 0 && (
          <span className="block-detail">
            {b.exerciseIds.map((id, n) => (b.exerciseSeconds ? `${exerciseName(id)} (${b.exerciseSeconds[n]} s)` : exerciseName(id))).join(", ")}
          </span>
        )}
        {b.comboIds.length > 0 && <span className="block-detail">{b.comboIds.length} Kombis im Pool</span>}

        <div className="block-foot">
          <div className="stepper" role="group" aria-label={`Runden ${BLOCK_LABELS[b.type]}`}>
            <button aria-label="Eine Runde weniger" disabled={b.rounds <= MIN_ROUNDS} onClick={() => edit((t) => setRounds(t, i, b.rounds - 1))}>
              −
            </button>
            <span>{b.rounds} Runden</span>
            <button aria-label="Eine Runde mehr" disabled={b.rounds >= maxRounds(b.type)} onClick={() => edit((t) => setRounds(t, i, b.rounds + 1))}>
              +
            </button>
          </div>
          <button className="ghost" aria-expanded={open} onClick={() => setExpanded(open ? null : b.id)}>
            {open ? "Weniger" : "Bearbeiten"}
          </button>
        </div>

        {open && (
          <div className="block-actions">
            <button className="ghost" onClick={() => edit((t) => rerollBlock(t, i, contentInput(config), library, newSeed()))}>
              Neu würfeln
            </button>
            <button className="ghost" aria-expanded={swapping === b.id} onClick={() => setSwapping(swapping === b.id ? null : b.id)}>
              Tauschen
            </button>
            {blocks.length > 1 && (
              <>
                <button className="ghost" disabled={i === 0} onClick={() => edit((t) => moveBlock(t, i, i - 1))}>
                  Hoch
                </button>
                <button className="ghost" disabled={i === blocks.length - 1} onClick={() => edit((t) => moveBlock(t, i, i + 1))}>
                  Runter
                </button>
              </>
            )}

            {swapping === b.id && (
              <label>
                Tauschen gegen
                <select
                  value=""
                  onChange={(e) => {
                    const type = e.target.value as BlockType;
                    edit((t) => replaceBlock(t, i, type, contentInput(config), library, newSeed()));
                  }}
                >
                  <option value="" disabled>
                    Blocktyp wählen …
                  </option>
                  {BLOCK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {BLOCK_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {blocks.length > 1 &&
              (confirmRemove === b.id ? (
                <>
                  <button className="danger" onClick={() => edit((t) => removeBlock(t, i))}>
                    Block entfernen
                  </button>
                  <button className="ghost" onClick={() => setConfirmRemove(null)}>
                    Abbrechen
                  </button>
                </>
              ) : (
                <button className="ghost wide" onClick={() => setConfirmRemove(b.id)}>
                  Entfernen
                </button>
              ))}
          </div>
        )}
      </li>
    );
  };

  return (
    <main>
      <header className="screen-head">
        <h1>Training</h1>
      </header>

      <div className="segmented" role="group" aria-label="Umfang">
        <button aria-pressed={config.mode === "full"} onClick={() => update({ mode: "full" })}>
          Komplettes Training
        </button>
        <button aria-pressed={config.mode === "single"} onClick={() => update({ mode: "single" })}>
          Einzelner Block
        </button>
      </div>

      <div className="list">
        {config.mode === "full" ? (
          <Field label="Typ">
            <select value={config.type} onChange={(e) => update({ type: e.target.value as TemplateTrainingType })}>
              {Object.values(TRAINING_TEMPLATES).map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Block">
            <select value={config.blockType} onChange={(e) => update({ blockType: e.target.value as BlockType })}>
              {BLOCK_TYPES.map((type) => (
                <option key={type} value={type}>
                  {BLOCK_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Ort">
          <select value={config.equipmentId} onChange={(e) => update({ equipmentId: e.target.value })}>
            {DEFAULT_EQUIPMENT_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dauer">
          {config.mode === "full" ? (
            <select value={config.minutes} onChange={(e) => update({ minutes: Number(e.target.value) })}>
              {FULL_MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          ) : (
            <select value={config.singleMinutes} onChange={(e) => update({ singleMinutes: Number(e.target.value) })}>
              {SINGLE_MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Stil">
          <select value={config.style} onChange={(e) => update({ style: e.target.value as Style })}>
            {Object.entries(STYLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Level">
          <select value={config.level} onChange={(e) => update({ level: Number(e.target.value) as Level })}>
            {([1, 2, 3] as const).map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </Field>
        {showFocus && (
          <Field label="Fokus">
            <select value={focusFor(config)} onChange={(e) => update({ focus: e.target.value })}>
              <option value="">Automatisch</option>
              {themes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Ansage-Pausen">
          <select value={config.pace} onChange={(e) => setConfig({ ...config, pace: e.target.value as Pace })}>
            {Object.entries(PACES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="cta-row">
        <button className={generated ? "ghost big" : "huge"} disabled={history === null} onClick={() => generate(config)}>
          {generated ? "Alles neu würfeln" : config.mode === "single" ? "Block erstellen" : "Training erstellen"}
        </button>
      </div>

      {historyError && <p className="warn">Verlauf nicht verfügbar, Abwechslung eingeschränkt: {historyError}</p>}

      {generated && !generated.ok && <p className="error">{generated.error}</p>}

      {generated?.ok && training && (
        <>
          <div className="preview-head">
            <div>
              <h2>{trainingLabel(training)}</h2>
              {training.focusTheme && <p>Fokus: {training.focusTheme}</p>}
            </div>
            <div className="total" aria-label={`Gesamtdauer ${Math.round(trainingSeconds(training) / 60)} Minuten`}>
              {Math.round(trainingSeconds(training) / 60)}
              <small>min</small>
            </div>
          </div>
          {editError && <p className="error">{editError}</p>}
          <ol className="blocks">{training.blocks.map(renderBlock)}</ol>
          <div className="startbar">
            <button
              className="huge"
              onClick={() =>
                onStart({
                  training,
                  seed: generated.seed,
                  style: config.style,
                  level: config.level,
                  pauseScale: PACES[config.pace]?.scale ?? 1,
                })
              }
            >
              Starten
            </button>
          </div>
        </>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
