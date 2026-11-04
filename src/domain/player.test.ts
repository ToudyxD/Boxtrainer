import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { comboAnnouncement } from "./content";
import { buildClipManifest, clipId, comboSecondsFrom, cueFor, slug, type Cue } from "./cues";
import { generateTraining, type GeneratorInput } from "./generator";
import type { Training } from "./models";
import { Player, type AudioSink } from "./player";
import { buildTimeline, estimateComboSeconds, type Timeline } from "./timeline";

const library = loadLibrary();
const gym = DEFAULT_EQUIPMENT_PROFILES.find((p) => p.id === "martial-arts-gym")!;

class FakeClock {
  t = 100;
  now(): number {
    return this.t;
  }
}

class RecordingSink implements AudioSink {
  played: Array<{ cue: Cue; at: number }> = [];
  cancels = 0;
  constructor(private readonly clock: FakeClock) {}
  play(cue: Cue, at: number): void {
    this.played.push({ cue, at });
  }
  cancelPending(): void {
    this.cancels++;
    this.played = this.played.filter((p) => p.at <= this.clock.now());
  }
}

const make = (type: GeneratorInput["type"] = "stamina") => {
  const training = generateTraining(
    { type, equipment: gym, targetMinutes: 75, style: "kickboxing", level: 2, seed: 3, history: [] },
    library,
  );
  const timeline = buildTimeline(training, library, { seed: 1, style: "kickboxing", level: 2 });
  const clock = new FakeClock();
  const sink = new RecordingSink(clock);
  const player = new Player(timeline, { clock, sink, training, library });
  return { training, timeline, clock, sink, player };
};

/** Lässt die Zeit in 250-ms-Schritten laufen und ruft tick() wie der echte Ticker auf. */
function run(env: ReturnType<typeof make>, seconds: number, step = 0.25): void {
  const end = env.clock.t + seconds;
  while (env.clock.t < end) {
    env.clock.t += step;
    env.player.tick();
  }
}

const firstRepEnd = (timeline: Timeline, training: Training): number => {
  const reps = new Set(library.exercises.filter((e) => e.format.kind === "reps").map((e) => e.id));
  const seg = timeline.segments.find((s) => s.kind === "work" && s.exerciseId !== undefined && reps.has(s.exerciseId));
  if (!seg) throw new Error(`Kein Wiederholungssatz in ${training.type}`);
  return seg.end;
};

