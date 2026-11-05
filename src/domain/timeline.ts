import type { Block, BlockType, Combo, Exercise, Level, Library, Style, Training } from "./models";
import { roundSecondsAt } from "./blockTime";
import { createRng, type Rng } from "./rng";

export const COUNTDOWN_SECONDS = 10;
export const BLOCK_INTRO_LEAD = 3;
export const TRANSITION_SECONDS = BLOCK_INTRO_LEAD + COUNTDOWN_SECONDS;
export const PUSH_BEFORE_END = 30;
export const CLAPPER_BEFORE_END = 10;
export const ANNOUNCE_BUFFER = 0.5;
export const TAIL_GUARD = 2;
const PUSH_SECONDS = 3;
const CLAPPER_SECONDS = 1.5;
const INTRO_THEME_SECONDS = 3;
const INTRO_EXERCISE_SECONDS = 5;
const FIRST_GAP = 1.5;
const FREESTYLE_SECONDS = 10;
const DEFENSE_SECONDS = 0.8;
const FREESTYLE_CHANCE = 0.04;
const DEFENSE_CHANCE = 0.12;
const PAUSE_BASE: Record<1 | 2 | 3, number> = { 1: 6, 2: 3.5, 3: 1.8 };

const COMBAT: ReadonlySet<BlockType> = new Set(["shadow", "bag", "power"]);
const DRIVEN: ReadonlySet<BlockType> = new Set(["shadow", "bag", "power", "conditioning", "circuit"]);

interface Base {
  at: number;
  blockId: string;
  roundIndex: number;
}

export type TimelineEvent =
  | (Base & { kind: "block-intro" })
  | (Base & { kind: "countdown" })
  | (Base & { kind: "start-signal"; signal: "gong" | "beep" })
  | (Base & { kind: "intro"; theme?: string; exerciseId?: string; cue?: string })
  | (Base & { kind: "combo"; comboId: string; durationSec: number })
  | (Base & { kind: "defense"; techniqueId: string; durationSec: number })
  | (Base & { kind: "freestyle"; durationSec: number })
  | (Base & { kind: "push" })
  | (Base & { kind: "clapper" })
  | (Base & { kind: "end-signal"; signal: "gong" })
  | (Base & { kind: "next-up"; exerciseId?: string; cue?: string })
  | (Base & { kind: "ready" })
  | { kind: "finish"; at: number };

export interface Segment {
  kind: "transition" | "work" | "rest";
  blockId: string;
  blockIndex: number;
  roundIndex: number;
  start: number;
  end: number;
  exerciseId?: string;
}

export interface Timeline {
  events: TimelineEvent[];
  segments: Segment[];
  totalSeconds: number;
}

export interface TimelineOptions {
  seed: number;
  style: Style;
  level: Level;
  comboSeconds?: (combo: Combo) => number;
  /** Faktor auf die Pause zwischen Ansagen (kleiner = dichter). Standard 1. */
  pauseScale?: number;
}

export function estimateComboSeconds(combo: Combo): number {
  return 0.4 + 0.55 * combo.techniqueIds.length;
}

interface Ctx {
  rng: Rng;
  combos: Map<string, Combo>;
  exercises: Map<string, Exercise>;
  defenseIds: string[];
  comboSeconds: (combo: Combo) => number;
  pauseScale: number;
}

interface ComboBag {
  queue: string[];
  last?: string;
}

function nextCombo(bag: ComboBag, block: Block, rng: Rng): string {
  if (bag.queue.length === 0) {
    bag.queue = rng.shuffle(block.comboIds);
    if (bag.queue.length > 1 && bag.queue[bag.queue.length - 1] === bag.last) {
      bag.queue.unshift(bag.queue.pop() as string);
    }
  }
  const id = bag.queue.pop();
  if (id === undefined) throw new Error(`Block ${block.id} hat keine Kombis`);
  return id;
}

function exerciseFor(block: Block, roundIndex: number, ctx: Ctx): { exerciseId?: string; cue?: string } {
  if (block.exerciseIds.length === 0) return {};
  const exerciseId = block.exerciseIds[roundIndex % block.exerciseIds.length] as string;
  const exercise = ctx.exercises.get(exerciseId);
  if (!exercise) throw new Error(`Unbekannte Übung ${exerciseId}`);
  const cue = exercise.cues.length > 0 ? ctx.rng.pick(exercise.cues) : undefined;
  return { exerciseId, ...(cue ? { cue } : {}) };
}

