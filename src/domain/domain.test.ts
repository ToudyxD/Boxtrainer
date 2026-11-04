import { describe, expect, it } from "vitest";
import techniquesJson from "../content/techniques.json";
import { ContentError, comboAnnouncement, validateCombos, validateTechniques } from "./content";
import type { Combo, Technique } from "./models";
import { createRng } from "./rng";

const techniques = techniquesJson as Technique[];

const combo = (id: string, techniqueIds: string[], level: 1 | 2 | 3 = 3): Combo => ({
  id,
  techniqueIds,
  styles: ["kickboxing"],
  level,
  themes: [],
});

describe("rng", () => {
  it("liefert bei gleichem Seed dieselbe Folge", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });

  it("int bleibt in den Grenzen", () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });

  it("shuffle erhält alle Elemente", () => {
    const out = createRng(7).shuffle([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("pick auf leerer Liste wirft", () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });
});

describe("techniken-katalog", () => {
  it("ist gültig", () => {
    expect(() => validateTechniques(techniques)).not.toThrow();
  });

  it("enthält 26 Techniken", () => {
    expect(techniques).toHaveLength(26);
  });

  it("lehnt doppelte IDs ab", () => {
    const first = techniques[0] as Technique;
    expect(() => validateTechniques([first, first])).toThrow(ContentError);
  });
});

describe("kombis", () => {
  it("validiert bekannte Techniken", () => {
    expect(() => validateCombos([combo("c1", ["jab", "cross", "lowkick"])], techniques)).not.toThrow();
  });

  it("lehnt unbekannte Techniken ab", () => {
    expect(() => validateCombos([combo("c1", ["nope"])], techniques)).toThrow(ContentError);
  });

  it("lehnt Kombi mit niedrigerem Level als Technik ab", () => {
    expect(() => validateCombos([combo("c1", ["head-kick"], 1)], techniques)).toThrow(ContentError);
  });

  it("lehnt Kickbox-Technik in Box-Kombi ab", () => {
    const c: Combo = { ...combo("c1", ["lowkick"]), styles: ["boxing"] };
    expect(() => validateCombos([c], techniques)).toThrow(ContentError);
  });
});

describe("ansagetext", () => {
  it.each([
    [["jab", "cross", "lowkick"], "Eins-zwei, Lowkick"],
    [["teep", "jab", "cross"], "Teep, eins-zwei"],
    [["slip", "cross", "lead-hook", "cross"], "Slip, zwei-drei-zwei"],
    [["check", "cross", "body-kick"], "Check, zwei, Body Kick"],
  ])("%j -> %s", (ids, expected) => {
    expect(comboAnnouncement(combo("c", ids), techniques)).toBe(expected);
  });
});
