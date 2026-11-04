# Boxtrainer

Solo-Training für Boxen und Kickboxen als PWA. Konzept: Generator baut Einheiten aus kuratierten Kombis und Übungen, der Player führt per Audio durch die Runden.

```bash
npm install
npm run dev        # Entwicklungsserver
npm test           # Vitest
npm run build      # Typecheck + Produktions-Build
```

App: https://toudyxd.github.io/Boxtrainer/ (Deploy per GitHub Actions bei Push auf `main`).

## Sprach-Clips erzeugen (ElevenLabs)

Alle Ansagen kommen aus vorab erzeugten Clips in `public/audio/<id>.mp3`. Fehlt ein Clip, spielt die App einen Platzhalterton.

1. `.env.example` nach `.env.local` kopieren und `ELEVENLABS_API_KEY` eintragen (die Datei wird nicht committet).
2. Stimmen ansehen und eine wählen: `npm run clips -- --list-voices` (optional `--search deutsch`), die ID als `ELEVENLABS_VOICE_ID` eintragen.
3. Kosten prüfen: `npm run clips -- --dry-run`.
4. Stimme an wenigen Clips testen: `npm run clips -- --only tech-lowkick,phrase-push,count-10`.
5. Alles erzeugen: `npm run clips`. Das Script erzeugt nur fehlende oder geänderte Clips und setzt nach einem Abbruch fort.
6. Clips committen (`public/audio/` inklusive `clips.json`).

Falsch ausgesprochene Begriffe lassen sich in `src/content/clip-overrides.json` korrigieren, etwa `{ "tech-lowkick": "Lo-Kick" }`. Der Anzeigetext bleibt unverändert, nur der gesprochene Text ändert sich; `npm run clips` erzeugt den Clip dann neu.

## Aufbau

- `src/domain`: Modelle, Generator, Zeitleiste, Player-Zustandsautomat (reines TypeScript)
- `src/content`: Techniken, Kombis, Übungen, Equipment-Profile als JSON
- `src/services`, `src/repositories`: Audio, Wake Lock, Sessions in IndexedDB
- `src/ui`: React-Oberfläche
