import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Settings } from "../domain/settings";
import { getSettingsService } from "../services/appServices";

interface SettingsState {
  settings: Settings;
  /** Fehler beim Laden; dann gilt die Vorbelegung, bis neu gespeichert wird. */
  loadError: string;
  save: (next: Settings) => Promise<void>;
}

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState<{ settings: Settings; loadError: string } | null>(null);

  useEffect(() => {
    const service = getSettingsService();
    service
      .load()
      .then(({ settings }) => setLoaded({ settings, loadError: "" }))
      .catch((err: unknown) =>
        setLoaded({ settings: service.defaultSettings(), loadError: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  const save = useCallback(async (next: Settings): Promise<void> => {
    const saved = await getSettingsService().save(next);
    setLoaded({ settings: saved, loadError: "" });
  }, []);

  const value = useMemo(() => (loaded ? { ...loaded, save } : null), [loaded, save]);

  if (!value) return <main><p>Lade Einstellungen …</p></main>;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings außerhalb des SettingsProvider verwendet");
  return value;
}
