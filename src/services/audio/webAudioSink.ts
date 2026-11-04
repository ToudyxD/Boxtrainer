import type { Cue } from "../../domain/cues";
import type { AudioSink, Clock } from "../../domain/player";
import { PLACEHOLDER_SECONDS, beep, clapper, gong, placeholder, type Scheduled } from "./synth";

export type AudioSessionType = "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record";

interface AudioSessionLike {
  type: AudioSessionType;
}

export interface WebAudioSinkOptions {
  /** Basis-URL der Clips, z. B. "./audio/". Clips liegen als `<id>.mp3` darin. */
  clipBaseUrl: string;
  sessionType?: AudioSessionType;
  /** Pause zwischen zusammengesetzten Clips einer Ansage. */
  clipGapSeconds?: number;
}

export interface PreloadResult {
  loaded: number;
  missing: string[];
}

const PRELOAD_CONCURRENCY = 6;

export class WebAudioSink implements AudioSink, Clock {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly missing = new Set<string>();
  private scheduled: Scheduled[] = [];
  private stateListener: ((state: AudioContextState) => void) | undefined;
  private readonly baseUrl: string;
  private readonly sessionType: AudioSessionType;
  private readonly gap: number;

  constructor(options: WebAudioSinkOptions) {
    this.baseUrl = options.clipBaseUrl;
    this.sessionType = options.sessionType ?? "playback";
    this.gap = options.clipGapSeconds ?? 0.05;
  }

  get state(): AudioContextState | "locked" {
    return this.ctx?.state ?? "locked";
  }

  onStateChange(listener: (state: AudioContextState) => void): void {
    this.stateListener = listener;
  }

  /** Muss aus einer Nutzergeste heraus aufgerufen werden (iOS). */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
      if (session) session.type = this.sessionType;
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.connect(ctx.destination);
      ctx.addEventListener("statechange", () => this.stateListener?.(ctx.state));
      this.ctx = ctx;
      this.master = master;
    }
    await this.resume();
  }

  async resume(): Promise<void> {
    const ctx = this.requireContext();
    if (ctx.state !== "running") await ctx.resume();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new RangeError(`Lautstärke außerhalb 0..1: ${volume}`);
    this.requireMaster().gain.value = volume;
  }

  now(): number {
    return this.requireContext().currentTime;
  }

  durationOf(clip: string): number | undefined {
    return this.buffers.get(clip)?.duration;
  }

  async preload(ids: readonly string[], onProgress?: (done: number, total: number) => void): Promise<PreloadResult> {
    const ctx = this.requireContext();
    const queue = [...new Set(ids)].filter((id) => !this.buffers.has(id));
    const total = queue.length;
    let done = 0;

    const worker = async (): Promise<void> => {
      for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
        try {
          const res = await fetch(`${this.baseUrl}${id}.mp3`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          this.buffers.set(id, await ctx.decodeAudioData(await res.arrayBuffer()));
          this.missing.delete(id);
        } catch {
          this.missing.add(id);
        }
        onProgress?.(++done, total);
      }
    };

    await Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, worker));
    return { loaded: this.buffers.size, missing: [...this.missing].sort() };
  }

  play(cue: Cue, at: number): void {
    const ctx = this.requireContext();
    const out = this.requireMaster();

    switch (cue.kind) {
      case "gong":
        this.track(gong(ctx, out, at));
        return;
      case "beep":
        this.track(beep(ctx, out, at));
        return;
      case "clapper":
        this.track(clapper(ctx, out, at));
        return;
      case "speech": {
        let t = at;
        for (const id of cue.clips) {
          const buffer = this.buffers.get(id);
          if (!buffer) {
            this.track(placeholder(ctx, out, t));
            t += PLACEHOLDER_SECONDS;
            continue;
          }
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(out);
          src.start(t);
          this.track([{ node: src, start: t }]);
          t += buffer.duration + this.gap;
        }
      }
    }
  }

  cancelPending(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const s of this.scheduled) {
      if (s.start <= now) continue;
      s.node.stop();
      s.node.disconnect();
    }
    this.scheduled = this.scheduled.filter((s) => s.start <= now);
  }

  private track(items: Scheduled[]): void {
    for (const item of items) {
      item.node.addEventListener("ended", () => {
        this.scheduled = this.scheduled.filter((s) => s !== item);
      });
      this.scheduled.push(item);
    }
  }

  private requireContext(): AudioContext {
    if (!this.ctx) throw new Error("Audio nicht entsperrt: unlock() muss zuerst aus einer Nutzergeste aufgerufen werden");
    return this.ctx;
  }

  private requireMaster(): GainNode {
    if (!this.master) throw new Error("Audio nicht entsperrt: unlock() muss zuerst aufgerufen werden");
    return this.master;
  }
}
