# Putting Dropzone online

Dropzone is **one Node.js program**. It serves the game page, the sign-in/lobby API, and every
match server, so you only need one web service. When it's online, everyone opens the same link
and plays together.

You need:
- this repository on GitHub (it's already there: `tabletwshew-sudo/Trial-game`)
- a free [Render](https://render.com) account (sign up with your GitHub account)

It takes about 10 minutes the first time.

---

## Step 1: put the code on your main branch (optional but simpler)

All the work so far is on the branch `claude/admiring-archimedes-8od6rz`. Either:
- **merge it into `main`** on GitHub (open a pull request from that branch and merge it), or
- leave it where it is and pick that branch in Step 2.

## Step 2: create the service on Render

**The easy way (Blueprint):**
1. In Render, click **New +** → **Blueprint**.
2. Connect GitHub if it asks, then pick the **Trial-game** repository (and the branch from Step 1).
3. Render reads `render.yaml` from the repo and shows one web service called **dropzone**. Click **Apply**.

**Or by hand (New → Web Service):**

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/health` |
| Environment variable | `NODE_VERSION` = `22` |
| Instance type | Free to try it out, Starter to keep it awake (see below) |

## Step 3: wait for the first build

The first deploy takes 2–4 minutes: Render installs packages, builds the game, then starts the
server. When the log shows

```
[dropzone] http+ws on :10000
```

and the status turns **Live**, it's ready.

## Step 4: play

1. Open the address Render gives you, something like `https://dropzone-abcd.onrender.com`.
2. Click **Play as guest** (or make an account), pick a mode and press **PLAY**.
3. Send the same link to your friends:
   - add each other in the **friends** panel and invite to a party, or just queue at the same time
   - you'll land in the same match, and bots fill the empty slots after 30 seconds

Check it on a school computer early. Some school filters block new websites (see the school section below).

---

## Free vs. paid

| | Free | Starter (about $7 a month) |
|---|---|---|
| Works for a match with friends | ✅ | ✅ |
| Goes to sleep after 15 minutes with nobody on | yes: the first visit then takes ~1 minute to wake up | no, always on |
| Keeps accounts and friends lists across updates | no: every deploy starts fresh (guests don't mind) | yes, with a disk (below) |

**To keep accounts:** on a paid instance, add a **Disk** to the service mounted at `/var/data`,
then add the environment variable `DATA_FILE` = `/var/data/db.json`.

**Waking it up before class:** open the link a minute or two before you want to play, or use a
free uptime checker to visit `https://YOUR-ADDRESS/health` every 10 minutes.

## Settings (environment variables)

| Name | What it does | Default |
|---|---|---|
| `PORT` | The port to listen on. Render sets this for you. | 8080 |
| `QUEUE_TIMEOUT_S` | How long the queue waits for more real players before bots fill the match | 30 |
| `WARMUP_S` | Length of the warm-up island countdown | 30 |
| `DATA_FILE` | Where accounts, friends and stats are saved | `data/db.json` in the app folder |

## Updating the game

Push to the branch Render watches. It rebuilds and redeploys on its own (about 2 minutes).
- A match that's running when the new version goes live ends.
- Browsers reconnect by themselves: players land back in the lobby. On the free plan they sign in
  again, because saved sign-ins reset with each deploy.
- So update between games, not during one.

---

## School networks

- Dropzone uses only **HTTPS and secure WebSockets on port 443**, the same as any normal
  website, so it gets through most school firewalls.
- **If the page won't load at school but works at home**, the school's web filter is probably
  blocking `onrender.com`. Your options:
  - ask the school's IT team to allow your address
  - use a **custom domain** (Render → your service → Settings → Custom Domains), which needs a domain name you own
- Graphics: on older laptops, use **Settings → Video → Graphics: Low**. The game also lowers its own
  resolution when the frame rate dips.
- Sound starts after your first click (browsers require that). Volume sliders are in **Settings → Audio**.

## Other hosts

The repo has a `Dockerfile`, so anything that runs Docker works the same way (start command and
port are already set):

- **Railway:**
  - New Project → Deploy from GitHub repo
  - it detects Node; set the build command to `npm ci && npm run build` and the start command to `npm start`
- **Fly.io:**
  - `fly launch` (it finds the Dockerfile), then `fly deploy`
  - keep one machine running so matches aren't interrupted
- **A computer at school or home:**
  - run `npm ci`, then `npm run build`, then `PORT=8080 npm start`
  - players open `http://THAT-COMPUTER'S-IP:8080`
  - plain `http` works on a local network; over the internet, put it behind HTTPS

## How much can one server handle?

- **CPU:**
  - an 80-player match (bots included) uses about 1 ms of server time per tick, 30 ticks a second
  - one small instance can run several matches at once; the free instance is fine for a group of friends
- **Bandwidth:**
  - each real player receives about 30–40 KB/s while in a match
  - 10 friends is about 3–4 Mbit/s for the server, comfortably within free limits for occasional play
- **Bigger crowds:** if you ever outgrow one instance, move to a larger instance first, which is simpler than running several.

## Checking it's healthy

- `https://YOUR-ADDRESS/health` shows `{"ok":true,...}` with how many people are online and how
  many matches are running.
- Render → your service → **Logs** shows the server output, including any errors.
- "Client not built" on the page means the build step didn't run: check that the build command is
  `npm ci && npm run build`.
