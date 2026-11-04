import type {
  Block,
  Combo,
  EquipmentProfile,
  EquipmentTag,
  Exercise,
  Level,
  Library,
  Style,
  Training,
  TrainingType,
} from "./models";
import { createRng, type Rng } from "./rng";
import { TRAINING_TEMPLATES, type BlockTemplate } from "./templates";

export class GeneratorError extends Error {}

export interface HistoryEntry {
  date: string;
  focusTheme?: string;
  comboIds: string[];
  exerciseIds: string[];
}

export interface GeneratorInput {
  type: TrainingType;
  equipment: EquipmentProfile;
  targetMinutes: number;
  style: Style;
  level: Level;
  focusTheme?: string;
  seed: number;
  history: HistoryEntry[];
}

const RECENT_WINDOW = 3;
const RECENT_FACTOR = 0.2;
const FOCUS_FACTOR = 4;
const CHALLENGE_SHARE = 0.15;
const MIN_POOL = 4;
const MAX_POOL = 8;
const MAX_SCALE_STEPS = 200;

interface Timed {
  rounds: number;
  roundSeconds: number;
  restSeconds: number;
}

export function blockSeconds(b: Timed): number {
  return b.rounds * b.roundSeconds + Math.max(b.rounds - 1, 0) * b.restSeconds;
}

function weightedSample<T>(items: readonly T[], weight: (item: T) => number, n: number, rng: Rng): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    const weights = pool.map(weight);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng.next() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i] as number;
      if (r < 0) {
        idx = i;
        break;
      }
    }
    out.push(pool.splice(idx, 1)[0] as T);
  }
  return out;
}

/** Wählt n Elemente bis zum Nutzerlevel, plus einen kleinen Anteil aus der nächsthöheren Stufe als Herausforderung. */
function selectWithChallenge<T extends { level: Level }>(
  items: readonly T[],
  userLevel: Level,
  n: number,
  weight: (item: T) => number,
  rng: Rng,
): T[] {
  const main = items.filter((i) => i.level <= userLevel);
  const challenge = userLevel < 3 ? items.filter((i) => i.level === userLevel + 1) : [];
  const wantChallenge = Math.min(Math.round(n * CHALLENGE_SHARE), challenge.length);

  const picked = weightedSample(main, weight, n - wantChallenge, rng);
  const rest = n - picked.length;
  return [...picked, ...weightedSample(challenge, weight, rest, rng)];
}

function recentIds(history: readonly HistoryEntry[], pick: (h: HistoryEntry) => string[]): Set<string> {
  const newestFirst = [...history].sort((a, b) => b.date.localeCompare(a.date));
  return new Set(newestFirst.slice(0, RECENT_WINDOW).flatMap(pick));
}

function eligibleCombos(library: Library, style: Style, level: Level): Combo[] {
  return library.combos.filter((c) => c.styles.includes(style) && c.level <= level + 1);
}

export function availableThemes(library: Library, style: Style, level: Level): string[] {
  return [
    ...new Set(
      eligibleCombos(library, style, level)
        .filter((c) => c.level <= level)
        .flatMap((c) => c.themes),
    ),
  ];
}

function resolveFocusTheme(input: GeneratorInput, library: Library, rng: Rng): string | undefined {
  const themes = availableThemes(library, input.style, input.level);

  if (input.focusTheme !== undefined) {
    if (!themes.includes(input.focusTheme)) {
      throw new GeneratorError(`Fokus-Thema "${input.focusTheme}" ist für Stil ${input.style} und Level ${input.level} nicht verfügbar`);
    }
    return input.focusTheme;
  }
  if (input.type !== "technique") return undefined;
  if (themes.length === 0) throw new GeneratorError("Keine Fokus-Themen verfügbar");

  const newestFirst = [...input.history].sort((a, b) => b.date.localeCompare(a.date));
  const age = (theme: string): number => {
    const idx = newestFirst.findIndex((h) => h.focusTheme === theme);
    return idx === -1 ? Number.POSITIVE_INFINITY : idx;
  };
  const oldest = Math.max(...themes.map(age));
  return rng.pick(themes.filter((t) => age(t) === oldest));
}

function resolveTemplate(t: BlockTemplate, available: ReadonlySet<EquipmentTag>): BlockTemplate {
  const missing = (t.requires ?? []).filter((tag) => !available.has(tag));
  if (missing.length === 0) return t;
  if (!t.fallback) {
    throw new GeneratorError(`Block "${t.key}": Equipment fehlt (${missing.join(", ")}) und es gibt keine Ersatzregel`);
  }
  return { ...t, ...t.fallback, fallback: undefined };
}

