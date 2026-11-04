/**
 * Erzeugt die Sprach-Clips der App über ElevenLabs.
 *
 *   npm run clips -- --dry-run                 zeigt, was erzeugt würde, ohne Anfrage
 *   npm run clips -- --list-voices [--search x] listet verfügbare Stimmen
 *   npm run clips -- --only tech-lowkick,count  erzeugt nur Clips mit diesen ID-Präfixen
 *   npm run clips                               erzeugt alle fehlenden oder geänderten Clips
 *   npm run clips -- --force                    erzeugt alles neu
 *
 * Konfiguration über .env.local (siehe .env.example); der API-Key wird nie ausgegeben.
 */
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadLibrary } from "../src/content";
import { buildClipManifest } from "../src/domain/cues";
import { planClips, type ClipState, type PlanItem, type VoiceConfig } from "./lib/plan";

const API = "https://api.elevenlabs.io";
const AUDIO_DIR = join(import.meta.dirname, "..", "public", "audio");
const STATE_FILE = join(AUDIO_DIR, "clips.json");
const OVERRIDES_FILE = join(import.meta.dirname, "..", "src", "content", "clip-overrides.json");
const CONCURRENCY = 2;
const MAX_RETRIES = 6;
const LONG_CLIP_SECONDS = 6;

class FatalApiError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} fehlt. In .env.local eintragen (Vorlage: .env.example).`);
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} ist keine Zahl: ${raw}`);
  return value;
}

