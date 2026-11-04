export interface SpeechBounds {
  /** Beginn der Sprache in Sekunden (inklusive Vorlauf). */
  start: number;
  /** Ende der Sprache in Sekunden (inklusive Nachlauf). */
  end: number;
}

export interface TrimOptions {
  /** Amplitude (0..1), ab der Signal als Sprache gilt. */
  threshold?: number;
  padStartSeconds?: number;
  padEndSeconds?: number;
}

const DEFAULTS = { threshold: 0.01, padStartSeconds: 0.03, padEndSeconds: 0.06 };

/**
 * Findet Beginn und Ende der Sprache in einem Clip, damit führende und nachlaufende Stille
 * (TTS liefert pro Wort etwa eine halbe Sekunde davon) nicht mitgespielt wird.
 * Ein Clip ohne Signal über der Schwelle wird unverändert zurückgegeben.
 */
export function findSpeechBounds(channels: ReadonlyArray<ArrayLike<number>>, sampleRate: number, options: TrimOptions = {}): SpeechBounds {
  const { threshold, padStartSeconds, padEndSeconds } = { ...DEFAULTS, ...options };
  const length = Math.max(0, ...channels.map((c) => c.length));
  const duration = length / sampleRate;

  let first = -1;
  let last = -1;
  for (let i = 0; i < length; i++) {
    let loud = false;
    for (const channel of channels) {
      if (Math.abs(channel[i] ?? 0) >= threshold) {
        loud = true;
        break;
      }
    }
    if (!loud) continue;
    if (first === -1) first = i;
    last = i;
  }

  if (first === -1) return { start: 0, end: duration };
  return {
    start: Math.max(0, first / sampleRate - padStartSeconds),
    end: Math.min(duration, (last + 1) / sampleRate + padEndSeconds),
  };
}
