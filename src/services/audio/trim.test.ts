import { describe, expect, it } from "vitest";
import { findSpeechBounds } from "./trim";

const RATE = 1000;

/** Baut ein Signal aus Sekunden Stille, Sprache und Stille. */
function clip(lead: number, speech: number, tail: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round((lead + speech + tail) * RATE));
  for (let i = Math.round(lead * RATE); i < Math.round((lead + speech) * RATE); i++) out[i] = amplitude * (i % 2 ? 1 : -1);
  return out;
}

describe("findSpeechBounds", () => {
  it("schneidet führende und nachlaufende Stille ab und lässt kleine Ränder stehen", () => {
    const b = findSpeechBounds([clip(0.3, 0.4, 0.3)], RATE, { padStartSeconds: 0.03, padEndSeconds: 0.06 });
    expect(b.start).toBeCloseTo(0.27, 3);
    expect(b.end).toBeCloseTo(0.76, 3);
  });

  it("verkürzt einen typischen TTS-Clip (0,9 s) auf etwa die Sprachlänge", () => {
    const b = findSpeechBounds([clip(0.25, 0.35, 0.3)], RATE);
    expect(b.end - b.start).toBeLessThan(0.5);
    expect(b.end - b.start).toBeGreaterThan(0.35);
  });

  it("begrenzt die Ränder auf den Clip", () => {
    const b = findSpeechBounds([clip(0, 0.5, 0)], RATE, { padStartSeconds: 0.1, padEndSeconds: 0.1 });
    expect(b.start).toBe(0);
    expect(b.end).toBeCloseTo(0.5, 5);
  });

  it("gibt einen stillen Clip unverändert zurück", () => {
    const b = findSpeechBounds([new Float32Array(2000)], RATE);
    expect(b).toEqual({ start: 0, end: 2 });
  });

  it("ignoriert Rauschen unter der Schwelle", () => {
    const b = findSpeechBounds([clip(0.2, 0.3, 0.2, 0.005)], RATE, { threshold: 0.01 });
    expect(b).toEqual({ start: 0, end: 0.7 });
  });

  it("berücksichtigt alle Kanäle", () => {
    const quiet = clip(0.1, 0.1, 0.4, 0);
    const loud = clip(0.4, 0.1, 0.1);
    const b = findSpeechBounds([quiet, loud], RATE, { padStartSeconds: 0, padEndSeconds: 0 });
    expect(b.start).toBeCloseTo(0.4, 3);
    expect(b.end).toBeCloseTo(0.5, 3);
  });

  it("erkennt auch sehr kurze Signale", () => {
    const samples = new Float32Array(1000);
    samples[500] = 0.9;
    const b = findSpeechBounds([samples], RATE, { padStartSeconds: 0, padEndSeconds: 0 });
    expect(b.start).toBeCloseTo(0.5, 3);
    expect(b.end).toBeCloseTo(0.501, 3);
  });
});
