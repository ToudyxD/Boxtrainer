import type {
  Block,
  BlockType,
  BodyTarget,
  Combo,
  EquipmentProfile,
  EquipmentTag,
  Exercise,
  Level,
  Library,
  Style,
  Training,
} from "./models";
import { exerciseCovers } from "./bodyAreas";
import { blockSeconds, type Timed } from "./blockTime";
import { createRng, type Rng } from "./rng";
import { BLOCK_TEMPLATES, MIN_ROUNDS, TRAINING_TEMPLATES, maxRounds, type BlockTemplate, type TemplateTrainingType } from "./templates";

export class GeneratorError extends Error {}

export interface HistoryEntry {
  date: string;
  focusTheme?: string;
  comboIds: string[];
  exerciseIds: string[];
}

/** Was die Inhaltsauswahl braucht: Ort, Stil, Level und Verlauf. */
export interface ContentInput {
  equipment: EquipmentProfile;
  style: Style;
  level: Level;
  history: HistoryEntry[];
}

export interface GeneratorInput extends ContentInput {
  type: TemplateTrainingType;
  targetMinutes: number;
  focusTheme?: string;
  seed: number;
}

export interface SingleBlockInput extends ContentInput {
  blockType: BlockType;
  targetMinutes: number;
  focusTheme?: string;
  seed: number;
}

const RECENT_WINDOW = 3;
const RECENT_FACTOR = 0.2;
const FOCUS_FACTOR = 4;
const CHALLENGE_SHARE = 0.15;
const MIN_POOL = 4;
const MAX_POOL = 8;
const MAX_SCALE_STEPS = 200;

export { blockSeconds };

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

