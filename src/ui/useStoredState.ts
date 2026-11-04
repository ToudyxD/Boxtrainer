import { useCallback, useState } from "react";

/** Wie useState, speichert aber best effort in localStorage (kann in privaten Fenstern fehlen). */
export function useStoredState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : ({ ...initial, ...JSON.parse(raw) } as T);
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        return;
      }
    },
    [key],
  );

  return [value, set];
}
