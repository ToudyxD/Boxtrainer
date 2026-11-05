import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadLibrary } from "../content";
import { trainingSeconds } from "../domain/generator";
import type { PlayerSnapshot } from "../domain/player";
import { trainingLabel } from "../domain/templates";
import { PlayerSession, type BeginResult } from "../services/playerSession";
import { getSessionService } from "../services/appServices";
import { fmtDuration } from "./blockStyle";
import type { StartRequest } from "./ConfigScreen";
import { SessionLogForm } from "./SessionLogForm";

const fmt = (seconds: number): string => {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const MAX_DOTS = 12;

type Phase = "ready" | "loading" | "running" | "error";
type Look = "ready" | "work" | "rest" | "paused" | "done";

function Stage({ look, children }: { look: Look; children: ReactNode }) {
  return (
    <div className="stage" data-phase={look}>
      {children}
    </div>
  );
}

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
    const { training } = request;
    return (
      <Stage look="ready">
        <main className="player center">
          <h1>Bereit?</h1>
          <p className="summary-line">
            {trainingLabel(training)}, {fmtDuration(trainingSeconds(training))}, {training.blocks.length}{" "}
            {training.blocks.length === 1 ? "Block" : "Blöcke"}
          </p>
          <p>Handy hinlegen, Lautstärke prüfen. Während der Runden brauchst du das Display nicht zu berühren.</p>
          <button className="pbtn solid huge" onClick={() => void begin()}>
            Los
          </button>
          <button className="pbtn" onClick={onExit}>
            Zurück
          </button>
        </main>
      </Stage>
    );
  }

  if (phase === "loading") {
    return (
      <Stage look="ready">
        <main className="player center">
          <h1>Lade Ansagen</h1>
          <p>
            {progress[0]} von {progress[1]}
          </p>
        </main>
      </Stage>
    );
  }

  if (phase === "error") {
    return (
      <Stage look="ready">
        <main className="player center">
          <h1>Start fehlgeschlagen</h1>
          <p>{error}</p>
          <button className="pbtn solid" onClick={onExit}>
            Zurück
          </button>
        </main>
      </Stage>
    );
  }

  if (!snap || !session) return <Stage look="ready"><main className="player center" /></Stage>;

  if (snap.status === "finished" || snap.status === "aborted") {
    const result = session.result();
    const finished = snap.status === "finished";
    if (result.completedBlockIds.length === 0) {
      return (
        <Stage look="done">
          <main className="player center">
            <h1>Abgebrochen</h1>
            <p>Kein Block abgeschlossen, nichts zu speichern.</p>
            <button className="huge" onClick={onExit}>
              Fertig
            </button>
          </main>
        </Stage>
      );
    }
    return (
      <Stage look="done">
        <SessionLogForm
          title={finished ? "Geschafft" : "Abgebrochen"}
          summary={`${fmt(result.actualSeconds)} Gesamtzeit, ${result.completedBlockIds.length} von ${request.training.blocks.length} Blöcken abgeschlossen.`}
          onSave={async (rpe, note) => {
            await getSessionService().record({ training: request.training, ...result, rpe, note });
            onExit();
          }}
          onDiscard={onExit}
        />
      </Stage>
    );
  }

  const paused = snap.status === "paused";
  const awaiting = snap.status === "awaiting-confirm";
  const label =
    snap.segmentKind === "transition" ? "Gleich geht's los" : snap.segmentKind === "rest" ? "Pause" : snap.blockLabel;
  const look: Look = paused ? "paused" : snap.segmentKind === "rest" ? "rest" : snap.segmentKind === "transition" ? "ready" : "work";
  const round = Math.min(snap.round, snap.rounds);

  return (
    <Stage look={look}>
      <div className="bar" aria-hidden="true">
        <i style={{ width: `${snap.total > 0 ? (snap.position / snap.total) * 100 : 0}%` }} />
      </div>
      <main className="player">
        <div className="player-top">
          <span className="phase-label">{paused ? `${label}, pausiert` : label}</span>
          <span className="round-count">
            Runde {round} von {snap.rounds}
          </span>
        </div>
        {snap.rounds > 1 && snap.rounds <= MAX_DOTS && (
          <div className="dots" aria-hidden="true">
            {Array.from({ length: snap.rounds }, (_, n) => (
              <i key={n} className={n + 1 < round ? "done" : n + 1 === round ? "current" : ""} />
            ))}
          </div>
        )}

        <div className="time" role="timer" aria-label="Restzeit">
          {fmt(snap.remaining)}
        </div>
        <div className="now">{snap.text ?? " "}</div>
        <div className="next">{snap.upNext ?? " "}</div>

        {info && info.missing.length > 0 && (
          <p className="warn">{info.missing.length} Clips fehlen, an ihrer Stelle klingen Platzhaltertöne.</p>
        )}
        {info?.wakeLockError && <p className="warn">Bildschirm bleibt evtl. nicht an: {info.wakeLockError}</p>}

        <div className="controls">
          {(awaiting || snap.repBased) && !paused && (
            <button className="pbtn solid huge" onClick={() => session.confirmSet()}>
              Satz fertig
            </button>
          )}
          {paused ? (
            <button className="pbtn solid huge" onClick={() => session.resume()}>
              Weiter
            </button>
          ) : (
            <button className="pbtn huge" onClick={() => session.pause()}>
              Anhalten
            </button>
          )}
          <div className="controls-row">
            <button className="pbtn" onClick={() => session.skip()}>
              Überspringen
            </button>
            {confirmAbort ? (
              <button className="pbtn danger" onClick={() => void session.abort()}>
                Wirklich abbrechen
              </button>
            ) : (
              <button className="pbtn" onClick={() => setConfirmAbort(true)}>
                Abbruch
              </button>
            )}
          </div>
        </div>
      </main>
    </Stage>
  );
}
