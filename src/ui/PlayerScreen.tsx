import { useEffect, useRef, useState } from "react";
import { loadLibrary } from "../content";
import type { PlayerSnapshot } from "../domain/player";
import { PlayerSession, type BeginResult } from "../services/playerSession";
import { getSessionService } from "../services/appServices";
import type { StartRequest } from "./ConfigScreen";
import { SessionLogForm } from "./SessionLogForm";

const fmt = (seconds: number): string => {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type Phase = "ready" | "loading" | "running" | "error";

export function PlayerScreen({ request, onExit }: { request: StartRequest; onExit: () => void }) {
  const sessionRef = useRef<PlayerSession | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [info, setInfo] = useState<BeginResult | null>(null);
  const [error, setError] = useState<string>("");
  const [snap, setSnap] = useState<PlayerSnapshot | undefined>();
  const [confirmAbort, setConfirmAbort] = useState(false);

  useEffect(
    () => () => {
      void sessionRef.current?.dispose();
    },
    [],
  );

  const begin = async (): Promise<void> => {
    const session = new PlayerSession({ ...request, library: loadLibrary() });
    sessionRef.current = session;
    session.subscribe(setSnap);
    setPhase("loading");
    try {
      setInfo(await session.begin((done, total) => setProgress([done, total])));
      setPhase("running");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const session = sessionRef.current;

  if (phase === "ready") {
    return (
      <main className="player center">
        <h1>Bereit?</h1>
        <p>Handy hinlegen, Lautstärke prüfen. Während der Runden brauchst du das Display nicht zu berühren.</p>
        <button className="huge" onClick={() => void begin()}>
          Los
        </button>
        <button className="ghost" onClick={onExit}>
          Zurück
        </button>
      </main>
    );
  }

  if (phase === "loading") {
    return (
      <main className="player center">
        <h1>Lade Ansagen</h1>
        <p>
          {progress[0]} / {progress[1]}
        </p>
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main className="player center">
        <h1>Start fehlgeschlagen</h1>
        <p className="error">{error}</p>
        <button onClick={onExit}>Zurück</button>
      </main>
    );
  }

  if (!snap || !session) return <main className="player center" />;

  if (snap.status === "finished" || snap.status === "aborted") {
    const result = session.result();
    const finished = snap.status === "finished";
    if (result.completedBlockIds.length === 0) {
      return (
        <main className="player center">
          <h1>Abgebrochen</h1>
          <p>Kein Block abgeschlossen, nichts zu speichern.</p>
          <button className="huge" onClick={onExit}>
            Fertig
          </button>
        </main>
      );
    }
    return (
      <SessionLogForm
        title={finished ? "Geschafft" : "Abgebrochen"}
        summary={`${fmt(result.actualSeconds)} Gesamtzeit, ${result.completedBlockIds.length} von ${request.training.blocks.length} Blöcken abgeschlossen.`}
        onSave={async (rpe, note) => {
          await getSessionService().record({ training: request.training, ...result, rpe, note });
          onExit();
        }}
        onDiscard={onExit}
      />
    );
  }

  const paused = snap.status === "paused";
  const awaiting = snap.status === "awaiting-confirm";
  const label =
    snap.segmentKind === "transition" ? "Gleich geht's los" : snap.segmentKind === "rest" ? "Pause" : snap.blockLabel;

  return (
    <main className="player">
      <header>
        <span>{label}</span>
        <span>
          Runde {Math.min(snap.round, snap.rounds)} von {snap.rounds}
        </span>
      </header>

      <div className="time">{fmt(snap.remaining)}</div>
      <div className="now">{snap.text ?? " "}</div>
      <div className="next">{snap.upNext ?? " "}</div>

      {info && info.missing.length > 0 && (
        <p className="warn">
          {info.missing.length} Clips fehlen, an ihrer Stelle klingen Platzhaltertöne.
        </p>
      )}
      {info?.wakeLockError && <p className="warn">Bildschirm bleibt evtl. nicht an: {info.wakeLockError}</p>}

      {(awaiting || snap.repBased) && !paused && (
        <button className="huge" onClick={() => session.confirmSet()}>
          Satz fertig
        </button>
      )}

      <div className="controls">
        {paused ? (
          <button className="huge" onClick={() => session.resume()}>
            Weiter
          </button>
        ) : (
          <button className="huge" onClick={() => session.pause()}>
            Pause
          </button>
        )}
        <button className="big" onClick={() => session.skip()}>
          Überspringen
        </button>
        {confirmAbort ? (
          <button className="big danger" onClick={() => void session.abort()}>
            Wirklich abbrechen
          </button>
        ) : (
          <button className="big ghost" onClick={() => setConfirmAbort(true)}>
            Abbruch
          </button>
        )}
      </div>

      <progress value={snap.position} max={snap.total} />
    </main>
  );
}
