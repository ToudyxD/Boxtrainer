import { useEffect, useState } from "react";
import { requestPersistentStorage } from "../repositories/dexie/db";
import { Spike } from "../spike/Spike";
import { ConfigScreen, type StartRequest } from "./ConfigScreen";
import { HistoryScreen } from "./HistoryScreen";
import { PlayerScreen } from "./PlayerScreen";

type Tab = "training" | "history" | "spike";

export function App() {
  const [tab, setTab] = useState<Tab>("training");
  const [request, setRequest] = useState<StartRequest | null>(null);

  useEffect(() => {
    requestPersistentStorage().catch(() => false);
  }, []);

  if (request) return <PlayerScreen request={request} onExit={() => setRequest(null)} />;

  return (
    <>
      <nav className="tabs">
        <button className={tab === "training" ? "active" : ""} onClick={() => setTab("training")}>
          Training
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          Verlauf
        </button>
        <button className={tab === "spike" ? "active" : ""} onClick={() => setTab("spike")}>
          Durchstich
        </button>
      </nav>
      {tab === "training" && <ConfigScreen onStart={setRequest} />}
      {tab === "history" && <HistoryScreen />}
      {tab === "spike" && <Spike />}
    </>
  );
}
