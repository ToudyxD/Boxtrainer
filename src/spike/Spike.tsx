import { useCallback, useEffect, useRef, useState } from "react";
import { announceWavUrl, playAnnounce, playClapper, playGong } from "./sounds";

type OutputMode = "webaudio" | "element";
type AfterMode = "keep" | "suspend" | "close";

type AudioSessionType = "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record";

interface AudioSessionLike extends EventTarget {
  type: AudioSessionType;
  state?: string;
}

const getAudioSession = (): AudioSessionLike | undefined =>
  (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;

const isStandalone = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

interface LogEntry {
  at: string;
  text: string;
}

export function Spike() {
  const ctxRef = useRef<AudioContext | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const wakeSinceRef = useRef<number>(0);
  const roundRef = useRef<{ ctxStart: number; perfStart: number; length: number } | null>(null);

  const [log, setLog] = useState<LogEntry[]>([]);
  const [sessionType, setSessionType] = useState<AudioSessionType>("playback");
  const [wakeActive, setWakeActive] = useState(false);
  const [wakeSeconds, setWakeSeconds] = useState(0);
  const [roundLength, setRoundLength] = useState(180);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [ctxState, setCtxState] = useState("–");
  const [output, setOutput] = useState<OutputMode>("webaudio");
  const [after, setAfter] = useState<AfterMode>("keep");

  const addLog = useCallback((text: string) => {
    const at = new Date().toLocaleTimeString("de-DE");
    setLog((prev) => [{ at, text }, ...prev].slice(0, 80));
  }, []);

  const ensureCtx = useCallback((): AudioContext => {
    if (!ctxRef.current) {
      const ctx = new AudioContext();
      ctx.addEventListener("statechange", () => {
        setCtxState(ctx.state);
        addLog(`AudioContext: ${ctx.state}`);
      });
      ctxRef.current = ctx;
      setCtxState(ctx.state);
    }
    const ctx = ctxRef.current;
    if (ctx.state !== "running") void ctx.resume();
    return ctx;
  }, [addLog]);

  useEffect(() => {
    const onVisibility = () => addLog(`Sichtbarkeit: ${document.visibilityState}`);
    const onOnline = () => addLog("Netz: online");
    const onOffline = () => addLog("Netz: offline");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const session = getAudioSession();
    const onSessionState = () => addLog(`AudioSession-Status: ${session?.state ?? "?"}`);
    session?.addEventListener("statechange", onSessionState);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      session?.removeEventListener("statechange", onSessionState);
    };
  }, [addLog]);

  useEffect(() => {
    const session = getAudioSession();
    if (!session) return;
    session.type = sessionType;
    addLog(`AudioSession.type = ${session.type}`);
  }, [sessionType, addLog]);

  useEffect(() => {
    if (!wakeActive) return;
    const id = window.setInterval(() => setWakeSeconds(Math.floor((performance.now() - wakeSinceRef.current) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [wakeActive]);

  const toggleWake = useCallback(async () => {
    if (wakeRef.current) {
      await wakeRef.current.release();
      wakeRef.current = null;
      setWakeActive(false);
      return;
    }
    try {
      const lock = await navigator.wakeLock.request("screen");
      wakeRef.current = lock;
      wakeSinceRef.current = performance.now();
      setWakeSeconds(0);
      setWakeActive(true);
      addLog("Wake Lock aktiv");
      lock.addEventListener("release", () => {
        const held = Math.floor((performance.now() - wakeSinceRef.current) / 1000);
        addLog(`Wake Lock freigegeben nach ${fmt(held)}`);
        wakeRef.current = null;
        setWakeActive(false);
      });
    } catch (err) {
      addLog(`Wake Lock fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [addLog]);

  const playAnnouncement = useCallback(async () => {
    const label = `${output}, Typ ${sessionType}, danach ${after}`;
    if (output === "element") {
      const el = new Audio(announceWavUrl());
      el.addEventListener("ended", () => addLog("Element: Wiedergabe beendet"));
      try {
        await el.play();
        addLog(`Ansage über <audio> (${label})`);
      } catch (err) {
        addLog(`<audio> fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    const ctx = ensureCtx();
    playAnnounce(ctx, ctx.currentTime + 0.05);
    addLog(`Ansage über WebAudio (${label})`);
    if (after === "keep") return;

    window.setTimeout(() => {
      const finish = after === "suspend" ? ctx.suspend() : ctx.close();
      finish
        .then(() => {
          if (after === "close" && ctxRef.current === ctx) {
            ctxRef.current = null;
            setCtxState("closed");
          }
          addLog(`Context nach Ansage: ${after === "suspend" ? "suspendiert" : "geschlossen"}. Kommt die Musik zurück?`);
        })
        .catch((err: unknown) => addLog(`Context ${after} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`));
    }, 1800);
  }, [output, sessionType, after, ensureCtx, addLog]);

  const startRound = useCallback(() => {
    const ctx = ensureCtx();
    const lead = 1;
    const ctxStart = ctx.currentTime + lead;
    const perfStart = performance.now() + lead * 1000;
    const length = roundLength;
    roundRef.current = { ctxStart, perfStart, length };

    const gong = playGong(ctx, ctxStart);
    const clapperAt = ctxStart + Math.max(length - 10, 0);
    playClapper(ctx, clapperAt);
    const endGong = playGong(ctx, ctxStart + length);

    gong.onended = () => {
      const r = roundRef.current;
      if (!r) return;
      const driftMs = (ctx.currentTime - r.ctxStart) * 1000 - (performance.now() - r.perfStart);
      addLog(`Start-Gong beendet, Drift Audio↔Uhr ${driftMs.toFixed(1)} ms`);
    };
    endGong.onended = () => {
      const r = roundRef.current;
      if (!r) return;
      const ctxElapsed = ctx.currentTime - r.ctxStart;
      const perfElapsed = (performance.now() - r.perfStart) / 1000;
      const driftMs = (ctxElapsed - perfElapsed) * 1000;
      addLog(`Runde fertig: Audio ${ctxElapsed.toFixed(3)} s, Uhr ${perfElapsed.toFixed(3)} s, Drift ${driftMs.toFixed(1)} ms`);
      roundRef.current = null;
      setRemaining(null);
    };

    addLog(`Runde gestartet (${fmt(length)}), Klapper bei ${fmt(Math.max(length - 10, 0))}`);

    const tick = window.setInterval(() => {
      const r = roundRef.current;
      if (!r) {
        window.clearInterval(tick);
        return;
      }
      setRemaining(Math.max(r.length - (ctx.currentTime - r.ctxStart), 0));
    }, 200);
  }, [ensureCtx, roundLength, addLog]);

  const env: Array<[string, string]> = [
    ["Als PWA gestartet", isStandalone() ? "ja" : "nein"],
    ["Audio Session API", getAudioSession() ? "vorhanden" : "fehlt"],
    ["Wake Lock API", "wakeLock" in navigator ? "vorhanden" : "fehlt"],
    ["Service Worker aktiv", navigator.serviceWorker?.controller ? "ja" : "nein"],
    ["Netz", navigator.onLine ? "online" : "offline"],
    ["AudioContext", ctxState],
  ];

  return (
    <main>
      <h1>Phase 0: Durchstich</h1>

      <section>
        <h2>Umgebung</h2>
        <dl>
          {env.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2>Musik und Ansage</h2>
        <p>Spotify starten, dann Ansage abspielen. Verhalten notieren: abgesenkt, pausiert oder überlagert.</p>
        <label>
          Audio-Session-Typ
          <select value={sessionType} onChange={(e) => setSessionType(e.target.value as AudioSessionType)}>
            {["auto", "playback", "transient", "transient-solo", "ambient", "play-and-record"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Ausgabe
          <select value={output} onChange={(e) => setOutput(e.target.value as OutputMode)}>
            <option value="webaudio">WebAudio (wie die App)</option>
            <option value="element">&lt;audio&gt;-Element</option>
          </select>
        </label>
        <label>
          Nach der Ansage (nur WebAudio)
          <select value={after} onChange={(e) => setAfter(e.target.value as AfterMode)}>
            <option value="keep">Context weiterlaufen lassen</option>
            <option value="suspend">Context suspendieren</option>
            <option value="close">Context schließen</option>
          </select>
        </label>
        <div className="row">
          <button onClick={() => void playAnnouncement()}>Ansage</button>
          <button
            onClick={() => {
              const ctx = ensureCtx();
              playGong(ctx, ctx.currentTime + 0.05);
              addLog("Gong");
            }}
          >
            Gong
          </button>
          <button
            onClick={() => {
              const ctx = ensureCtx();
              playClapper(ctx, ctx.currentTime + 0.05);
              addLog("Klapper");
            }}
          >
            Klapper
          </button>
        </div>
      </section>

      <section>
        <h2>Wake Lock</h2>
        <div className="row">
          <button onClick={() => void toggleWake()}>{wakeActive ? "Freigeben" : "Anfordern"}</button>
          <span className="big">{wakeActive ? fmt(wakeSeconds) : "aus"}</span>
        </div>
      </section>

      <section>
        <h2>Runde auf AudioContext-Zeit</h2>
        <label>
          Länge
          <select value={roundLength} onChange={(e) => setRoundLength(Number(e.target.value))}>
            <option value={20}>20 s (Funktionstest)</option>
            <option value={180}>3 min</option>
            <option value={900}>15 min (Drift)</option>
            <option value={4500}>75 min (volle Einheit)</option>
          </select>
        </label>
        <div className="row">
          <button onClick={startRound} disabled={remaining !== null}>
            Runde starten
          </button>
          <span className="big">{remaining === null ? "–" : fmt(remaining)}</span>
        </div>
      </section>

      <section>
        <h2>Protokoll</h2>
        <p>Bei Anruf, Benachrichtigung und Bildschirmsperre hier nachsehen, welche Ereignisse eintreffen.</p>
        <ul className="log">
          {log.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <time>{e.at}</time> {e.text}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