describe("Player", () => {
  it("startet erst nach start() und plant dann nur im Vorlauf", () => {
    const { player, sink, clock } = make();
    expect(player.status).toBe("idle");
    player.start();
    expect(player.status).toBe("running");
    const beyond = sink.played.filter((p) => p.at > clock.t + 0.3 + 2 + 1e-9);
    expect(beyond).toHaveLength(0);
    expect(sink.played.length).toBeGreaterThan(0);
  });

  it("spielt Ereignisse zur Basiszeit plus Ereigniszeit", () => {
    const { player, sink, clock, timeline } = make();
    const t0 = clock.t;
    player.start();
    run({ player, sink, clock } as ReturnType<typeof make>, 20);
    const countdown = timeline.events.find((e) => e.kind === "countdown")!;
    const played = sink.played.find((p) => p.cue.kind === "countdown")!;
    expect(played.at).toBeCloseTo(t0 + 0.3 + countdown.at, 6);
  });

  it("spielt bei ununterbrochenem Lauf jedes Ereignis genau einmal", () => {
    const env = make();
    env.player.start();
    run(env, env.timeline.totalSeconds + 5);
    expect(env.player.status).toBe("finished");
    const expected = env.timeline.events.filter((e) => cueFor(e, { library, blocks: new Map(env.training.blocks.map((b) => [b.id, b])) })).length;
    expect(env.sink.played).toHaveLength(expected);
  });

  it("spielt in zeitlicher Reihenfolge", () => {
    const env = make();
    env.player.start();
    run(env, 600);
    for (let i = 1; i < env.sink.played.length; i++) {
      expect(env.sink.played[i]!.at).toBeGreaterThanOrEqual(env.sink.played[i - 1]!.at - 1e-9);
    }
  });

  it("pausiert: Position steht, keine neuen Ereignisse, Sink wird geleert", () => {
    const env = make();
    env.player.start();
    run(env, 30);
    env.player.pause();
    const pos = env.player.position();
    const count = env.sink.played.length;
    expect(env.sink.cancels).toBe(1);
    run(env, 60);
    expect(env.player.position()).toBe(pos);
    expect(env.sink.played).toHaveLength(count);
    expect(env.player.status).toBe("paused");
  });

  it("setzt nach der Pause an derselben Position fort", () => {
    const env = make();
    env.player.start();
    run(env, 30);
    env.player.pause();
    const pos = env.player.position();
    run(env, 45);
    env.player.resume();
    expect(env.player.position()).toBeCloseTo(pos, 6);
    expect(env.player.status).toBe("running");
  });

  it("spielt nach Pause kurz vor einem eingeplanten Ereignis dieses genau einmal", () => {
    const env = make();
    const ctx = { library, blocks: new Map(env.training.blocks.map((b) => [b.id, b])) };
    const expected = env.timeline.events.filter((e) => cueFor(e, ctx)).length;
    const combo = env.timeline.events.find((e) => e.kind === "combo")!;

    env.player.start();
    while (env.player.position() < combo.at - 1) run(env, 0.25);
    env.player.pause();
    run(env, 45);
    env.player.resume();
    run(env, env.timeline.totalSeconds + 5);

    expect(env.player.status).toBe("finished");
    expect(env.sink.played).toHaveLength(expected);
  });

  it("spielt nach mehrfacher Pause jedes Ereignis genau einmal", () => {
    const env = make();
    const ctx = { library, blocks: new Map(env.training.blocks.map((b) => [b.id, b])) };
    const expected = env.timeline.events.filter((e) => cueFor(e, ctx)).length;
    env.player.start();
    for (let i = 0; i < 40; i++) {
      run(env, 97.3);
      env.player.pause();
      env.clock.t += 13;
      env.player.resume();
    }
    run(env, env.timeline.totalSeconds);
    expect(env.player.status).toBe("finished");
    expect(env.sink.played).toHaveLength(expected);
  });

  it("verwirft stark verspätete Ereignisse nach langem Tick-Ausfall", () => {
    const env = make();
    const bag = env.timeline.segments.find((s) => s.kind === "work" && env.training.blocks[s.blockIndex]!.type === "bag")!;
    env.player.start();
    run(env, bag.start + 5);
    const before = env.sink.played.length;
    const from = env.player.position();
    env.clock.t += 60;
    env.player.tick();
    const late = env.sink.played.slice(before);
    for (const p of late) expect(p.at).toBeGreaterThanOrEqual(env.clock.t - 1e-9);
    const skipped = env.timeline.events.filter((e) => e.at > from && e.at < from + 58).length;
    expect(skipped).toBeGreaterThan(5);
    expect(late.length).toBeLessThan(skipped);
  });

  it("skip springt zum Beginn des nächsten Segments", () => {
    const env = make();
    env.player.start();
    run(env, 3);
    env.player.skip();
    expect(env.player.position()).toBeCloseTo(env.timeline.segments[0]!.end, 6);
    expect(env.sink.cancels).toBe(1);
  });

  it("abort stoppt und leert den Sink", () => {
    const env = make();
    env.player.start();
    run(env, 5);
    env.player.abort();
    const count = env.sink.played.length;
    run(env, 30);
    expect(env.player.status).toBe("aborted");
    expect(env.sink.played).toHaveLength(count);
  });

  it("wirft bei doppeltem start()", () => {
    const { player } = make();
    player.start();
    expect(() => player.start()).toThrow();
  });

  describe("Wiederholungssätze", () => {
    it("wartet am geschätzten Satzende auf die Bestätigung und friert die Zeit ein", () => {
      const env = make("strength");
      const end = firstRepEnd(env.timeline, env.training);
      env.player.start();
      run(env, end + 20);
      expect(env.player.status).toBe("awaiting-confirm");
      expect(env.player.position()).toBe(end);
      expect(env.player.snapshot().remaining).toBe(0);
    });

    it("plant keine Ereignisse nach dem Satzende, solange nicht bestätigt wurde", () => {
      const env = make("strength");
      const end = firstRepEnd(env.timeline, env.training);
      env.player.start();
      run(env, end + 5);
      const base = env.clock.t;
      const count = env.sink.played.length;
      run(env, 120);
      expect(env.sink.played).toHaveLength(count);
      expect(env.clock.t).toBeGreaterThan(base);
    });

    it("läuft nach confirmSet() mit der Satzpause weiter", () => {
      const env = make("strength");
      const end = firstRepEnd(env.timeline, env.training);
      env.player.start();
      run(env, end + 30);
      const before = env.sink.played.length;
      env.player.confirmSet();
      expect(env.player.status).toBe("running");
      expect(env.player.position()).toBeCloseTo(end, 6);
      run(env, 10);
      expect(env.sink.played.length).toBeGreaterThan(before);
    });

    it("springt bei frühem Tippen ans Satzende", () => {
      const env = make("strength");
      const seg = env.timeline.segments.find(
        (s) => s.kind === "work" && s.exerciseId !== undefined && library.exercises.find((e) => e.id === s.exerciseId)?.format.kind === "reps",
      )!;
      env.player.start();
      run(env, seg.start + 20);
      expect(env.player.snapshot().repBased).toBe(true);
      env.player.confirmSet();
      expect(env.player.position()).toBeCloseTo(seg.end, 6);
      expect(env.player.status).toBe("running");
      run(env, 5);
      expect(env.player.snapshot().segmentKind).toBe("rest");
    });
  });

  describe("completedBlockIds", () => {
    it("liefert zu Beginn keinen und nach dem Ende alle Blöcke", () => {
      const env = make();
      env.player.start();
      expect(env.player.completedBlockIds()).toEqual([]);
      run(env, env.timeline.totalSeconds + 5);
      expect(env.player.completedBlockIds()).toEqual(env.training.blocks.map((b) => b.id));
    });

    it("zählt nur Blöcke, deren letzte Runde vorbei ist", () => {
      const env = make();
      env.player.start();
      const second = env.timeline.segments.find((s) => s.blockIndex === 1 && s.kind === "work" && s.roundIndex === 0)!;
      run(env, second.start + 5);
      expect(env.player.completedBlockIds()).toEqual([env.training.blocks[0]!.id]);
    });

    it("bleibt nach Abbruch auf dem erreichten Stand", () => {
      const env = make();
      env.player.start();
      const second = env.timeline.segments.find((s) => s.blockIndex === 1 && s.kind === "work" && s.roundIndex === 0)!;
      run(env, second.start + 5);
      env.player.abort();
      run(env, 100);
      expect(env.player.completedBlockIds()).toEqual([env.training.blocks[0]!.id]);
    });
  });

  describe("snapshot", () => {
    it("zeigt Block, Runde und Restzeit", () => {
      const env = make();
      env.player.start();
      const bag = env.timeline.segments.find((s) => s.kind === "work" && env.training.blocks[s.blockIndex]!.type === "bag")!;
      run(env, bag.start + 5);
      const snap = env.player.snapshot();
      expect(snap.blockLabel).toBe("Sackarbeit");
      expect(snap.segmentKind).toBe("work");
      expect(snap.round).toBe(1);
      expect(snap.remaining).toBeGreaterThan(165);
      expect(snap.remaining).toBeLessThan(180);
    });

    it("zeigt die zuletzt angesagte Kombi als Text", () => {
      const env = make();
      env.player.start();
      const bag = env.timeline.segments.find((s) => s.kind === "work" && env.training.blocks[s.blockIndex]!.type === "bag")!;
      run(env, bag.start + 60);
      expect(env.player.snapshot().text).toBeTruthy();
    });

    it("nennt in der letzten Runde den nächsten Block", () => {
      const env = make();
      env.player.start();
      const bagBlock = env.training.blocks.findIndex((b) => b.type === "bag");
      const last = env.timeline.segments.find((s) => s.kind === "work" && s.blockIndex === bagBlock && s.roundIndex === env.training.blocks[bagBlock]!.rounds - 1)!;
      run(env, last.start + 5);
      expect(env.player.snapshot().upNext).toMatch(/^Danach: /);
    });
  });
});

