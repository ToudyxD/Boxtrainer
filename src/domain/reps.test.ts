import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { ContentError, validateExercises } from "./content";
import { buildClipManifest, clipId, cueFor, repsText, textFor, type Cue } from "./cues";
import { generateTraining, type GeneratorInput } from "./generator";
import { germanNumber } from "./numberWords";
import type { Exercise, Library } from "./models";
import { Player, type AudioSink } from "./player";
import { buildTimeline } from "./timeline";

const library = loadLibrary();
const byId = new Map(library.exercises.map((e) => [e.id, e]));
const gym = DEFAULT_EQUIPMENT_PROFILES.find((p) => p.id === "martial-arts-gym")!;

const only = (...ids: string[]): Library => ({
  ...library,
  exercises: library.exercises.filter((e) => e.category !== "power" || ids.includes(e.id)),
});

const powerTraining = (lib: Library, over: Partial<GeneratorInput> = {}) =>
  generateTraining({ equipment: gym, type: "power", targetMinutes: 75, style: "kickboxing", level: 2, seed: 2, history: [], ...over }, lib);

describe("germanNumber", () => {
  it.each([
    [2, "zwei"],
    [10, "zehn"],
    [12, "zwölf"],
    [15, "fünfzehn"],
    [16, "sechzehn"],
    [17, "siebzehn"],
    [20, "zwanzig"],
    [21, "einundzwanzig"],
    [30, "dreißig"],
    [45, "fünfundvierzig"],
    [99, "neunundneunzig"],
  ])("%i ist %s", (n, word) => {
    expect(germanNumber(n)).toBe(word);
  });

  it.each([0, 1, 100, -5, 2.5, Number.NaN])("lehnt %s ab", (n) => {
    expect(() => germanNumber(n)).toThrow(RangeError);
  });

  it("repsText liefert Ansage und Anzeige", () => {
    expect(repsText(30, "Schläge", true)).toBe("Dreißig Schläge");
    expect(repsText(30, "Schläge", false)).toBe("30 Schläge");
  });
});

describe("Zählübungen im Katalog", () => {
  const counted = library.exercises.filter((e) => e.format.kind === "reps" && e.format.unit);

  it("Power Hooks zählen 30 Schläge, Power Low Kicks 20 Tritte, Power Knees 20 Knie", () => {
    expect(byId.get("power-hooks")?.format).toMatchObject({ reps: 30, unit: "Schläge" });
    expect(byId.get("power-low-kicks")?.format).toMatchObject({ reps: 20, unit: "Tritte" });
    expect(byId.get("power-knees")?.format).toMatchObject({ reps: 20, unit: "Knie" });
  });

  it("alle Zählübungen haben geschätzte Dauer, Pause (30 oder 60 s) und gehören zu Power", () => {
    expect(counted.length).toBeGreaterThanOrEqual(15);
    for (const e of counted) {
      const f = e.format as Extract<Exercise["format"], { kind: "reps" }>;
      expect(e.category, e.id).toBe("power");
      expect(f.seconds, e.id).toBeGreaterThan(0);
      expect([30, 60], e.id).toContain(f.restSeconds);
      expect(f.sets, e.id).toBe(1);
    }
  });

  it("Kicks zählen Tritte, Knie zählen Knie, Schläge zählen Schläge", () => {
    for (const e of counted) {
      const unit = (e.format as { unit: string }).unit;
      if (/kick|teep|lowkick/i.test(e.id)) expect(unit, e.id).toBe("Tritte");
      else if (/knee/.test(e.id)) expect(unit, e.id).toBe("Knie");
      else expect(unit, e.id).toBe("Schläge");
    }
  });

  it("Kern- und Kraftübungen bleiben ohne Ansage der Anzahl", () => {
    for (const id of ["dead-bug", "squat", "push-up"]) {
      const f = byId.get(id)!.format;
      expect(f.kind).toBe("reps");
      expect((f as { unit?: string }).unit).toBeUndefined();
    }
  });
});

