import { useState } from "react";
import { Spike } from "../spike/Spike";
import { ConfigScreen, type StartRequest } from "./ConfigScreen";
import { PlayerScreen } from "./PlayerScreen";

type Tab = "training" | "spike";

export function App() {
  const [tab, setTab] = useState<Tab>("training");
  const [request, setRequest] = useState<StartRequest | null>(null);

  if (request) return <PlayerScreen request={request} onExit={() => setRequest(null)} />;

  return (
    <>
      <nav className="tabs">
        <button className={tab === "training" ? "active" : ""} onClick={() => setTab("training")}>
          Training
        </button>
        <button className={tab === "spike" ? "active" : ""} onClick={() => setTab("spike")}>
          Durchstich
        </button>
      </nav>
      {tab === "training" ? <ConfigScreen onStart={setRequest} /> : <Spike />}
    </>
  );
}
