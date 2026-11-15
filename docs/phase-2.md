# Phase 2: Sign-in, lobby, friends, party, queue

## What's in
- **Accounts**: register / sign in (scrypt-hashed passwords) or play as a guest. Sessions last 30 days.
  Auth endpoints are rate-limited (20/min per IP).
- **Lobby**: 3D stage with your party standing together (you're centre stage), name tags with
  leader/ready state, idle animations, and a wave when someone readies up.
- **Locker**: 8 outfits for the original "Ranger" character. Drag to spin.
- **Friends**: add by username, accept/decline, remove, live presence
  (In Lobby / Matchmaking / In Match / Offline), and invite or join from the list.
- **Party** (max 4): invites, join a friend, leave, kick, promote. The leader picks the mode and
  Fill/No Fill, and members ready up. If the party grows past the mode size, the mode bumps up automatically.
- **Matchmaking**: Solo 80 / Duos 80 / Trios 78 / Squads 80.
  Fill parties are packed into full teams (e.g. a solo plus a trio make a squad), and gaps get bot teammates.
  No-fill parties play short-handed. A match starts when the lobby is full of humans, or after
  `QUEUE_TIMEOUT_S` (default 30 s); bot teams take every slot that's left.
- **Match found** screen with your team and match stats. Phase 3 replaces it with the drop.

## Tests
- `npm test`: 27 unit and integration tests (matchmaker rules, auth, the full WebSocket
  friend → party → ready → queue → match flow, fill merging, mode bump)
- `npm run e2e:lobby` (server running on :8099 with `QUEUE_TIMEOUT_S=3`): two real browsers
  register, friend, party, ready, use the locker, queue, get matched, and refresh to keep the session

## Manual checklist
- [x] Wrong password shows an error, and a taken name shows an error
- [x] Refreshing the page keeps you signed in and in your party (20 s grace)
- [x] The friends panel closes when you join a party (bug found by e2e)
- [x] A non-leader can't change the mode, and the leader can't queue until everyone is ready
