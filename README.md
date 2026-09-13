# LLM Werewolf Arena

LLM Werewolf Arena is a local-first web app for watching eight model-powered players play Werewolf. You choose their names and OpenRouter models; the app assigns hidden roles and runs the game. A deterministic game engine validates every proposed action, resolves votes and night outcomes, and keeps the authoritative state. The human operator can inspect public discussion, private actions, available reasoning, and usage diagnostics.

V1 always has **2 Werewolves, 1 Seer, 1 Doctor, and 4 Villagers** and begins at Night 0. Players know the starting role counts and their own roles; Werewolves also know their teammate. Player names must be unique (ignoring capitalization), but multiple players may use the same model.

## Requirements

- Node.js 22 or newer and npm
- An OpenRouter account and API key for live games
- Internet access for model discovery and live model turns

OpenRouter usage may incur charges on your account. The app can also run its automated game-engine tests without an API key or network calls.

## Run locally

From the project directory:

```sh
npm ci
npm run dev
```

Use `npm run dev` while developing. To run the optimized release build instead, use:

```sh
npm ci
npm run build
npm run start
```

Run these commands from the project directory. On Windows PowerShell, use `npm.cmd` in place of `npm` if script-execution policy blocks `npm`. On macOS and Linux, use `npm` as shown. If installing the native SQLite dependency fails, install your platform's C/C++ build tools and Python, then retry `npm ci`.

Open [http://localhost:3000](http://localhost:3000). Go to **OpenRouter settings** from the main page, paste your API key, and select **Save key**. The key is verified and held only in the server process's memory; enter it again after restarting the server. You do not need a `.env.local` file for normal use.

On the main page, give each of the eight players a distinct name, choose an eligible text model for each seat, select any house rules, and start the game. During play you can pause, resume, step one action at a time, or end the game early. You can return to any ongoing game from the main page. Saved games can be reopened or deleted from **Browse saved games**.

The spectator view shows all roles and hidden actions. Player prompts receive only information that player is entitled to know. Available provider reasoning and operator diagnostics are spectator-only; some providers return only encrypted reasoning, which cannot be displayed as text.

## House rules

The setup page offers four optional rules: reveal roles on departure, exiled-player final words, one Werewolf re-proposal after disagreement, and strategic vote abstention. Expand **House rules for this game** in the spectator view to see the values saved for that game.

The Doctor may protect themselves but cannot protect the same person on consecutive nights. Protecting someone on Nights 1 and 3, with a different target on Night 2, is allowed.

## Local data and security

Game history and model-call telemetry are stored in a local SQLite database at `data/llm-werewolf.db` by default, including SQLite's `-wal` and `-shm` sidecar files. The `data/` directory and database files are Git-ignored. A custom `DATABASE_URL` can change the storage path; keep that path out of any repository or deployment bundle.

The OpenRouter key saved through Settings is **not** written to the database or sent to the browser after saving. OpenRouter requests originate on the server. As an optional developer fallback, you may set `OPENROUTER_API_KEY` in a local `.env.local`; all `.env*` files are Git-ignored except the empty-value `.env.example`. Never put a real key in `.env.example`, source code, screenshots, or commits.

This V1 app has no user authentication. The included `dev` and `start` scripts bind to the local loopback interface only. Run it on a trusted machine; do not expose the server or its spectator/diagnostic endpoints to the public internet, including through a reverse proxy or tunnel.

## Verify a change

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

The browser suite builds and runs the production app with Playwright's Chromium on Windows, macOS, and Linux. On Linux, Playwright may also require OS browser dependencies; see its installation instructions. The unit/integration suite uses deterministic fake models and makes no live OpenRouter calls.