describe("Validierung von Zählformaten", () => {
  const sample = (format: Exercise["format"]): Exercise => ({ ...byId.get("power-hooks")!, format });

  it("akzeptiert die Bibliothek", () => {
    expect(() => validateExercises(library.exercises)).not.toThrow();
  });

  it.each([
    ["1 Wiederholung", { kind: "reps", reps: 1, sets: 1 }],
    ["100 Wiederholungen", { kind: "reps", reps: 100, sets: 1 }],
    ["Dezimalzahl", { kind: "reps", reps: 20.5, sets: 1 }],
    ["Satz 0", { kind: "reps", reps: 20, sets: 0 }],
    ["Dauer 0", { kind: "reps", reps: 20, sets: 1, seconds: 0 }],
    ["negative Pause", { kind: "reps", reps: 20, sets: 1, seconds: 30, restSeconds: -1 }],
  ] as Array<[string, Exercise["format"]]>)("lehnt ab: %s", (_name, format) => {
    expect(() => validateExercises([sample(format)])).toThrow(ContentError);
  });
});

describe("Ansagen und Anzeige der Anzahl", () => {
  const ctx = { library, blocks: new Map() };
  const intro = (exerciseId: string, cue?: string) => ({ kind: "intro" as const, at: 0, blockId: "b", roundIndex: 0, exerciseId, ...(cue ? { cue } : {}) });

  it("Ansage: Name, Anzahl, Hinweis", () => {
    const cue = byId.get("power-hooks")!.cues[0]!;
    const result = cueFor(intro("power-hooks", cue), ctx) as Extract<Cue, { kind: "speech" }>;
    expect(result.clips).toEqual([clipId.exercise("power-hooks"), "reps-30-schlaege", clipId.cue("power-hooks", 0)]);
  });

  it("Anzeige: Name, Anzahl und Hinweis", () => {
    expect(textFor(intro("power-hooks", "Aus der Hüfte drehen"), ctx)).toBe("Power Hooks, 30 Schläge – Aus der Hüfte drehen");
    expect(textFor(intro("power-low-kicks"), ctx)).toBe("Power Low Kicks, 20 Tritte");
  });

  it("zeitbasierte Übungen und Kraftübungen sagen keine Anzahl an", () => {
    const timed = cueFor(intro("dempsey-roll"), ctx) as Extract<Cue, { kind: "speech" }>;
    expect(timed.clips).toEqual([clipId.exercise("dempsey-roll")]);
    const strength = cueFor(intro("squat"), ctx) as Extract<Cue, { kind: "speech" }>;
    expect(strength.clips).toEqual([clipId.exercise("squat")]);
    expect(textFor(intro("squat"), ctx)).toBe("Kniebeuge");
  });

  it("das Clip-Manifest enthält die Zahlwörter ohne Duplikate", () => {
    const manifest = buildClipManifest(library);
    const reps = manifest.filter((c) => c.id.startsWith("reps-"));
    expect(new Set(reps.map((c) => c.id)).size).toBe(reps.length);
    expect(reps.find((c) => c.id === "reps-30-schlaege")?.text).toBe("Dreißig Schläge");
    expect(reps.find((c) => c.id === "reps-20-tritte")?.text).toBe("Zwanzig Tritte");
    expect(reps.find((c) => c.id === "reps-20-knie")?.text).toBe("Zwanzig Knie");
    expect(reps.find((c) => c.id === "reps-15-schlaege")?.text).toBe("Fünfzehn Schläge");
  });
});

