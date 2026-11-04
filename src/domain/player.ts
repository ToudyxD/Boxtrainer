import { BLOCK_LABELS, cueFor, textFor, type Cue, type CueContext } from "./cues";
import type { BlockType, Library, Training } from "./models";
import type { Segment, Timeline, TimelineEvent } from "./timeline";

export interface Clock {
  now(): number;
}

export interface AudioSink {
  /** Spielt die Cue zur absoluten Sink-Zeit `at` (Sekunden der Clock). */
  play(cue: Cue, at: number): void;
  /** Verwirft alles, was geplant, aber noch nicht gestartet ist. */
  cancelPending(): void;
}

export type PlayerStatus = "idle" | "running" | "paused" | "awaiting-confirm" | "finished" | "aborted";

export interface PlayerSnapshot {
  status: PlayerStatus;
  position: number;
  total: number;
  segmentKind: Segment["kind"] | "none";
  blockIndex: number;
  blockCount: number;
  blockType: BlockType | undefined;
  blockLabel: string;
  round: number;
  rounds: number;
  remaining: number;
  text: string | undefined;
  upNext: string | undefined;
  repBased: boolean;
}

export interface PlayerDeps {
  clock: Clock;
  sink: AudioSink;
  training: Training;
  library: Library;
  lookaheadSeconds?: number;
  maxLateSeconds?: number;
  startDelaySeconds?: number;
}

const DEFAULTS = { lookaheadSeconds: 2, maxLateSeconds: 2, startDelaySeconds: 0.3 };

export class Player {
  private readonly clock: Clock;
  private readonly sink: AudioSink;
  private readonly training: Training;
  private readonly cueCtx: CueContext;
  private readonly events: readonly TimelineEvent[];
  private readonly segments: readonly Segment[];
  private readonly total: number;
  private readonly lookahead: number;
  private readonly maxLate: number;
  private readonly startDelay: number;
  private readonly repEnds: number[];

  private state: PlayerStatus = "idle";
  private base = 0;
  private frozenPos = 0;
  private nextIdx = 0;
  private freezeIdx = 0;

  constructor(timeline: Timeline, deps: PlayerDeps) {
    this.clock = deps.clock;
    this.sink = deps.sink;
    this.training = deps.training;
    this.events = timeline.events;
    this.segments = timeline.segments;
    this.total = timeline.totalSeconds;
    this.lookahead = deps.lookaheadSeconds ?? DEFAULTS.lookaheadSeconds;
    this.maxLate = deps.maxLateSeconds ?? DEFAULTS.maxLateSeconds;
    this.startDelay = deps.startDelaySeconds ?? DEFAULTS.startDelaySeconds;
    this.cueCtx = { library: deps.library, blocks: new Map(deps.training.blocks.map((b) => [b.id, b])) };

    const repExercises = new Set(deps.library.exercises.filter((e) => e.format.kind === "reps").map((e) => e.id));
    this.repEnds = timeline.segments
      .filter((s) => s.kind === "work" && s.exerciseId !== undefined && repExercises.has(s.exerciseId))
      .map((s) => s.end);
  }

  get status(): PlayerStatus {
    return this.state;
  }

  position(): number {
    return this.state === "running" ? this.clock.now() - this.base : this.frozenPos;
  }

  start(): void {
    if (this.state !== "idle") throw new Error(`start() im Zustand ${this.state}`);
    this.base = this.clock.now() + this.startDelay;
    this.state = "running";
    this.tick();
  }

  pause(): void {
    if (this.state !== "running") return;
    this.frozenPos = this.position();
    this.state = "paused";
    this.sink.cancelPending();
    this.nextIdx = this.firstEventFrom(this.frozenPos);
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.base = this.clock.now() - this.frozenPos;
    this.state = "running";
    this.tick();
  }

  /** Beendet einen wiederholungsbasierten Satz, auch vor Ablauf der geschätzten Zeit. */
  confirmSet(): void {
    if (this.state === "awaiting-confirm") {
      this.freezeIdx++;
      this.base = this.clock.now() - this.frozenPos;
      this.state = "running";
      this.tick();
      return;
    }
    if (this.state !== "running") return;
    const seg = this.segmentAt(this.position());
    if (seg?.kind !== "work" || !this.repEnds.includes(seg.end)) return;
    this.seekTo(seg.end);
    this.tick();
  }

  /** Springt zum Beginn des nächsten Segments. */
  skip(): void {
    if (this.state !== "running" && this.state !== "paused" && this.state !== "awaiting-confirm") return;
    const pos = Math.max(this.position(), 0);
    const seg = this.segmentAt(pos);
    const target = seg ? seg.end : this.total;
    this.seekTo(target);
    if (this.state === "running") this.tick();
  }

