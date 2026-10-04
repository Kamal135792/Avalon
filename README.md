# Avalon Anonymous

A complete original Avalon game for 5–10 friends, with secret roles, simultaneous team votes, private quest cards, assassination, chat, reconnects and rematches. Optional Percival, Morgana, Mordred, Oberon, Lady of the Lake and targeting are supported. Later Big Box characters and cross-game Resistance Plot cards are outside this edition.

## Setup and deployment

1. Install Node.js 20.9+ and run `npm ci`.
2. Create a Supabase project. Open **SQL Editor**, paste all of [`avalon_scheme.sql`](./avalon_scheme.sql), and run it as `postgres`. **This is a transactional clean reset that deletes existing Avalon rooms.** Do not use it as an upgrade migration once you have games to preserve. `avalon_schema.sql` is an identical compatibility copy; run only one of them.
3. Copy `.env.example` to `.env.local`. Set the Supabase project URL and publishable/anon key. Never use a service-role key in the browser.
4. Run `npm run dev`, or deploy this Next.js project to a host that supports Node.js and configure the same environment variables before building. Use `npm run build` and `npm start` for a production server. The browser needs HTTPS outside localhost for secure identity generation.
5. Create a room, share the invite link, have 5–10 players join and mark themselves ready, then start. Each friend uses their own browser. Tabs in one browser profile represent the same player; use separate profiles/private contexts for testing.

No Supabase Auth provider, email, extra Realtime publication, service key, or CORS dashboard change is needed. The app uses four restricted public RPCs and polls authorized snapshots every two seconds (ten seconds in hidden tabs). This avoids depending on custom session headers reaching Supabase's WebSocket authorization layer.

## Rules and behavior

Rules follow the [original Avalon rulebook](https://avalon.fun/pdfs/rules.pdf): correct 5–10 player counts and quest sizes, random first leader, clockwise leadership, ties rejected, five consecutive rejections ending the game, good-only Success cards, the two-Fail fourth quest with seven or more players, and the Assassin's last chance after three successes. Merlin sees Oberon but not Mordred. Evil cannot see Oberon; Percival's candidates are not labeled by role.

Role combinations that exceed available evil slots are rejected, rather than silently dropping selected roles. At five players, Percival requires Morgana or Mordred. Optional targeting allows unplayed quests in any order, with quest five locked until two successes. Lady of the Lake runs after the second, third, and fourth completed quests while the game continues; results are private to the inspecting player and former holders cannot be inspected.

The last vote/card resolves the phase automatically. Refreshing restores your own submitted card and sealed vote. Settings, roster changes, and rematches reset readiness. The host can remove lobby players, transfer hosting, abandon a stalled game, and start a rematch. Other players may claim hosting after 90 seconds without the host's heartbeat. Players who lose connection keep their seat; the host can abandon and restart if they cannot return.

## Identity and privacy

A cryptographically generated UUID in browser local storage is an anonymous bearer credential. The optional private recovery key restores that same identity on another browser. Treat it as a password. It never appears in a public roster, chat, invite or SQL snapshot. Keep the browser and recovery key private. Losing both storage and recovery key means that seat cannot be recovered.

All tables live in the unexposed `avalon_private` schema. RLS is enabled with no client grants. Public RPCs authorize membership and serialize actions under a room lock. Snapshots reveal only your hand, other votes once voting closes, aggregate quest card counts after completion, and everyone's roles only when the game ends. Room codes allow joining an open lobby; they are invitation codes, not authentication credentials. Inactive rooms become inaccessible after seven days; operators can periodically delete old rows from `avalon_private.games` if desired.

Anonymous creation is limited per identity and chat per player. This is intended for friends; public internet promotion would also need gateway/IP rate limits and abuse monitoring.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test` — executes the actual SQL in PGlite PostgreSQL, checks all player counts and role combinations, privacy, access controls, victory paths, variants and room lifecycle.
- `npx playwright install --with-deps chromium` then `npm run test:e2e` — runs five isolated browsers against the actual SQL through a local RPC transport, completes a game, checks refresh/reconnection and mobile layout, then rematches.
- `npm run build`

The browser test substitutes the Supabase HTTP transport while executing the real database functions. It does not claim to validate your hosted Supabase project's configuration. After applying SQL and deploying, smoke-test create/join/start from separate devices, run a full game, and verify reconnects on the deployed HTTPS origin.

The runtime dependency audit is clean after upgrading Next.js. npm still reports a transitive `braces` advisory in ESLint's development-only file-matching dependencies; the suggested forced fix downgrades Next's ESLint configuration across major versions and is intentionally not applied. Do not run lint tooling on untrusted glob patterns.
