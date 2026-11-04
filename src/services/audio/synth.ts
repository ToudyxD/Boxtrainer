export interface Scheduled {
  node: AudioScheduledSourceNode;
  start: number;
}

function tone(
  ctx: AudioContext,
  out: AudioNode,
  when: number,
  freq: number,
  duration: number,
  gain: number,
  type: OscillatorType,
): Scheduled {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(gain, when + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(amp).connect(out);
  osc.start(when);
  osc.stop(when + duration + 0.05);
  return { node: osc, start: when };
}

export const GONG_SECONDS = 2.5;

export function gong(ctx: AudioContext, out: AudioNode, when: number): Scheduled[] {
  const partials: Array<[number, number, number]> = [
    [196, 0.5, GONG_SECONDS],
    [392, 0.3, GONG_SECONDS * 0.8],
    [587, 0.2, GONG_SECONDS * 0.8],
    [830, 0.12, GONG_SECONDS * 0.8],
  ];
  return partials.map(([freq, gain, len]) => tone(ctx, out, when, freq, len, gain, "sine"));
}

export function beep(ctx: AudioContext, out: AudioNode, when: number): Scheduled[] {
  return [tone(ctx, out, when, 880, 0.18, 0.4, "square")];
}

export function clapper(ctx: AudioContext, out: AudioNode, when: number): Scheduled[] {
  const scheduled: Scheduled[] = [];
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
    src.connect(amp).connect(out);
    src.start(t);
    scheduled.push({ node: src, start: t });
  }
  return scheduled;
}

/** Platzhalter für einen noch nicht vorhandenen Sprach-Clip. */
export function placeholder(ctx: AudioContext, out: AudioNode, when: number): Scheduled[] {
  return [tone(ctx, out, when, 520, 0.22, 0.3, "triangle")];
}

export const PLACEHOLDER_SECONDS = 0.3;
