import { describe, expect, it } from "vitest";
import type { ClipSpec } from "../../src/domain/cues";
import { hashClip, planClips, type ClipState, type VoiceConfig } from "./plan";

const voice: VoiceConfig = { voiceId: "v1", model: "m1", outputFormat: "mp3_44100_64", settings: { speed: 1.1 } };
const manifest: ClipSpec[] = [
  { id: "tech-jab", text: "Eins" },
  { id: "tech-lowkick", text: "Lowkick" },
  { id: "phrase-ready", text: "Bereit" },
];

const stateFor = (ids: string[], v: VoiceConfig = voice): ClipState =>
  Object.fromEntries(ids.map((id) => [id, { hash: hashClip(manifest.find((m) => m.id === id)!.text, v) }]));

const plan = (over: Partial<Parameters<typeof planClips>[0]> = {}) =>
  planClips({ manifest, overrides: {}, state: {}, existing: new Set(), voice, ...over });

describe("planClips", () => {
  it("plant alle Clips, wenn nichts existiert", () => {
    const p = plan();
    expect(p.generate.map((g) => g.id)).toEqual(["tech-jab", "tech-lowkick", "phrase-ready"]);
    expect(p.characters).toBe("Eins".length + "Lowkick".length + "Bereit".length);
  });

  it("überspringt aktuelle Clips", () => {
    const ids = ["tech-jab", "phrase-ready"];
    const p = plan({ existing: new Set(ids), state: stateFor(ids) });
    expect(p.upToDate).toEqual(ids);
    expect(p.generate.map((g) => g.id)).toEqual(["tech-lowkick"]);
  });

  it("erzeugt neu, wenn die Datei fehlt, obwohl der Stand sie kennt", () => {
    const p = plan({ existing: new Set(["tech-jab"]), state: stateFor(["tech-jab", "tech-lowkick"]) });
    expect(p.generate.map((g) => g.id)).toContain("tech-lowkick");
  });

  it("erzeugt neu, wenn sich der Text ändert", () => {
    const ids = manifest.map((m) => m.id);
    const changed = manifest.map((m) => (m.id === "tech-jab" ? { ...m, text: "Jab" } : m));
    const p = plan({ manifest: changed, existing: new Set(ids), state: stateFor(ids) });
    expect(p.generate.map((g) => g.id)).toEqual(["tech-jab"]);
  });

  it.each([
    ["Stimme", { ...voice, voiceId: "v2" }],
    ["Modell", { ...voice, model: "m2" }],
    ["Einstellungen", { ...voice, settings: { speed: 1.0 } }],
    ["Format", { ...voice, outputFormat: "mp3_44100_128" }],
  ])("erzeugt alles neu bei geänderter %s", (_name, other) => {
    const ids = manifest.map((m) => m.id);
    const p = plan({ voice: other, existing: new Set(ids), state: stateFor(ids) });
    expect(p.generate).toHaveLength(3);
  });

  it("force erzeugt auch aktuelle Clips neu", () => {
    const ids = manifest.map((m) => m.id);
    expect(plan({ existing: new Set(ids), state: stateFor(ids), force: true }).generate).toHaveLength(3);
  });

  it("only filtert nach ID-Präfix", () => {
    expect(plan({ only: ["tech-"] }).generate.map((g) => g.id)).toEqual(["tech-jab", "tech-lowkick"]);
    expect(plan({ only: ["phrase-ready", "tech-jab"] }).generate.map((g) => g.id)).toEqual(["tech-jab", "phrase-ready"]);
  });

  it("nutzt Aussprache-Overrides und lässt sie in den Hash einfließen", () => {
    const p = plan({ overrides: { "tech-lowkick": "Lou-Kick" } });
    const item = p.generate.find((g) => g.id === "tech-lowkick")!;
    expect(item.spoken).toBe("Lou-Kick");
    expect(item.text).toBe("Lowkick");
    expect(item.hash).toBe(hashClip("Lou-Kick", voice));
    expect(item.hash).not.toBe(hashClip("Lowkick", voice));
  });

  it("wirft bei Override für unbekannten Clip", () => {
    expect(() => plan({ overrides: { "tech-nope": "x" } })).toThrow(/unbekannten Clip/);
  });

  it("wirft bei leerem Text", () => {
    expect(() => plan({ manifest: [{ id: "a", text: "  " }] })).toThrow(/keinen Text/);
  });

  it("meldet verwaiste Dateien", () => {
    expect(plan({ existing: new Set(["old-clip", "tech-jab"]) }).orphans).toEqual(["old-clip"]);
  });
});