  /** Blöcke, deren letzte Arbeitsrunde bereits vollständig durchlaufen wurde. */
  completedBlockIds(): string[] {
    const pos = this.position();
    return this.training.blocks
      .filter((_, i) => {
        const ends = this.segments.filter((s) => s.kind === "work" && s.blockIndex === i).map((s) => s.end);
        return ends.length > 0 && Math.max(...ends) <= pos + 1e-9;
      })
      .map((b) => b.id);
  }

  abort(): void {
    if (this.state === "finished" || this.state === "aborted") return;
    this.sink.cancelPending();
    this.frozenPos = Math.max(this.position(), 0);
    this.state = "aborted";
  }

  /** Muss regelmäßig (ca. alle 250 ms) aufgerufen werden; plant Ereignisse im Vorlauf ein. */
  tick(): void {
    if (this.state !== "running") return;
    const pos = this.position();
    const freezeAt = this.repEnds[this.freezeIdx] ?? Number.POSITIVE_INFINITY;

    while (this.nextIdx < this.events.length) {
      const event = this.events[this.nextIdx] as TimelineEvent;
      if (event.at >= freezeAt || event.at > pos + this.lookahead) break;
      this.nextIdx++;
      if (pos - event.at > this.maxLate) continue;
      const cue = cueFor(event, this.cueCtx);
      if (cue) this.sink.play(cue, Math.max(this.base + event.at, this.clock.now()));
    }

    if (pos >= freezeAt) {
      this.frozenPos = freezeAt;
      this.state = "awaiting-confirm";
      return;
    }
    if (pos >= this.total && this.nextIdx >= this.events.length) {
      this.frozenPos = this.total;
      this.state = "finished";
    }
  }

  snapshot(): PlayerSnapshot {
    const pos = Math.max(this.position(), 0);
    const lookup = this.state === "awaiting-confirm" ? pos - 1e-6 : Math.min(pos, this.total - 1e-6);
    const seg = this.segmentAt(lookup);
    const block = seg ? this.training.blocks[seg.blockIndex] : undefined;
    const done = this.state === "finished";

    return {
      status: this.state,
      position: Math.min(pos, this.total),
      total: this.total,
      segmentKind: done || !seg ? "none" : seg.kind,
      blockIndex: seg?.blockIndex ?? 0,
      blockCount: this.training.blocks.length,
      blockType: block?.type,
      blockLabel: block ? BLOCK_LABELS[block.type] : "",
      round: seg ? (seg.kind === "rest" ? seg.roundIndex + 2 : seg.roundIndex + 1) : 0,
      rounds: block?.rounds ?? 0,
      remaining: seg ? Math.max(seg.end - pos, 0) : 0,
      text: seg ? this.displayText(pos, seg) : undefined,
      upNext: seg ? this.upNext(seg) : undefined,
      repBased: seg?.kind === "work" && this.repEnds.includes(seg.end),
    };
  }

  private segmentAt(pos: number): Segment | undefined {
    return this.segments.find((s) => pos >= s.start && pos < s.end);
  }

  private firstEventFrom(pos: number): number {
    const idx = this.events.findIndex((e) => e.at >= pos);
    return idx === -1 ? this.events.length : idx;
  }

  private seekTo(target: number): void {
    this.sink.cancelPending();
    this.nextIdx = this.firstEventFrom(target);
    this.freezeIdx = this.repEnds.findIndex((end) => end > target);
    if (this.freezeIdx === -1) this.freezeIdx = this.repEnds.length;
    if (this.state === "running") {
      this.base = this.clock.now() - target;
    } else {
      this.frozenPos = target;
      if (this.state === "awaiting-confirm") {
        this.state = "running";
        this.base = this.clock.now() - target;
      }
    }
  }

  private displayText(pos: number, seg: Segment): string | undefined {
    let i = this.events.length - 1;
    while (i >= 0 && (this.events[i] as TimelineEvent).at > pos) i--;
    for (; i >= 0; i--) {
      const event = this.events[i] as TimelineEvent;
      if (event.at < seg.start) break;
      const text = textFor(event, this.cueCtx);
      if (text !== undefined) return text;
    }
    return undefined;
  }

  private upNext(seg: Segment): string | undefined {
    const block = this.training.blocks[seg.blockIndex];
    if (!block) return undefined;
    const isLastRound = seg.kind === "work" && seg.roundIndex === block.rounds - 1;
    if (seg.kind === "transition") return undefined;
    if (isLastRound) {
      const next = this.training.blocks[seg.blockIndex + 1];
      return next ? `Danach: ${BLOCK_LABELS[next.type]}` : "Danach: Ende";
    }
    const nextExerciseId = block.exerciseIds[(seg.roundIndex + 1) % Math.max(block.exerciseIds.length, 1)];
    if (nextExerciseId === undefined) return undefined;
    const name = this.cueCtx.library.exercises.find((e) => e.id === nextExerciseId)?.name;
    return name ? `Danach: ${name}` : undefined;
  }
}