describe("Cues und Clips", () => {
  it("jede Cue im Training referenziert einen Clip des Manifests", () => {
    const ids = new Set(buildClipManifest(library).map((c) => c.id));
    for (const type of ["technique", "stamina", "strength", "strength-endurance"] as const) {
      const { training, timeline } = make(type);
      const ctx = { library, blocks: new Map(training.blocks.map((b) => [b.id, b])) };
      for (const e of timeline.events) {
        const cue = cueFor(e, ctx);
        if (cue?.kind !== "speech" && cue?.kind !== "countdown") continue;
        const all = cue.kind === "speech" ? [...cue.clips, ...(cue.fallback ?? [])] : cue.clips;
        for (const clip of all) expect(ids.has(clip), `${type}: ${clip}`).toBe(true);
      }
    }
  });

  it("Manifest hat eindeutige IDs und enthält alle Techniken", () => {
    const manifest = buildClipManifest(library);
    expect(new Set(manifest.map((m) => m.id)).size).toBe(manifest.length);
    for (const t of library.techniques) expect(manifest.some((m) => m.id === clipId.technique(t.id))).toBe(true);
    for (let n = 1; n <= 10; n++) expect(manifest.some((m) => m.id === clipId.count(n))).toBe(true);
    expect(manifest.find((m) => m.id === clipId.count(10))?.text).toBe("Zehn");
  });

  it("Manifest enthält zu jeder Kombi einen Clip mit dem Ansagetext", () => {
    const manifest = buildClipManifest(library);
    for (const c of library.combos) {
      const clip = manifest.find((m) => m.id === clipId.combo(c.id));
      expect(clip?.text, c.id).toBe(comboAnnouncement(c, library.techniques));
    }
  });

  it("Kombi-Cue nutzt den ganzen Clip und hat die Einzel-Clips als Rückfall", () => {
    const combo = library.combos.find((c) => c.id === "c-jab-cross-lowkick")!;
    const event = { kind: "combo", at: 0, blockId: "b", roundIndex: 0, comboId: combo.id, durationSec: 1 } as const;
    const cue = cueFor(event, { library, blocks: new Map() });
    expect(cue).toEqual({
      kind: "speech",
      clips: [clipId.combo(combo.id)],
      fallback: ["tech-jab", "tech-cross", "tech-lowkick"],
    });
  });

  it("slug wandelt Umlaute und Satzzeichen um", () => {
    expect(slug("Körper und Kopf")).toBe("koerper-und-kopf");
    expect(slug("Jab als Türöffner")).toBe("jab-als-tueroeffner");
  });

  it("comboSecondsFrom nutzt gemessene Längen und fällt sonst auf die Schätzung zurück", () => {
    const combo = library.combos.find((c) => c.id === "c-jab-cross")!;
    const measured = comboSecondsFrom((clip) => (clip.startsWith("combo-") ? undefined : 0.5), 0.1)(combo);
    expect(measured).toBeCloseTo(1.1, 9);
    expect(comboSecondsFrom((clip) => (clip === clipId.combo(combo.id) ? 1.4 : 0.5))(combo)).toBe(1.4);
    expect(comboSecondsFrom(() => undefined)(combo)).toBe(estimateComboSeconds(combo));
  });
});