function workEvents(block: Block, roundIndex: number, start: number, bag: ComboBag, ctx: Ctx): TimelineEvent[] {
  const L = roundSecondsAt(block, roundIndex);
  const base = { blockId: block.id, roundIndex };
  const at = (rel: number): number => start + rel;
  const events: TimelineEvent[] = [];
  const combat = COMBAT.has(block.type);

  events.push({ ...base, kind: "start-signal", at: start, signal: combat ? "gong" : "beep" });

  const reserved: Array<[number, number]> = [];
  if (DRIVEN.has(block.type) && L >= 90) {
    events.push({ ...base, kind: "push", at: at(L - PUSH_BEFORE_END) });
    reserved.push([L - PUSH_BEFORE_END, L - PUSH_BEFORE_END + PUSH_SECONDS]);
  }
  if (DRIVEN.has(block.type) && L >= 30) {
    events.push({ ...base, kind: "clapper", at: at(L - CLAPPER_BEFORE_END) });
    reserved.push([L - CLAPPER_BEFORE_END - 0.5, L - CLAPPER_BEFORE_END + CLAPPER_SECONDS]);
  }
  if (combat) events.push({ ...base, kind: "end-signal", at: at(L), signal: "gong" });

  let cursor = 0;
  const ex = exerciseFor(block, roundIndex, ctx);
  if (ex.exerciseId !== undefined) {
    events.push({ ...base, kind: "intro", at: start, ...ex });
    cursor = INTRO_EXERCISE_SECONDS;
  } else if (combat && roundIndex === 0 && block.focusTheme) {
    events.push({ ...base, kind: "intro", at: start, theme: block.focusTheme });
    cursor = INTRO_THEME_SECONDS;
  }

  if (block.announceMode !== "combos" || block.comboIds.length === 0) return events;

  cursor += FIRST_GAP;
  for (;;) {
    const roll = ctx.rng.next();
    let len: number;
    let make: (when: number) => TimelineEvent;
    let drawnCombo: string | undefined;

    if (roll < FREESTYLE_CHANCE) {
      len = FREESTYLE_SECONDS;
      make = (when) => ({ ...base, kind: "freestyle", at: when, durationSec: len });
    } else if (roll < FREESTYLE_CHANCE + DEFENSE_CHANCE && ctx.defenseIds.length > 0) {
      const techniqueId = ctx.rng.pick(ctx.defenseIds);
      len = DEFENSE_SECONDS;
      make = (when) => ({ ...base, kind: "defense", at: when, techniqueId, durationSec: len });
    } else {
      const comboId = nextCombo(bag, block, ctx.rng);
      drawnCombo = comboId;
      const combo = ctx.combos.get(comboId);
      if (!combo) throw new Error(`Unbekannte Kombi ${comboId}`);
      len = ctx.comboSeconds(combo);
      make = (when) => ({ ...base, kind: "combo", at: when, comboId, durationSec: len });
    }

    let rel = cursor;
    for (const [from, to] of reserved) {
      if (rel < to && rel + len > from) rel = to + 0.5;
    }
    if (rel + len > L - TAIL_GUARD) {
      if (drawnCombo !== undefined) bag.queue.push(drawnCombo);
      break;
    }

    events.push(make(at(rel)));
    if (drawnCombo !== undefined) bag.last = drawnCombo;
    const pause = PAUSE_BASE[block.announceDensity] * ctx.pauseScale * (0.6 + 0.8 * ctx.rng.next());
    cursor = rel + len + ANNOUNCE_BUFFER + pause;
  }
  return events;
}

export function buildTimeline(training: Training, library: Library, options: TimelineOptions): Timeline {
  if (options.pauseScale !== undefined && !(options.pauseScale > 0)) {
    throw new RangeError(`pauseScale muss größer 0 sein: ${options.pauseScale}`);
  }
  const defenseIds = library.techniques
    .filter((t) => t.category === "defense" && t.styles.includes(options.style) && t.level <= options.level)
    .map((t) => t.id);
  const ctx: Ctx = {
    rng: createRng(options.seed),
    combos: new Map(library.combos.map((c) => [c.id, c])),
    exercises: new Map(library.exercises.map((e) => [e.id, e])),
    defenseIds,
    comboSeconds: options.comboSeconds ?? estimateComboSeconds,
    pauseScale: options.pauseScale ?? 1,
  };

  const events: TimelineEvent[] = [];
  const segments: Segment[] = [];
  let t = 0;

  training.blocks.forEach((block, blockIndex) => {
    const bag: ComboBag = { queue: [] };
    const base0 = { blockId: block.id, roundIndex: 0 };

    segments.push({ kind: "transition", blockId: block.id, blockIndex, roundIndex: 0, start: t, end: t + TRANSITION_SECONDS });
    events.push({ ...base0, kind: "block-intro", at: t });
    events.push({ ...base0, kind: "countdown", at: t + BLOCK_INTRO_LEAD });
    t += TRANSITION_SECONDS;

    for (let r = 0; r < block.rounds; r++) {
      const roundLength = roundSecondsAt(block, r);
      const work: Segment = { kind: "work", blockId: block.id, blockIndex, roundIndex: r, start: t, end: t + roundLength };
      if (block.exerciseIds.length > 0) work.exerciseId = block.exerciseIds[r % block.exerciseIds.length] as string;
      segments.push(work);
      events.push(...workEvents(block, r, t, bag, ctx));
      t += roundLength;

      if (r === block.rounds - 1 || block.restSeconds <= 0) continue;

      segments.push({ kind: "rest", blockId: block.id, blockIndex, roundIndex: r, start: t, end: t + block.restSeconds });
      const restBase = { blockId: block.id, roundIndex: r + 1 };
      if (block.restSeconds >= 10) {
        const next = exerciseFor(block, r + 1, ctx);
        events.push({ ...restBase, kind: "next-up", at: t + 1, ...next });
      }
      if (block.restSeconds >= 25) events.push({ ...restBase, kind: "ready", at: t + block.restSeconds - COUNTDOWN_SECONDS });
      t += block.restSeconds;
    }
  });

  events.push({ kind: "finish", at: t });
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map(({ e }) => e);
  return { events: sorted, segments, totalSeconds: t };
}
