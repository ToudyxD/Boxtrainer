import { useEffect, useState, type ReactNode } from "react";
import { requestPersistentStorage } from "../repositories/dexie/db";
import { Spike } from "../spike/Spike";
import { ConfigScreen, type StartRequest } from "./ConfigScreen";
import { HistoryScreen } from "./HistoryScreen";
import { PlayerScreen } from "./PlayerScreen";
import { SettingsProvider } from "./SettingsContext";
import { SettingsScreen } from "./SettingsScreen";

type Tab = "training" | "history" | "settings" | "spike";

const ICONS: Record<Tab, ReactNode> = {
  training: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 13.5V9.5M9.5 2.5h5M18.5 6l1.5-1.5" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h9M19 7h1M4 17h1M11 17h9" />
      <circle cx="16" cy="7" r="2.2" />
      <circle cx="8" cy="17" r="2.2" />
    </svg>
  ),
  spike: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h2M7.5 7v10M12 4v16M16.5 8v8M21 11v2" />
    </svg>
  ),
};

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "training", label: "Training" },
  { id: "history", label: "Verlauf" },
  { id: "settings", label: "Einstellungen" },
  { id: "spike", label: "Durchstich" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("training");
  const [request, setRequest] = useState<StartRequest | null>(null);

  useEffect(() => {
    requestPersistentStorage().catch(() => false);
  }, []);

  if (request) return <PlayerScreen request={request} onExit={() => setRequest(null)} />;

  return (
    <SettingsProvider>
      <div className="screen">
        <div hidden={tab !== "training"}>
          <ConfigScreen onStart={setRequest} onOpenSettings={() => setTab("settings")} />
        </div>
        {tab === "history" && <HistoryScreen />}
        {tab === "settings" && <SettingsScreen />}
        {tab === "spike" && <Spike />}
      </div>
      <nav className="tabbar" aria-label="Hauptnavigation">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            {ICONS[t.id]}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </SettingsProvider>
  );
}