function voiceConfig(voiceId: string): VoiceConfig {
  return {
    voiceId,
    model: process.env["ELEVENLABS_MODEL"]?.trim() || "eleven_multilingual_v2",
    outputFormat: process.env["ELEVENLABS_FORMAT"]?.trim() || "mp3_44100_64",
    settings: {
      stability: numberEnv("ELEVENLABS_STABILITY", 0.45),
      similarity_boost: numberEnv("ELEVENLABS_SIMILARITY", 0.8),
      style: 0,
      use_speaker_boost: true,
      speed: numberEnv("ELEVENLABS_SPEED", 1.1),
    },
  };
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return fallback;
    throw new Error(`${path} nicht lesbar: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function apiError(res: Response): Promise<string> {
  const body = (await res.text()).slice(0, 300);
  return `HTTP ${res.status}${body ? `: ${body}` : ""}`;
}

async function listVoices(key: string, search: string | undefined): Promise<void> {
  const url = new URL("/v2/voices", API);
  url.searchParams.set("page_size", "100");
  if (search) url.searchParams.set("search", search);
  const res = await fetch(url, { headers: { "xi-api-key": key } });
  if (res.status === 401) throw new Error("API-Key ungültig (401)");
  if (!res.ok) throw new Error(`Stimmenliste fehlgeschlagen: ${await apiError(res)}`);

  const data = (await res.json()) as { voices?: Array<{ voice_id: string; name: string; category?: string; labels?: Record<string, string> }> };
  for (const v of data.voices ?? []) {
    const labels = Object.values(v.labels ?? {}).join(", ");
    console.log(`${v.voice_id}  ${v.name.padEnd(24)} ${(v.category ?? "").padEnd(10)} ${labels}`);
  }
  console.log(`\n${data.voices?.length ?? 0} Stimmen. ID in .env.local als ELEVENLABS_VOICE_ID eintragen.`);
}

async function synthesize(key: string, voice: VoiceConfig, text: string): Promise<Buffer> {
  const url = `${API}/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}?output_format=${voice.outputFormat}`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: voice.model, voice_settings: voice.settings }),
    });

    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 401) throw new FatalApiError("API-Key ungültig (401)");
    if (res.status === 402) {
      throw new FatalApiError(`Stimme oder Funktion braucht einen bezahlten Tarif (402). ${await apiError(res)}`);
    }
    if (res.status === 404) throw new FatalApiError(`Stimme "${voice.voiceId}" nicht gefunden (404)`);
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await sleep(Math.min(2 ** attempt, 60) * 1000);
      continue;
    }
    throw new Error(await apiError(res));
  }
}

const LOCK_ERRORS = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Schreibt über eine temporäre Datei; wiederholt kurz, wenn Windows die Zieldatei gerade sperrt. */
async function writeAtomic(path: string, data: Buffer | string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String(err.code) : "";
      if (!LOCK_ERRORS.has(code) || attempt >= 8) throw err;
      await sleep(150 * (attempt + 1));
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      "list-voices": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      only: { type: "string" },
      search: { type: "string" },
    },
  });

  if (values["list-voices"]) {
    await listVoices(requireEnv("ELEVENLABS_API_KEY"), values.search);
    return;
  }

  await mkdir(AUDIO_DIR, { recursive: true });
  const manifest = buildClipManifest(loadLibrary());
  const overrides = await readJson<Record<string, string>>(OVERRIDES_FILE, {});
  const state = await readJson<{ clips: ClipState }>(STATE_FILE, { clips: {} });
  const existing = new Set(
    (await readdir(AUDIO_DIR)).filter((f) => f.endsWith(".mp3")).map((f) => f.slice(0, -".mp3".length)),
  );

  const voiceId = values["dry-run"] ? (process.env["ELEVENLABS_VOICE_ID"]?.trim() ?? "dry-run") : requireEnv("ELEVENLABS_VOICE_ID");
  const voice = voiceConfig(voiceId);
  const only = values.only?.split(",").map((s) => s.trim()).filter(Boolean);
  const plan = planClips({ manifest, overrides, state: state.clips, existing, voice, force: values.force, ...(only ? { only } : {}) });

  const credits = voice.model.includes("flash") || voice.model.includes("turbo") ? plan.characters / 2 : plan.characters;
  console.log(
    `${manifest.length} Clips im Manifest: ${plan.upToDate.length} aktuell, ${plan.generate.length} zu erzeugen ` +
      `(${plan.characters} Zeichen, ca. ${Math.round(credits)} Credits, Modell ${voice.model}).`,
  );
  if (plan.orphans.length > 0) console.log(`Verwaiste Dateien (nicht im Manifest): ${plan.orphans.join(", ")}`);
  if (values["dry-run"] || plan.generate.length === 0) return;

  const key = requireEnv("ELEVENLABS_API_KEY");
  const clips: ClipState = { ...state.clips };
  const kbps = Number(voice.outputFormat.split("_").at(-1)) || 64;
  const queue = [...plan.generate];
  const failures: Array<{ id: string; message: string }> = [];
  const longClips: string[] = [];
  let fatal: FatalApiError | undefined;
  let done = 0;
  let saving: Promise<void> = Promise.resolve();

  const persistState = (): Promise<void> => {
    const snapshot = JSON.stringify({ voiceId: voice.voiceId, model: voice.model, clips }, null, 2);
    const write = saving.then(() => writeAtomic(STATE_FILE, snapshot));
    saving = write.catch(() => undefined);
    return write;
  };

  const worker = async (): Promise<void> => {
    for (let item: PlanItem | undefined = queue.shift(); item && !fatal; item = queue.shift()) {
      try {
        const audio = await synthesize(key, voice, item.spoken);
        await writeAtomic(join(AUDIO_DIR, `${item.id}.mp3`), audio);
        clips[item.id] = { hash: item.hash };
        await persistState();
        if ((audio.length * 8) / (kbps * 1000) > LONG_CLIP_SECONDS) longClips.push(item.id);
        console.log(`[${++done}/${plan.generate.length}] ${item.id}  "${item.spoken}"`);
      } catch (err) {
        if (err instanceof FatalApiError) {
          fatal = err;
          return;
        }
        failures.push({ id: item.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await persistState();

  if (longClips.length > 0) console.log(`Auffallend lange Clips (> ${LONG_CLIP_SECONDS} s): ${longClips.join(", ")}`);
  if (fatal) throw fatal;
  if (failures.length > 0) {
    for (const f of failures) console.error(`FEHLER ${f.id}: ${f.message}`);
    throw new Error(`${failures.length} von ${plan.generate.length} Clips fehlgeschlagen; erneut ausführen setzt fort.`);
  }
  console.log("Fertig. Clips liegen in public/audio/ und sind mit dem nächsten Build in der App.");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
