import { BODY_AREA_GROUP } from "./bodyAreas";
import type { Combo, Exercise, Technique } from "./models";

export class ContentError extends Error {}

export function validateTechniques(techniques: readonly Technique[]): void {
  const ids = new Set<string>();
  const announces = new Set<string>();
  const numbers = new Set<number>();

  for (const t of techniques) {
    if (ids.has(t.id)) throw new ContentError(`Doppelte Technik-ID: ${t.id}`);
    ids.add(t.id);

    const key = t.announce.toLowerCase();
    if (announces.has(key)) throw new ContentError(`Doppelte Ansage: ${t.announce}`);
    announces.add(key);

    if (t.styles.length === 0) throw new ContentError(`Technik ${t.id} ohne Stil`);

    if (t.punchNumber !== undefined) {
      if (t.category !== "punch") throw new ContentError(`Technik ${t.id}: Nummer nur bei Schlägen`);
      if (numbers.has(t.punchNumber)) throw new ContentError(`Doppelte Schlagnummer: ${t.punchNumber}`);
      numbers.add(t.punchNumber);
    }
  }
}

export function validateCombos(combos: readonly Combo[], techniques: readonly Technique[]): void {
  const byId = new Map(techniques.map((t) => [t.id, t]));
  const ids = new Set<string>();

  for (const c of combos) {
    if (ids.has(c.id)) throw new ContentError(`Doppelte Kombi-ID: ${c.id}`);
    ids.add(c.id);
    if (c.techniqueIds.length === 0) throw new ContentError(`Kombi ${c.id} ist leer`);

    for (const tid of c.techniqueIds) {
      const t = byId.get(tid);
      if (!t) throw new ContentError(`Kombi ${c.id}: unbekannte Technik ${tid}`);
      if (t.level > c.level) throw new ContentError(`Kombi ${c.id}: Technik ${tid} hat höheres Level als die Kombi`);
      if (!c.styles.every((s) => t.styles.includes(s))) {
        throw new ContentError(`Kombi ${c.id}: Technik ${tid} passt nicht zu den Stilen der Kombi`);
      }
    }
  }
}

/** Nummerierte Schläge in Folge werden verbunden ("Eins-zwei"), alles andere mit Komma getrennt. */
export function comboAnnouncement(combo: Combo, techniques: readonly Technique[]): string {
  const byId = new Map(techniques.map((t) => [t.id, t]));
  const parts: string[] = [];
  let numbered: string[] = [];

  const flush = (): void => {
    if (numbered.length > 0) parts.push(numbered.join("-"));
    numbered = [];
  };

  for (const tid of combo.techniqueIds) {
    const t = byId.get(tid);
    if (!t) throw new ContentError(`Unbekannte Technik ${tid}`);
    if (t.punchNumber !== undefined) {
      const atStart = parts.length === 0 && numbered.length === 0;
      numbered.push(atStart ? t.announce : t.announce.toLowerCase());
    } else {
      flush();
      parts.push(t.announce);
    }
  }
  flush();
  return parts.join(", ");
}

export function validateExercises(exercises: readonly Exercise[]): void {
  const ids = new Set<string>();
  for (const e of exercises) {
    if (ids.has(e.id)) throw new ContentError(`Doppelte Übungs-ID: ${e.id}`);
    ids.add(e.id);
    if (e.cues.length < 2 || e.cues.length > 3) throw new ContentError(`Übung ${e.id}: 2 bis 3 Cues erwartet`);
    if (e.styles.length === 0) throw new ContentError(`Übung ${e.id} ohne Stil`);
    if (!Array.isArray(e.bodyAreas) || e.bodyAreas.length === 0) throw new ContentError(`Übung ${e.id} ohne Körperbereich`);
    const unknown = e.bodyAreas.find((a) => !(a in BODY_AREA_GROUP));
    if (unknown !== undefined) throw new ContentError(`Übung ${e.id}: unbekannter Körperbereich "${unknown}"`);
    if (new Set(e.bodyAreas).size !== e.bodyAreas.length) throw new ContentError(`Übung ${e.id}: doppelter Körperbereich`);
    if (e.bodyAreas.includes("full-body") && e.bodyAreas.length > 1) {
      throw new ContentError(`Übung ${e.id}: "full-body" nicht mit anderen Bereichen kombinieren`);
    }
  }
}
