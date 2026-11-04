import { buildClipManifest, comboSecondsFrom } from "../domain/cues";
import type { Level, Library, Style, Training } from "../domain/models";
import { Player, type PlayerSnapshot } from "../domain/player";
import { buildTimeline } from "../domain/timeline";
import type { PreloadResult } from "./audio/webAudioSink";
import { WebAudioSink } from "./audio/webAudioSink";
import { WakeLockService } from "./wakeLock";

const TICK_MS = 250;

export interface PlayerSessionConfig {
  training: Training;
  library: Library;
  style: Style;
  level: Level;
  seed: number;
}

export interface BeginResult extends PreloadResult {
  wakeLockError?: string;
}

export class PlayerSession {
  private readonly sink = new WebAudioSink({ clipBaseUrl: `${import.meta.env.BASE_URL}audio/` });
  private readonly wake = new WakeLockService();
  private readonly listeners = new Set<(s: PlayerSnapshot) => void>();
  private player: Player | undefined;
  private ticker: number | undefined;
  private readonly onVisible = (): void => {
    if (document.visibilityState === "visible" && this.sink.state !== "locked") void this.sink.resume().catch(() => undefined);
  };

  constructor(private readonly config: PlayerSessionConfig) {}

  /** Aus einer Nutzergeste aufrufen: entsperrt Audio, lädt Clips, startet die Einheit. */
  async begin(onProgress?: (done: number, total: number) => void): Promise<BeginResult> {
    if (this.player) throw new Error("Session wurde bereits gestartet");
    const { training, library, style, level, seed } = this.config;

    await this.sink.unlock();
    const preload = await this.sink.preload(
      buildClipManifest(library).map((c) => c.id),
      onProgress,
    );

    let wakeLockError: string | undefined;
    try {
      await this.wake.acquire();
    } catch (err) {
      wakeLockError = err instanceof Error ? err.message : String(err);
    }

    const timeline = buildTimeline(training, library, {
      seed,
      style,
      level,
      comboSeconds: comboSecondsFrom((clip) => this.sink.durationOf(clip)),
    });
    this.player = new Player(timeline, { clock: this.sink, sink: this.sink, training, library });
    document.addEventListener("visibilitychange", this.onVisible);
    this.player.start();
    this.ticker = window.setInterval(() => this.step(), TICK_MS);
    this.emit();
    return { ...preload, ...(wakeLockError ? { wakeLockError } : {}) };
  }

  subscribe(listener: (s: PlayerSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): PlayerSnapshot | undefined {
    return this.player?.snapshot();
  }

  pause(): void {
    this.requirePlayer().pause();
    this.emit();
  }

  resume(): void {
    this.requirePlayer().resume();
    this.emit();
  }

  skip(): void {
    this.requirePlayer().skip();
    this.emit();
  }

  confirmSet(): void {
    this.requirePlayer().confirmSet();
    this.emit();
  }

  async abort(): Promise<void> {
    this.player?.abort();
    await this.dispose();
    this.emit();
  }

  async dispose(): Promise<void> {
    if (this.ticker !== undefined) window.clearInterval(this.ticker);
    this.ticker = undefined;
    document.removeEventListener("visibilitychange", this.onVisible);
    await this.wake.release();
  }

  private step(): void {
    const player = this.requirePlayer();
    player.tick();
    this.emit();
    if (player.status === "finished") void this.dispose();
  }

  private emit(): void {
    const snap = this.player?.snapshot();
    if (!snap) return;
    for (const listener of this.listeners) listener(snap);
  }

  private requirePlayer(): Player {
    if (!this.player) throw new Error("Session wurde noch nicht gestartet");
    return this.player;
  }
}
