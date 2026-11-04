import { createHash } from "node:crypto";
import type { ClipSpec } from "../../src/domain/cues";

export interface VoiceConfig {
  voiceId: string;
  model: string;
  outputFormat: string;
  settings: Record<string, unknown>;
}

export type ClipState = Record<string, { hash: string }>;

export interface PlanItem {
  id: string;
  text: string;
  spoken: string;
  hash: string;
}

export interface Plan {
  generate: PlanItem[];
  upToDate: string[];
  orphans: string[];
  characters: number;
}

export interface PlanInput {
  manifest: readonly ClipSpec[];
  overrides: Readonly<Record<string, string>>;
  state: Readonly<ClipState>;
  existing: ReadonlySet<string>;
  voice: VoiceConfig;
  force?: boolean;
  only?: readonly string[];
}

export function hashClip(spoken: string, voice: VoiceConfig): string {
  const payload = JSON.stringify([spoken, voice.voiceId, voice.model, voice.outputFormat, voice.settings]);
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function planClips(input: PlanInput): Plan {
  const ids = new Set(input.manifest.map((m) => m.id));
  const unknownOverride = Object.keys(input.overrides).find((id) => !ids.has(id));
  if (unknownOverride !== undefined) throw new Error(`Aussprache-Override für unbekannten Clip "${unknownOverride}"`);

  const generate: PlanItem[] = [];
  const upToDate: string[] = [];

  for (const spec of input.manifest) {
    if (input.only && input.only.length > 0 && !input.only.some((prefix) => spec.id.startsWith(prefix))) continue;

    const spoken = (input.overrides[spec.id] ?? spec.text).trim();
    if (spoken === "") throw new Error(`Clip "${spec.id}" hat keinen Text`);
    const hash = hashClip(spoken, input.voice);

    const current = input.existing.has(spec.id) && input.state[spec.id]?.hash === hash;
    if (current && !input.force) upToDate.push(spec.id);
    else generate.push({ id: spec.id, text: spec.text, spoken, hash });
  }

  return {
    generate,
    upToDate,
    orphans: [...input.existing].filter((id) => !ids.has(id)).sort(),
    characters: generate.reduce((sum, item) => sum + item.spoken.length, 0),
  };
}
