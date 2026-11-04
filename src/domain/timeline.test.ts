import { describe, expect, it } from "vitest";
import { DEFAULT_EQUIPMENT_PROFILES, loadLibrary } from "../content";
import { generateTraining } from "./generator";
import type { Block, Training } from "./models";
import {
  ANNOUNCE_BUFFER,
  COUNTDOWN_SECONDS,
  TAIL_GUARD,
  TRANSITION_SECONDS,
  buildTimeline,
  type Timeline,
  type TimelineEvent,
} from "./timeline";

const library = loadLibrary();
const gym = DEFAULT_EQUIPMENT_PROFILES.find((p) => p.id === "martial-arts-gym")!;

const training = (type: Training["type"] = "stamina", seed = 3): Training =>
  generateTraining({ type, equipment: gym, targetMinutes: 75, style: "kickboxing", level: 2, seed, history: [] }, library);

const build = (t: Training, seed = 1): Timeline => buildTimeline(t, library, { seed, style: "kickboxing", level: 2 });

const announcements = (events: TimelineEvent[]) =>
  events.filter((e): e is Extract<TimelineEvent, { kind: "combo" | "defense" | "freestyle" }> =>
    e.kind === "combo" || e.kind === "defense" || e.kind === "freestyle",
  );

const roundsOf = (tl: Timeline, block: Block) =>
  tl.segments.filter((s) => s.kind === "work" && s.blockId === block.id);

