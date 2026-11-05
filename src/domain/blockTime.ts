export interface Timed {
  rounds: number;
  roundSeconds: number;
  restSeconds: number;
  /** Eigene Rundenlänge je Übung; Runde r nutzt Eintrag r mod Länge. Ohne Angabe gilt roundSeconds. */
  exerciseSeconds?: readonly number[];
}

export function roundSecondsAt(b: Pick<Timed, "roundSeconds" | "exerciseSeconds">, round: number): number {
  const list = b.exerciseSeconds;
  if (list === undefined || list.length === 0) return b.roundSeconds;
  return list[round % list.length] as number;
}

export function blockSeconds(b: Timed): number {
  let work = 0;
  for (let r = 0; r < b.rounds; r++) work += roundSecondsAt(b, r);
  return work + Math.max(b.rounds - 1, 0) * b.restSeconds;
}