/** Passt die Rundenzahlen skalierbarer Blöcke schrittweise an die Zieldauer an. */
function scaleRounds(templates: readonly BlockTemplate[], targetSeconds: number): number[] {
  const rounds = templates.map((t) => t.rounds);
  const total = (): number => templates.reduce((sum, t, i) => sum + blockSeconds({ ...t, rounds: rounds[i] as number }), 0);

  for (let guard = 0; guard < MAX_SCALE_STEPS; guard++) {
    const current = total();
    const currentGap = Math.abs(current - targetSeconds);
    let best: { index: number; delta: number; gap: number } | undefined;

    templates.forEach((t, index) => {
      if (!t.scale) return;
      const step = t.scale.step ?? 1;
      for (const delta of [-step, step]) {
        const next = (rounds[index] as number) + delta;
        if (next < t.scale.min || next > t.scale.max) continue;
        const gap = Math.abs(current - blockSeconds({ ...t, rounds: rounds[index] as number }) + blockSeconds({ ...t, rounds: next }) - targetSeconds);
        if (gap < currentGap && (!best || gap < best.gap)) best = { index, delta, gap };
      }
    });

    if (!best) break;
    rounds[best.index] = (rounds[best.index] as number) + best.delta;
  }
  return rounds;
}

interface BuildContext {
  input: GeneratorInput;
  library: Library;
  rng: Rng;
  focus: string | undefined;
  available: ReadonlySet<EquipmentTag>;
  recentCombos: ReadonlySet<string>;
  recentExercises: ReadonlySet<string>;
}

function pickCombos(t: BlockTemplate, rounds: number, ctx: BuildContext): string[] {
  const size = Math.min(MAX_POOL, Math.max(MIN_POOL, rounds + 1));
  const weight = (c: Combo): number =>
    (ctx.recentCombos.has(c.id) ? RECENT_FACTOR : 1) * (t.usesFocus && ctx.focus && c.themes.includes(ctx.focus) ? FOCUS_FACTOR : 1);

  const picked = selectWithChallenge(eligibleCombos(ctx.library, ctx.input.style, ctx.input.level), ctx.input.level, size, weight, ctx.rng);
  if (picked.length === 0) throw new GeneratorError(`Block "${t.key}": keine passenden Kombis`);
  return picked.map((c) => c.id);
}

function pickExercises(t: BlockTemplate, ctx: BuildContext): string[] {
  const spec = t.exercises;
  if (!spec) return [];

  const pool = ctx.library.exercises.filter(
    (e: Exercise) =>
      spec.categories.includes(e.category) &&
      e.styles.includes(ctx.input.style) &&
      e.equipment.every((tag) => ctx.available.has(tag)) &&
      e.intensity <= (spec.maxIntensity ?? 3) &&
      (spec.phase === undefined || (e.phases ?? []).includes(spec.phase)),
  );
  const weight = (e: Exercise): number =>
    (ctx.recentExercises.has(e.id) ? RECENT_FACTOR : 1) * (t.usesFocus && ctx.focus && e.themes?.includes(ctx.focus) ? FOCUS_FACTOR * 2 : 1);

  const picked = selectWithChallenge(pool, ctx.input.level, spec.count, weight, ctx.rng);
  if (picked.length === 0) {
    throw new GeneratorError(`Block "${t.key}": keine Übung für Equipment-Profil "${ctx.input.equipment.name}"`);
  }
  return picked.map((e) => e.id);
}

function buildBlock(t: BlockTemplate, rounds: number, id: string, ctx: BuildContext): Block {
  const isCombat = t.type === "shadow" || t.type === "bag";
  return {
    id,
    type: t.type,
    rounds,
    roundSeconds: t.roundSeconds,
    restSeconds: t.restSeconds,
    announceMode: t.announceMode,
    announceDensity: t.announceDensity,
    comboIds: isCombat ? pickCombos(t, rounds, ctx) : [],
    exerciseIds: pickExercises(t, ctx),
    ...(t.usesFocus && ctx.focus ? { focusTheme: ctx.focus } : {}),
  };
}

export function generateTraining(input: GeneratorInput, library: Library): Training {
  if (!Number.isFinite(input.targetMinutes) || input.targetMinutes <= 0) {
    throw new GeneratorError(`Ungültige Zieldauer: ${input.targetMinutes}`);
  }

  const available = new Set(input.equipment.tags);
  const templates = TRAINING_TEMPLATES[input.type].blocks.map((b) => resolveTemplate(b, available));
  const rng = createRng(input.seed);
  const focus = resolveFocusTheme(input, library, rng);
  const rounds = scaleRounds(templates, input.targetMinutes * 60);

  const ctx: BuildContext = {
    input,
    library,
    rng,
    focus,
    available,
    recentCombos: recentIds(input.history, (h) => h.comboIds),
    recentExercises: recentIds(input.history, (h) => h.exerciseIds),
  };

  const id = `t-${input.seed}`;
  return {
    id,
    type: input.type,
    equipmentProfileId: input.equipment.id,
    targetMinutes: input.targetMinutes,
    ...(focus ? { focusTheme: focus } : {}),
    blocks: templates.map((t, i) => buildBlock(t, rounds[i] as number, `${id}-b${i}`, ctx)),
  };
}

export function trainingSeconds(training: Training): number {
  return training.blocks.reduce((sum, b) => sum + blockSeconds(b), 0);
}
