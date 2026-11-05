export interface Timed {
  rounds: number;
  roundSeconds: number;
  restSeconds: number;
  /** Eigene Rundenlänge je Übung; Runde r nutzt Eintrag r mod Länge. Ohne Angabe gilt roundSeconds. */
  exerciseSeconds?: readonly number[];
  /** Eigene Pause nach der Runde je Übung, parallel zu exerciseSeconds. */
  exerciseRest?: readonly number[];
}

export function roundSecondsAt(b: Pick<Timed, "roundSeconds" | "exerciseSeconds">, round: number): number {
  const list = b.exerciseSeconds;
  if (list === undefined || list.length === 0) return b.roundSeconds;
  return list[round % list.length] as number;
}

/** Pause nach Runde `round`. */
export function restSecondsAt(b: Pick<Timed, "restSeconds" | "exerciseRest">, round: number): number {
  const list = b.exerciseRest;
  if (list === undefined || list.length === 0) return b.restSeconds;
  return list[round % list.length] as number;
}

export function blockSeconds(b: Timed): number {
  let total = 0;
  for (let r = 0; r < b.rounds; r++) {
    total += roundSecondsAt(b, r);
    if (r < b.rounds - 1) total += restSecondsAt(b, r);
  }
  return total;
}
