# Poke Arena – design

Live 3v3 Pokémon battles between colleagues, using the Pokémon they raised in PokeTokenBar.

## Goals
- Zero manual data handling: one-time helper install, then Pokémon appear on the site automatically.
- See who is online, build a team of 3, invite a colleague, battle turn by turn choosing moves.
- Real battle rules: stats from base/IV/level/nature, official damage formula, type chart, STAB, crit,
  accuracy, status moves (stat stages, paralysis/sleep/burn/poison/freeze), healing/drain/recoil/multi-hit.
- Hosted on GitHub Pages (static) + Supabase free tier (auth, Postgres, Realtime).
- Sprites and battle animations in the browser.

## Out of scope (v1)
Switching mid-battle (only after KO), items, weather, abilities, held items, confusion, two-turn moves,
server-side anti-cheat (engine is deterministic and shared; can move into an Edge Function later).

## Architecture
```
poke-arena/
  data/      cached PokéAPI data (pokemon.json, moves.json, types.json) + fetch script
  engine/    pure TypeScript battle engine, vitest tests, no DOM/Supabase deps
  helper/    install.sh + sync.sh + launchd plist (macOS sync agent)
  supabase/  SQL migrations, RLS, RPC functions
  web/       Svelte + Vite frontend, deployed to GitHub Pages via GitHub Actions
```

### Sync helper
`install.sh` (shown on the site after login, includes a per-user sync token) writes `~/.poke-arena/config`,
installs a launchd agent that runs `sync.sh` on change of `companion-state.json` (WatchPaths) and every 15 min.
`sync.sh` POSTs the raw state to the Postgres RPC `sync_pokedex(p_token, p_state)` via the anon REST endpoint.
The RPC validates the token, extracts the active Pokémon and the dex, upserts into `pokemon`.

### Auth
Supabase magic link (email OTP). A trigger on `auth.users` creates the `players` row and rejects emails
outside the allowed domain (configurable, default `cube.nl`).

### Data model
- `players(id = auth.users.id, email, name, last_sync_at, wins, losses)`
- `sync_tokens(token, player_id, created_at)` (one per player, regenerable)
- `pokemon(id uuid = instanceID, player_id, species_id, level, nature, ivs jsonb, moves jsonb, shiny, gender, is_active, updated_at)`
- `teams(player_id pk, pokemon_ids uuid[3])`
- `battles(id, challenger_id, opponent_id, status pending|active|finished|declined, seed bigint,
   challenger_team jsonb, opponent_team jsonb, winner_id, created_at, finished_at)`
- `battle_actions(battle_id, turn, player_id, action jsonb, pk(battle_id, turn, player_id))`

Battle state is never stored: both clients replay `battle_actions` through the deterministic engine seeded
with `battles.seed`. Reconnect = replay. Both clients call `finish_battle(battle_id, winner_id)` (idempotent).

### Realtime
- Presence channel `lobby`: online players and whether they are in a battle.
- Postgres changes on `battles` (invites for me, status changes) and `battle_actions` for the active battle.

### Engine API
```ts
createBattle(teamA: TeamSnapshot, teamB: TeamSnapshot, seed: number): BattleState
pendingActors(state): PlayerSide[]            // who must submit an action now
applyActions(state, actions: Record<Side, Action>): { state, events: BattleEvent[] }
```
`Action = { type: 'move', moveIndex } | { type: 'switch', slot }`. Events drive UI animation and the log.

### Frontend screens
1. Login (email → magic link).
2. Setup: shows install command when no Pokémon synced yet; auto-advances once data arrives.
3. Lobby: my Pokédex + team picker (3), online colleagues with "Uitdagen", incoming invite modal, leaderboard.
4. Battle: field with animated sprites (PokéAPI showdown gifs), HP bars, move buttons, log, result screen.

### Testing
- engine: vitest unit tests (stats, damage, type chart, turn order, statuses, KO/replace flow, determinism).
- web: type-check + build in CI; manual smoke test.
- helper: shellcheck; manual install on one Mac.
