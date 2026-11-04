import { comboAnnouncement } from "./content";
import type { Block, BlockType, Combo, Library } from "./models";
import { estimateComboSeconds, type TimelineEvent } from "./timeline";

export type Cue =
  | { kind: "gong" }
  | { kind: "beep" }
  | { kind: "clapper" }
  | { kind: "speech"; clips: string[]; fallback?: string[] }
  | { kind: "countdown"; clips: string[]; intervalSeconds: number };

export interface ClipSpec {
  id: string;
  text: string;
}

export const COUNTDOWN_WORDS = ["Eins", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn"] as const;

export const BLOCK_LABELS: Record<BlockType, string> = {
  warmup: "Aufwärmen",
  shadow: "Schattenboxen",
  drill: "Technik-Drill",
  bag: "Sackarbeit",
  strength: "Kraft",
  conditioning: "Kondition",
  core: "Rumpf",
  circuit: "Zirkel",
  cooldown: "Cooldown",
};

export const PHRASES = {
  ready: { text: "Bereit" },
  push: { text: "Letzte dreißig, Tempo hoch" },
  freestyle: { text: "Freestyle" },
  "next-round": { text: "Nächste Runde" },
  finish: { text: "Geschafft. Gut gemacht." },
} as const satisfies Record<string, { text: string }>;

export type PhraseKey = keyof typeof PHRASES;

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const clipId = {
  technique: (id: string): string => `tech-${id}`,
  phrase: (key: PhraseKey): string => `phrase-${key}`,
  block: (type: BlockType): string => `block-${type}`,
  count: (n: number): string => `count-${n}`,
  combo: (id: string): string => `combo-${id}`,
  exercise: (id: string): string => `ex-${id}`,
  cue: (exerciseId: string, index: number): string => `cue-${exerciseId}-${index}`,
  theme: (theme: string): string => `theme-${slug(theme)}`,
};

/** Alle Sprach-Clips, die für die Bibliothek erzeugt werden müssen. */
export function buildClipManifest(library: Library): ClipSpec[] {
  const specs = new Map<string, ClipSpec>();
  const add = (spec: ClipSpec): void => {
    const existing = specs.get(spec.id);
    if (existing && existing.text !== spec.text) throw new Error(`Clip-ID ${spec.id} mit abweichendem Text belegt`);
    specs.set(spec.id, spec);
  };

  for (const t of library.techniques) add({ id: clipId.technique(t.id), text: t.announce });
  for (const [key, p] of Object.entries(PHRASES) as Array<[PhraseKey, (typeof PHRASES)[PhraseKey]]>) {
    add({ id: clipId.phrase(key), text: p.text });
  }
  COUNTDOWN_WORDS.forEach((word, i) => add({ id: clipId.count(i + 1), text: word }));
  for (const c of library.combos) add({ id: clipId.combo(c.id), text: comboAnnouncement(c, library.techniques) });
  for (const [type, label] of Object.entries(BLOCK_LABELS) as Array<[BlockType, string]>) {
    add({ id: clipId.block(type), text: label });
  }
  for (const e of library.exercises) {
    add({ id: clipId.exercise(e.id), text: e.name });
    e.cues.forEach((cue, i) => add({ id: clipId.cue(e.id, i), text: cue }));
  }
  for (const theme of new Set([
    ...library.combos.flatMap((c) => c.themes),
    ...library.exercises.flatMap((e) => e.themes ?? []),
  ])) {
    add({ id: clipId.theme(theme), text: theme });
  }
  return [...specs.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface CueContext {
  library: Library;
  blocks: ReadonlyMap<string, Block>;
}

function exerciseClips(event: { exerciseId?: string; cue?: string }, ctx: CueContext): string[] {
  if (event.exerciseId === undefined) return [];
  const clips = [clipId.exercise(event.exerciseId)];
  const exercise = ctx.library.exercises.find((e) => e.id === event.exerciseId);
  const index = event.cue === undefined ? -1 : (exercise?.cues.indexOf(event.cue) ?? -1);
  if (index >= 0) clips.push(clipId.cue(event.exerciseId, index));
  return clips;
}

const speech = (clips: string[]): Cue | undefined => (clips.length > 0 ? { kind: "speech", clips } : undefined);

export function cueFor(event: TimelineEvent, ctx: CueContext): Cue | undefined {
  switch (event.kind) {
    case "block-intro": {
      const block = ctx.blocks.get(event.blockId);
      if (!block) throw new Error(`Unbekannter Block ${event.blockId}`);
      return speech([clipId.block(block.type), ...(block.focusTheme ? [clipId.theme(block.focusTheme)] : [])]);
    }
    case "countdown":
      return {
        kind: "countdown",
        clips: Array.from({ length: COUNTDOWN_WORDS.length }, (_, i) => clipId.count(COUNTDOWN_WORDS.length - i)),
        intervalSeconds: 1,
      };
    case "start-signal":
      return { kind: event.signal };
    case "end-signal":
      return { kind: event.signal };
    case "clapper":
      return { kind: "clapper" };
    case "intro":
      return speech(event.theme !== undefined ? [clipId.theme(event.theme)] : exerciseClips(event, ctx));
    case "next-up": {
      const clips = exerciseClips(event, ctx);
      return speech(clips.length > 0 ? clips : [clipId.phrase("next-round")]);
    }
    case "combo": {
      const combo = ctx.library.combos.find((c) => c.id === event.comboId);
      if (!combo) throw new Error(`Unbekannte Kombi ${event.comboId}`);
      return {
        kind: "speech",
        clips: [clipId.combo(combo.id)],
        fallback: combo.techniqueIds.map(clipId.technique),
      };
    }
    case "defense":
      return speech([clipId.technique(event.techniqueId)]);
    case "freestyle":
      return speech([clipId.phrase("freestyle")]);
    case "push":
      return speech([clipId.phrase("push")]);
    case "ready":
      return speech([clipId.phrase("ready")]);
    case "finish":
      return speech([clipId.phrase("finish")]);
  }
}

/** Text für die Anzeige; Ereignisse ohne Text (Signale, Countdown) liefern undefined. */
export function textFor(event: TimelineEvent, ctx: CueContext): string | undefined {
  const exerciseText = (e: { exerciseId?: string; cue?: string }): string | undefined => {
    if (e.exerciseId === undefined) return undefined;
    const name = ctx.library.exercises.find((x) => x.id === e.exerciseId)?.name ?? e.exerciseId;
    return e.cue ? `${name} – ${e.cue}` : name;
  };

  switch (event.kind) {
    case "combo": {
      const combo = ctx.library.combos.find((c) => c.id === event.comboId);
      return combo ? comboAnnouncement(combo, ctx.library.techniques) : undefined;
    }
    case "defense":
      return ctx.library.techniques.find((t) => t.id === event.techniqueId)?.announce;
    case "freestyle":
      return "Freestyle";
    case "push":
      return "Tempo hoch!";
    case "intro":
      return event.theme ?? exerciseText(event);
    case "next-up":
      return exerciseText(event) ?? "Nächste Runde";
    case "block-intro": {
      const block = ctx.blocks.get(event.blockId);
      return block ? BLOCK_LABELS[block.type] : undefined;
    }
    case "ready":
      return "Bereit";
    case "finish":
      return "Geschafft";
    default:
      return undefined;
  }
}

/** Kombi-Dauer aus gemessenen Clip-Längen: ganzer Kombi-Clip, sonst Summe der Einzel-Clips, sonst Schätzung. */
export function comboSecondsFrom(
  durationOf: (clip: string) => number | undefined,
  gapSeconds = 0.08,
): (combo: Combo) => number {
  return (combo) => {
    const whole = durationOf(clipId.combo(combo.id));
    if (whole !== undefined) return whole;
    const durations = combo.techniqueIds.map((id) => durationOf(clipId.technique(id)));
    if (durations.some((d) => d === undefined)) return estimateComboSeconds(combo);
    return (durations as number[]).reduce((a, b) => a + b, 0) + gapSeconds * (durations.length - 1);
  };
}