describe("buildTimeline", () => {
  it("ist bei gleichem Seed reproduzierbar", () => {
    const t = training();
    expect(build(t, 7)).toEqual(build(t, 7));
  });

  it("liefert zeitlich sortierte Ereignisse und endet mit finish", () => {
    const tl = build(training());
    for (let i = 1; i < tl.events.length; i++) {
      expect(tl.events[i]!.at).toBeGreaterThanOrEqual(tl.events[i - 1]!.at);
    }
    const last = tl.events.at(-1)!;
    expect(last.kind).toBe("finish");
    expect(last.at).toBe(tl.totalSeconds);
  });

  it("gesamtdauer = Blockzeit plus Übergang pro Block", () => {
    const t = training();
    const blockTime = t.blocks.reduce(
      (s, b) => s + b.rounds * b.roundSeconds + Math.max(b.rounds - 1, 0) * b.restSeconds,
      0,
    );
    expect(build(t).totalSeconds).toBe(blockTime + t.blocks.length * TRANSITION_SECONDS);
  });

  it("segmente schließen lückenlos aneinander an", () => {
    const tl = build(training());
    expect(tl.segments[0]!.start).toBe(0);
    for (let i = 1; i < tl.segments.length; i++) {
      expect(tl.segments[i]!.start).toBe(tl.segments[i - 1]!.end);
    }
  });

  it("zählt vor jedem Block 10 Sekunden herunter und startet dann mit Signal", () => {
    const t = training();
    const tl = build(t);
    for (const block of t.blocks) {
      const countdown = tl.events.find((e) => e.kind === "countdown" && e.blockId === block.id)!;
      const firstWork = tl.segments.find((s) => s.kind === "work" && s.blockId === block.id)!;
      expect(firstWork.start - countdown.at).toBe(COUNTDOWN_SECONDS);
      const signal = tl.events.find((e) => e.kind === "start-signal" && e.blockId === block.id && e.at === firstWork.start);
      expect(signal).toBeDefined();
    }
  });

  it("nutzt Gong bei Sack und Schatten, Piepton sonst", () => {
    const t = training();
    const tl = build(t);
    for (const e of tl.events) {
      if (e.kind !== "start-signal") continue;
      const block = t.blocks.find((b) => b.id === e.blockId)!;
      expect(e.signal).toBe(block.type === "bag" || block.type === "shadow" ? "gong" : "beep");
    }
  });

  describe("Kampfrunden", () => {
    const t = training("stamina");
    const bagBlock = t.blocks.find((b) => b.type === "bag")!;

    it("setzt Klapper 10 s und Antreiben 30 s vor Rundenende", () => {
      const tl = build(t);
      for (const seg of roundsOf(tl, bagBlock)) {
        const clapper = tl.events.find((e) => e.kind === "clapper" && e.blockId === bagBlock.id && e.at === seg.end - 10);
        const push = tl.events.find((e) => e.kind === "push" && e.blockId === bagBlock.id && e.at === seg.end - 30);
        expect(clapper).toBeDefined();
        expect(push).toBeDefined();
      }
    });

    it("beendet jede Kampfrunde mit Gong", () => {
      const tl = build(t);
      for (const seg of roundsOf(tl, bagBlock)) {
        expect(tl.events.some((e) => e.kind === "end-signal" && e.at === seg.end && e.blockId === bagBlock.id)).toBe(true);
      }
    });

    it("hält Mindestabstand aus Länge der vorigen Ansage plus Puffer", () => {
      const tl = build(t);
      for (const seg of roundsOf(tl, bagBlock)) {
        const list = announcements(tl.events).filter((a) => a.blockId === bagBlock.id && a.roundIndex === seg.roundIndex);
        expect(list.length).toBeGreaterThan(3);
        for (let i = 1; i < list.length; i++) {
          const prev = list[i - 1]!;
          expect(list[i]!.at - prev.at).toBeGreaterThanOrEqual(prev.durationSec + ANNOUNCE_BUFFER - 1e-9);
        }
      }
    });

    it("lässt Ansagen weder Antreiben noch Klapper überlappen noch ins Rundenende laufen", () => {
      const tl = build(t);
      for (const seg of roundsOf(tl, bagBlock)) {
        const push = seg.end - 30;
        const clapper = seg.end - 10;
        for (const a of announcements(tl.events).filter((x) => x.blockId === bagBlock.id && x.roundIndex === seg.roundIndex)) {
          const end = a.at + a.durationSec;
          expect(end).toBeLessThanOrEqual(seg.end - TAIL_GUARD + 1e-9);
          expect(a.at < push + 3 && end > push).toBe(false);
          expect(a.at < clapper + 1.5 && end > clapper - 0.5).toBe(false);
        }
      }
    });

    it("sagt nur Kombis aus dem Pool des Blocks an", () => {
      const tl = build(t);
      for (const a of announcements(tl.events)) {
        if (a.kind !== "combo") continue;
        const block = t.blocks.find((b) => b.id === a.blockId)!;
        expect(block.comboIds).toContain(a.comboId);
      }
    });

    it("wiederholt keine Kombi direkt hintereinander", () => {
      const tl = build(t);
      const combos = announcements(tl.events).filter((a) => a.kind === "combo" && a.blockId === bagBlock.id);
      for (let i = 1; i < combos.length; i++) {
        const prev = combos[i - 1]!;
        const cur = combos[i]!;
        if (prev.kind === "combo" && cur.kind === "combo") expect(cur.comboId).not.toBe(prev.comboId);
      }
    });

    it("hohe Dichte erzeugt mehr Ansagen als niedrige", () => {
      const count = (density: 1 | 3) => {
        const custom: Training = {
          ...t,
          blocks: t.blocks.map((b) => (b.id === bagBlock.id ? { ...b, announceDensity: density } : b)),
        };
        return announcements(build(custom, 11).events).filter((a) => a.blockId === bagBlock.id).length;
      };
      expect(count(3)).toBeGreaterThan(count(1));
    });

    it("kürzere pauseScale erzeugt mehr Ansagen, längere weniger", () => {
      const count = (pauseScale: number) =>
        announcements(buildTimeline(t, library, { seed: 11, style: "kickboxing", level: 2, pauseScale }).events).filter(
          (a) => a.blockId === bagBlock.id,
        ).length;
      expect(count(0.5)).toBeGreaterThan(count(1));
      expect(count(1)).toBeGreaterThan(count(1.6));
    });

    it.each([0, -1, Number.NaN])("lehnt pauseScale %s ab", (pauseScale) => {
      expect(() => buildTimeline(t, library, { seed: 1, style: "kickboxing", level: 2, pauseScale })).toThrow(RangeError);
    });

    it("hält bei Standard-Dichte 2 im Mittel höchstens 7 s von Start zu Start", () => {
      const tl = build(t);
      const gaps: number[] = [];
      for (const seg of roundsOf(tl, bagBlock)) {
        const list = announcements(tl.events).filter((a) => a.blockId === bagBlock.id && a.roundIndex === seg.roundIndex);
        for (let i = 1; i < list.length; i++) gaps.push(list[i]!.at - list[i - 1]!.at);
      }
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      expect(mean).toBeLessThan(7);
    });

    it("sagt am Anfang der ersten Runde das Fokus-Thema an", () => {
      const tech = generateTraining(
        { type: "technique", equipment: gym, targetMinutes: 75, style: "kickboxing", level: 2, seed: 4, focusTheme: "Lowkick setzen", history: [] },
        library,
      );
      const tl = build(tech);
      const intros = tl.events.filter((e) => e.kind === "intro" && e.theme === "Lowkick setzen");
      expect(intros.length).toBeGreaterThan(0);
    });
  });

  describe("Schattenboxen", () => {
    const realistic = (c: { techniqueIds: string[] }) => 0.35 * c.techniqueIds.length + 0.2;

    it.each(["technique", "stamina", "strength"] as const)("%s: im Mittel höchstens 4,5 s zwischen Ansagen", (type) => {
      const gaps: number[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        const t = training(type, seed);
        const tl = buildTimeline(t, library, { seed, style: "kickboxing", level: 2, comboSeconds: realistic });
        const shadow = t.blocks.find((b) => b.type === "shadow")!;
        const list = tl.events.filter((e) => (e.kind === "combo" || e.kind === "defense") && e.blockId === shadow.id);
        for (let i = 1; i < list.length; i++) {
          if (list[i]!.kind !== "finish" && list[i - 1]!.kind !== "finish") {
            const a = list[i - 1] as Extract<TimelineEvent, { roundIndex: number }>;
            const b = list[i] as Extract<TimelineEvent, { roundIndex: number }>;
            if (a.roundIndex === b.roundIndex) gaps.push(b.at - a.at);
          }
        }
      }
      expect(gaps.reduce((x, y) => x + y, 0) / gaps.length).toBeLessThan(4.5);
    });

    it("Schattenblöcke laufen mit der höchsten Ansagedichte", () => {
      for (const type of ["technique", "stamina", "strength"] as const) {
        for (const b of training(type).blocks.filter((x) => x.type === "shadow")) expect(b.announceDensity).toBe(3);
      }
    });
  });

  describe("Pausen", () => {
    const t = training("stamina");
    const bagBlock = t.blocks.find((b) => b.type === "bag")!;

    it("kündigt in der Pause die nächste Runde an und sagt 10 s vor Ende Bereit", () => {
      const tl = build(t);
      const rests = tl.segments.filter((s) => s.kind === "rest" && s.blockId === bagBlock.id);
      expect(rests).toHaveLength(bagBlock.rounds - 1);
      for (const rest of rests) {
        expect(tl.events.some((e) => e.kind === "next-up" && e.blockId === bagBlock.id && e.at === rest.start + 1)).toBe(true);
        expect(tl.events.some((e) => e.kind === "ready" && e.blockId === bagBlock.id && e.at === rest.end - 10)).toBe(true);
      }
    });

    it("kündigt Übungen mit Cue an", () => {
      const circuit = training("strength-endurance");
      const tl = build(circuit);
      const nextUps = tl.events.filter((e) => e.kind === "next-up" && e.exerciseId !== undefined);
      expect(nextUps.length).toBeGreaterThan(0);
      for (const e of nextUps) {
        if (e.kind === "next-up") expect(e.cue).toBeTruthy();
      }
    });
  });

  describe("Übungsblöcke", () => {
    it("ordnet jeder Arbeitsrunde reihum eine Übung des Blocks zu", () => {
      const t = training("strength");
      const tl = build(t);
      const strength = t.blocks.find((b) => b.type === "strength")!;
      for (const seg of roundsOf(tl, strength)) {
        expect(seg.exerciseId).toBe(strength.exerciseIds[seg.roundIndex % strength.exerciseIds.length]);
      }
    });

    it("setzt bei Übungen am Rundenstart eine Intro-Ansage mit Cue", () => {
      const tl = build(training("strength"));
      const intros = tl.events.filter((e) => e.kind === "intro" && e.exerciseId !== undefined);
      expect(intros.length).toBeGreaterThan(0);
    });
  });
});
