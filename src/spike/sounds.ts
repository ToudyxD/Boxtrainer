function tone(ctx: AudioContext, when: number, freq: number, duration: number, gain: number, type: OscillatorType): void {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(gain, when + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + duration + 0.05);
}

export const GONG_SECONDS = 2.5;

/** Gong als Ersatz für den späteren Clip: Grundton plus Obertöne mit langem Ausklang. */
export function playGong(ctx: AudioContext, when: number): AudioScheduledSourceNode {
  const partials: Array<[number, number]> = [
    [196, 0.5],
    [392, 0.3],
    [587, 0.2],
    [830, 0.12],
  ];
  const first = ctx.createOscillator();
  const firstAmp = ctx.createGain();
  first.frequency.value = partials[0]![0];
  firstAmp.gain.setValueAtTime(0.0001, when);
  firstAmp.gain.exponentialRampToValueAtTime(partials[0]![1], when + 0.005);
  firstAmp.gain.exponentialRampToValueAtTime(0.0001, when + GONG_SECONDS);
  first.connect(firstAmp).connect(ctx.destination);
  first.start(when);
  first.stop(when + GONG_SECONDS + 0.05);

  for (const [freq, gain] of partials.slice(1)) tone(ctx, when, freq, GONG_SECONDS * 0.8, gain, "sine");
  return first;
}

/** Klapper: schnelle Folge kurzer Rauschimpulse. */
export function playClapper(ctx: AudioContext, when: number): void {
  for (let i = 0; i < 6; i++) {
    const t = when + i * 0.09;
    const len = Math.floor(ctx.sampleRate * 0.04);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let n = 0; n < len; n++) data[n] = (Math.random() * 2 - 1) * (1 - n / len);
    const src = ctx.createBufferSource();
    const amp = ctx.createGain();
    amp.gain.value = 0.8;
    src.buffer = buffer;
    src.connect(amp).connect(ctx.destination);
    src.start(t);
  }
}

/** Ansage-Ersatz: zwei kurze Töne, ungefähr so lang wie eine Kombi. */
export function playAnnounce(ctx: AudioContext, when: number): void {
  tone(ctx, when, 660, 0.25, 0.4, "triangle");
  tone(ctx, when + 0.35, 880, 0.25, 0.4, "triangle");
  tone(ctx, when + 0.7, 660, 0.25, 0.4, "triangle");
}