/** Wählt zuerst je Körperbereich eine Übung (bis zum Nutzerlevel), füllt dann auf und mischt die Reihenfolge. */
function selectCovering(
  pool: readonly Exercise[],
  groups: readonly BodyTarget[],
  n: number,
  userLevel: Level,
  weight: (e: Exercise) => number,
  rng: Rng,
): Exercise[] {
  const chosen: Exercise[] = [];
  for (const group of groups) {
    if (chosen.length >= n) break;
    if (chosen.some((e) => exerciseCovers(e, group))) continue;
    const candidates = pool.filter((e) => e.level <= userLevel && !chosen.includes(e) && exerciseCovers(e, group));
    chosen.push(...weightedSample(candidates, weight, 1, rng));
  }
  const rest = pool.filter((e) => !chosen.includes(e));
  const filler = selectWithChallenge(rest, userLevel, n - chosen.length, weight, rng);
  const all = [...chosen, ...filler];
  return weightedSample(all, () => 1, all.length, rng);
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

function resolveFocusTheme(
  input: ContentInput & { focusTheme?: string },
  autoPick: boolean,
  library: Library,
  rng: Rng,
): string | undefined {
  const themes = availableThemes(library, input.style, input.level);

  if (input.focusTheme !== undefined) {
    if (!themes.includes(input.focusTheme)) {
      throw new GeneratorError(`Fokus-Thema "${input.focusTheme}" ist für Stil ${input.style} und Level ${input.level} nicht verfügbar`);
    }
    return input.focusTheme;
  }
  if (!autoPick) return undefined;
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
  return { ...t, exercises: undefined, ...t.fallback, fallback: undefined };
}

/** Passt die Rundenzahlen skalierbarer Blöcke schrittweise an die Zieldauer an. */
function scaleRounds(templates: ReadonlyArray<Timed & { scale?: BlockTemplate["scale"] }>, targetSeconds: number): number[] {
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
  input: ContentInput;
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

  const picked = spec.cover
    ? selectCovering(pool, spec.cover, spec.count, ctx.input.level, weight, ctx.rng)
    : selectWithChallenge(pool, ctx.input.level, spec.count, weight, ctx.rng);
  if (picked.length === 0) {
    throw new GeneratorError(`Block "${t.key}": keine Übung für Equipment-Profil "${ctx.input.equipment.name}"`);
  }
  return picked.map((e) => e.id);
}

interface RoundEntry {
  id: string;
  seconds: number;
  rest: number | undefined;
}

/** Eine Übung mit eigener Länge ergibt eine Runde, eine Serie mehrere aufeinanderfolgende Runden. */
function roundEntries(id: string, library: Library): RoundEntry[] {
  const exercise = library.exercises.find((e) => e.id === id);
  if (!exercise) throw new GeneratorError(`Unbekannte Übung ${id}`);
  const f = exercise.format;
  if (f.kind === "time") return [{ id, seconds: f.seconds, rest: f.restSeconds }];
  if (f.kind === "series") return f.seconds.map((seconds) => ({ id, seconds, rest: f.restSeconds }));
  if (f.kind === "per-side") return [{ id, seconds: f.seconds * 2, rest: undefined }];
  throw new GeneratorError(`Übung ${id}: eigene Rundenlänge braucht ein Zeit-, Seiten- oder Serienformat`);
}

/** Zweiter Durchgang für Blöcke mit Rundenlänge je Übung: nach der Auswahl stehen die echten Längen fest. */
function refineRounds(blocks: Block[], templates: readonly BlockTemplate[], targetSeconds: number): Block[] {
  if (!blocks.some((b) => b.exerciseSeconds)) return blocks;
  const passesOf = (i: number): number | undefined => templates[i]?.exercises?.passes;
  const items = blocks.map((b, i) => ({
    ...b,
    ...(b.exerciseSeconds && !passesOf(i) && templates[i]?.scale ? { scale: templates[i]?.scale } : {}),
  }));
  const rounds = scaleRounds(items, targetSeconds);
  const result = blocks.map((b, i) => ({ ...b, rounds: rounds[i] as number }));

  // Blöcke mit Durchgängen (Aufwärmen, Cooldown) skalieren in ganzen Durchgängen.
  result.forEach((b, i) => {
    const scale = templates[i]?.scale;
    if (!b.exerciseSeconds || !passesOf(i) || !scale) return;
    const entries = b.exerciseIds.length;
    const others = result.reduce((sum, other, j) => (j === i ? sum : sum + blockSeconds(other)), 0);
    let best = { rounds: b.rounds, gap: Number.POSITIVE_INFINITY };
    for (let k = 1; entries * k <= scale.max; k++) {
      const gap = Math.abs(blockSeconds({ ...b, rounds: entries * k }) + others - targetSeconds);
      if (gap < best.gap) best = { rounds: entries * k, gap };
    }
    b.rounds = best.rounds;
  });
  return result;
}

function buildBlock(t: BlockTemplate, rounds: number, id: string, ctx: BuildContext): Block {
  const isCombat = t.type === "shadow" || t.type === "bag";
  const picked = pickExercises(t, ctx);
  const entries = t.exercises?.ownSeconds ? picked.flatMap((id) => roundEntries(id, ctx.library)) : undefined;
  const exerciseIds = entries ? entries.map((e) => e.id) : picked;
  const passes = t.exercises?.passes;
  return {
    id,
    type: t.type,
    rounds: entries && passes ? entries.length * passes : rounds,
    roundSeconds: t.roundSeconds,
    restSeconds: t.restSeconds,
    announceMode: t.announceMode,
    announceDensity: t.announceDensity,
    comboIds: isCombat ? pickCombos(t, rounds, ctx) : [],
    exerciseIds,
    ...(entries ? { exerciseSeconds: entries.map((e) => e.seconds) } : {}),
    ...(entries?.some((e) => e.rest !== undefined) ? { exerciseRest: entries.map((e) => e.rest ?? t.restSeconds) } : {}),
    ...(t.usesFocus && ctx.focus ? { focusTheme: ctx.focus } : {}),
  };
}

function validateMinutes(minutes: number): void {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new GeneratorError(`Ungültige Zieldauer: ${minutes}`);
}

function createContext(input: ContentInput, library: Library, rng: Rng, focus: string | undefined, extraRecent?: Block): BuildContext {
  return {
    input,
    library,
    rng,
    focus,
    available: new Set(input.equipment.tags),
    recentCombos: new Set([...recentIds(input.history, (h) => h.comboIds), ...(extraRecent?.comboIds ?? [])]),
    recentExercises: new Set([...recentIds(input.history, (h) => h.exerciseIds), ...(extraRecent?.exerciseIds ?? [])]),
  };
}

export function generateTraining(input: GeneratorInput, library: Library): Training {
  validateMinutes(input.targetMinutes);
  const template = TRAINING_TEMPLATES[input.type];
  if (!template) throw new GeneratorError(`Unbekannter Trainingstyp: ${String(input.type)}`);

  const available = new Set(input.equipment.tags);
  const templates = template.blocks.map((b) => resolveTemplate(b, available));
  const rng = createRng(input.seed);
  const focus = resolveFocusTheme(input, input.type === "technique", library, rng);
  const rounds = scaleRounds(templates, input.targetMinutes * 60);
  const ctx = createContext(input, library, rng, focus);

  const id = `t-${input.seed}`;
  return {
    id,
    type: input.type,
    equipmentProfileId: input.equipment.id,
    targetMinutes: input.targetMinutes,
    ...(focus ? { focusTheme: focus } : {}),
    blocks: refineRounds(
      templates.map((t, i) => buildBlock(t, rounds[i] as number, `${id}-b${i}`, ctx)),
      templates,
      input.targetMinutes * 60,
    ),
  };
}

export function trainingSeconds(training: Training): number {
  return training.blocks.reduce((sum, b) => sum + blockSeconds(b), 0);
}

/** Erzeugt ein Training aus genau einem Block der Vorlage BLOCK_TEMPLATES, skaliert auf die Zieldauer. */
export function generateSingleBlock(input: SingleBlockInput, library: Library): Training {
  validateMinutes(input.targetMinutes);
  const base = BLOCK_TEMPLATES[input.blockType];
  if (!base) throw new GeneratorError(`Unbekannter Blocktyp: ${String(input.blockType)}`);
  if (input.focusTheme !== undefined && !base.usesFocus) {
    throw new GeneratorError(`Block "${base.key}" nutzt kein Fokus-Thema`);
  }

  const template = resolveTemplate(base, new Set(input.equipment.tags));
  const rng = createRng(input.seed);
  const focus = resolveFocusTheme(input, base.usesFocus === true, library, rng);
  const [rounds] = scaleRounds([template], input.targetMinutes * 60);
  const ctx = createContext(input, library, rng, focus);

  const id = `t-${input.seed}`;
  return {
    id,
    type: "single",
    equipmentProfileId: input.equipment.id,
    targetMinutes: input.targetMinutes,
    ...(focus ? { focusTheme: focus } : {}),
    blocks: refineRounds([buildBlock(template, rounds as number, `${id}-b0`, ctx)], [template], input.targetMinutes * 60),
  };
}

function blockAt(training: Training, index: number): Block {
  const block = Number.isInteger(index) ? training.blocks[index] : undefined;
  if (!block) throw new GeneratorError(`Block ${index} existiert nicht (Training hat ${training.blocks.length} Blöcke)`);
  return block;
}

function checkEquipment(training: Training, input: ContentInput): void {
  if (input.equipment.id !== training.equipmentProfileId) {
    throw new GeneratorError(
      `Equipment-Profil "${input.equipment.id}" passt nicht zum Training ("${training.equipmentProfileId}")`,
    );
  }
}

function withBlock(training: Training, index: number, block: Block): Training {
  return { ...training, blocks: training.blocks.map((b, i) => (i === index ? block : b)) };
}

function nextBlockId(training: Training): string {
  const used = new Set(training.blocks.map((b) => b.id));
  for (let n = training.blocks.length; ; n++) {
    const id = `${training.id}-b${n}`;
    if (!used.has(id)) return id;
  }
}

/** Würfelt Kombis und Übungen eines Blocks neu; Zeiten, Runden, ID und alle anderen Blöcke bleiben. */
export function rerollBlock(training: Training, blockIndex: number, input: ContentInput, library: Library, seed: number): Training {
  const block = blockAt(training, blockIndex);
  checkEquipment(training, input);

  const template: BlockTemplate = { ...BLOCK_TEMPLATES[block.type], type: block.type, usesFocus: block.focusTheme !== undefined };
  const ctx = createContext(input, library, createRng(seed), block.focusTheme, block);
  const fresh = buildBlock(template, block.rounds, block.id, ctx);
  const { exerciseSeconds: _seconds, exerciseRest: _rest, ...kept } = block;
  return withBlock(training, blockIndex, {
    ...kept,
    comboIds: fresh.comboIds,
    exerciseIds: fresh.exerciseIds,
    ...(fresh.exerciseSeconds ? { exerciseSeconds: fresh.exerciseSeconds } : {}),
    ...(fresh.exerciseRest ? { exerciseRest: fresh.exerciseRest } : {}),
  });
}

/** Ersetzt einen Block durch einen neu erzeugten Block eines anderen Typs (inkl. Equipment-Ersatzregel). */
export function replaceBlock(
  training: Training,
  blockIndex: number,
  blockType: BlockType,
  input: ContentInput,
  library: Library,
  seed: number,
): Training {
  blockAt(training, blockIndex);
  checkEquipment(training, input);
  const base = BLOCK_TEMPLATES[blockType];
  if (!base) throw new GeneratorError(`Unbekannter Blocktyp: ${String(blockType)}`);

  const ctx = createContext(input, library, createRng(seed), base.usesFocus ? training.focusTheme : undefined);
  const block = buildBlock(resolveTemplate(base, ctx.available), base.rounds, nextBlockId(training), ctx);
  return withBlock(training, blockIndex, block);
}

export function removeBlock(training: Training, blockIndex: number): Training {
  blockAt(training, blockIndex);
  if (training.blocks.length <= 1) throw new GeneratorError("Ein Training braucht mindestens einen Block");
  return { ...training, blocks: training.blocks.filter((_, i) => i !== blockIndex) };
}

export function setRounds(training: Training, blockIndex: number, rounds: number): Training {
  const block = blockAt(training, blockIndex);
  const max = maxRounds(block.type);
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > max) {
    throw new GeneratorError(`Runden müssen eine ganze Zahl von ${MIN_ROUNDS} bis ${max} sein: ${rounds}`);
  }
  return withBlock(training, blockIndex, { ...block, rounds });
}

export function moveBlock(training: Training, from: number, to: number): Training {
  const block = blockAt(training, from);
  blockAt(training, to);
  const blocks = training.blocks.filter((_, i) => i !== from);
  blocks.splice(to, 0, block);
  return { ...training, blocks };
}
