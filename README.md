# Poke Arena

Live 3v3 Pokémon battles between colleagues with the Pokémon you raised in
[PokeTokenBar](https://github.com/chattymin/PokeTokenBar). Static frontend on GitHub Pages, Supabase for
auth, data and realtime. Battle rules: real stats (base, IV, level, nature), official damage formula,
type chart, STAB, crits, accuracy, stat stages and status conditions.

## Structure

| Folder | What |
| --- | --- |
| `engine/` | Pure TypeScript battle engine + vitest tests (`npm test`) |
| `web/` | Svelte 5 + Vite frontend (`npm run dev`) |
| `web/public/install.sh` | One-line macOS sync helper (launchd agent) |
| `supabase/migrations/` | Schema, RLS policies and RPC functions |
| `data/` | Cached PokéAPI data (`npm run fetch-data` to refresh) |

## Setup (once)

### 1. Supabase

1. Create a project at supabase.com (free tier is fine).
2. SQL editor: paste and run `supabase/migrations/0001_schema.sql`.
3. Authentication > Providers > Email: enable, disable "Confirm email" is not needed (magic link handles it).
   Optional: turn off "Enable email signups" **after** everyone is in.
4. Authentication > URL Configuration: set Site URL to your Pages URL
   (e.g. `https://<user>.github.io/poke-arena/`) and add it to Redirect URLs.
5. Project Settings > API: copy the project URL and the `anon` key.

Allowed email domains are defined in the SQL function `allowed_email_domains()` (default `cube.nl`).

### 2. GitHub Pages

1. Push this repo to GitHub, default branch `main`.
2. Settings > Pages > Source: **GitHub Actions**.
3. Settings > Secrets and variables > Actions: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Push (or run the workflow manually). The site is at `https://<user>.github.io/<repo>/`.

### 3. Colleagues

Open the site, log in with a work email, paste the install command once. Done.

## Local development

```sh
npm install
cp web/.env.example web/.env   # fill in Supabase URL + anon key
npm run dev                    # http://localhost:5173
npm test                       # engine tests
```

For local login the Supabase Redirect URLs must include `http://localhost:5173/`.

## How a battle works

1. Both players save a team (1 to 3 Pokémon) in the lobby.
2. Challenge someone who is online. They accept; both teams are snapshotted into the battle row.
3. Each turn both players submit a move. Actions are stored in `battle_actions`; both browsers replay
   the full action log through the deterministic engine (seeded by `battles.seed`), so they always agree.
4. When the last Pokémon faints both clients call `finish_battle` (idempotent) and the leaderboard updates.

## Sync helper

`install.sh` writes `~/.poke-arena/{config,sync.sh}` and a launchd agent (`nl.cube.poke-arena.sync`) that
posts `companion-state.json` to the `sync_pokedex` RPC whenever the file changes and every 15 minutes.
Remove with `uninstall.sh`. Logs: `~/.poke-arena/sync.log`.