describe("Zählrunden in der Zeitleiste", () => {
  const lib = only("power-hooks", "dempsey-roll");
  const t = powerTraining(lib);
  const block = t.blocks.find((b) => b.type === "power")!;
  const tl = buildTimeline(t, lib, { seed: 1, style: "kickboxing", level: 2 });
  const rounds = tl.segments.filter((s) => s.kind === "work" && s.blockId === block.id);

  it("hat Zähl- und Zeitrunden", () => {
    expect(new Set(rounds.map((r) => r.exerciseId))).toEqual(new Set(["power-hooks", "dempsey-roll"]));
  });

  it("Zählrunden haben die geschätzte Dauer, Pause 60 s; Zeitrunden 30 s Pause", () => {
    for (const seg of rounds) {
      const counted = seg.exerciseId === "power-hooks";
      expect(seg.end - seg.start).toBe(counted ? 40 : 30);
      const rest = tl.segments.find((s) => s.kind === "rest" && s.blockId === block.id && s.roundIndex === seg.roundIndex);
      if (rest) expect(rest.end - rest.start).toBe(counted ? 60 : 30);
    }
  });

  it("Zählrunden haben Gong, aber keinen Klapper; Zeitrunden haben beides", () => {
    for (const seg of rounds) {
      const at = (kind: string, when: number) => tl.events.some((e) => e.kind === kind && "blockId" in e && e.blockId === block.id && e.at === when);
      const counted = seg.exerciseId === "power-hooks";
      expect(at("start-signal", seg.start)).toBe(true);
      expect(at("end-signal", seg.end)).toBe(true);
      expect(at("clapper", seg.end - 10), seg.exerciseId).toBe(!counted);
    }
  });
});

describe("Player bei Zählrunden", () => {
  class FakeClock {
    t = 100;
    now(): number {
      return this.t;
    }
  }
  class Sink implements AudioSink {
    played: Array<{ cue: Cue; at: number }> = [];
    constructor(private readonly clock: FakeClock) {}
    play(cue: Cue, at: number): void {
      this.played.push({ cue, at });
    }
    cancelPending(): void {
      this.played = this.played.filter((p) => p.at <= this.clock.now());
    }
  }

  const setup = () => {
    const lib = only("power-hooks");
    const t = powerTraining(lib);
    const timeline = buildTimeline(t, lib, { seed: 1, style: "kickboxing", level: 2 });
    const clock = new FakeClock();
    const sink = new Sink(clock);
    const player = new Player(timeline, { clock, sink, training: t, library: lib });
    const block = t.blocks.find((b) => b.type === "power")!;
    const first = timeline.segments.find((s) => s.kind === "work" && s.blockId === block.id)!;
    return { player, clock, sink, first };
  };

  const run = (env: ReturnType<typeof setup>, seconds: number) => {
    const end = env.clock.t + seconds;
    while (env.clock.t < end) {
      env.clock.t += 0.25;
      env.player.tick();
    }
  };

  it("hält nach der geschätzten Zeit an und wartet auf Fertig", () => {
    const env = setup();
    env.player.start();
    run(env, env.first.end + 5);
    expect(env.player.status).toBe("awaiting-confirm");
    const snap = env.player.snapshot();
    expect(snap.repBased).toBe(true);
    expect(snap.remaining).toBe(0);
    expect(snap.text).toContain("30 Schläge");
  });

  it("macht nach Fertig mit der Pause weiter und spielt den Gong", () => {
    const env = setup();
    env.player.start();
    run(env, env.first.end + 5);
    const before = env.sink.played.length;
    env.player.confirmSet();
    run(env, 1);
    expect(env.player.status).toBe("running");
    expect(env.player.snapshot().segmentKind).toBe("rest");
    expect(env.sink.played.slice(before).some((p) => p.cue.kind === "gong")).toBe(true);
  });

  it("Fertig vor Ablauf der Zeit springt direkt in die Pause", () => {
    const env = setup();
    env.player.start();
    run(env, env.first.start + 15);
    expect(env.player.snapshot().segmentKind).toBe("work");
    env.player.confirmSet();
    run(env, 0.5);
    expect(env.player.snapshot().segmentKind).toBe("rest");
  });
});
