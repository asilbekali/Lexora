# Lexora

A single-page vocabulary and spelling trainer: you add English words, AI fills in
the meaning, pronunciation, example and a memory tip, and then it quizzes you —
showing the meaning and asking you to type the word. Spelling mistakes are
detected deterministically and shown character by character.

Think Anki + a spelling trainer + an AI tutor, on one screen.

---

## Quick start

```bash
npm install
cp .env.example .env      # then edit it (see below)
npm run dev
```

Open **http://localhost:5173** and sign in.

Two processes start together:

| Process       | Port | What it is                          |
| ------------- | ---- | ----------------------------------- |
| `dev:web`     | 5173 | Vite + React frontend               |
| `dev:server`  | 8787 | Express API (proxied at `/api`)     |

### Accounts

The first account is the administrator, configured in `.env`. Everyone else
registers from the sign-in screen — the app is multi-user.

**Each account only ever sees its own words.** Every vocabulary row, practice
attempt, streak and session counter is keyed to a user id, and every route
filters by the signed-in user. Asking for another account's word by id returns
404, not their data.

### Configuration

Everything sensitive lives in `.env`, which is gitignored. Copy `.env.example`
and set at minimum:

```ini
ADMIN_USERNAME=asilbek
ADMIN_PASSWORD=your-password       # hashed with scrypt at boot, never stored as plaintext
SESSION_SECRET=<long random string>
GEMINI_API_KEY=                    # optional — see "AI" below
```

For a production-shaped setup, pre-hash the password instead:

```bash
npm run hash-password -- 'your-password'
# -> ADMIN_PASSWORD_HASH=scrypt$...$...
```

`ADMIN_PASSWORD_HASH` takes precedence over `ADMIN_PASSWORD`, and plaintext
passwords are rejected outright when `NODE_ENV=production`.

### AI

Word enrichment uses **Google Gemini** (Generative Language API) via a plain
`fetch` to `:generateContent` — no SDK. Get a free key at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey).

Every request sends a `responseSchema`, so Gemini returns JSON matching the
exact shape we asked for; zod re-validates it before anything reaches the store.
`GEMINI_THINKING_LEVEL=low` skips the thinking budget, which for short
dictionary lookups is both faster and dramatically cheaper (18 tokens versus
333 in testing) with no loss of quality.

Failures that retrying will not fix — a rejected key, an inaccessible model —
trip a **circuit breaker** that pauses AI for ten minutes; an exhausted quota
pauses for two. Adding a word then stays instant instead of burning seconds on
doomed retries, and the UI shows exactly why AI is paused.

Leave `GEMINI_API_KEY` empty and the app still works end to end. New words are
filled from a small built-in dictionary, mnemonics fall back to a deterministic
template, and every screen explains what happened. Nothing hangs and nothing
breaks — AI is an enhancement, never a dependency.

Mnemonics are generated lazily: adding a word costs one Gemini call, and the
memory tip is fetched (and cached on the word) the first time a flashcard
actually needs it.

---

## Scripts

| Command                 | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `npm run dev`           | API + frontend together (what you normally want)      |
| `npm run dev:server`    | API only, with file watching                          |
| `npm run dev:web`       | Frontend only                                         |
| `npm run build`         | Typecheck, then build the frontend to `dist/`         |
| `npm run preview`       | Build and serve the production bundle from the API    |
| `npm start`             | Serve the built app in production mode                |
| `npm run typecheck`     | `tsc -b` across app, server and shared code           |
| `npm run lint`          | ESLint                                                |
| `npm test`              | Spelling + spaced-repetition unit tests               |
| `npm run check`         | Typecheck + lint + tests                              |
| `npm run hash-password` | Generate an `ADMIN_PASSWORD_HASH`                     |

---

## How it works

### Spelling detection is deterministic

The AI never decides whether you spelled something correctly.
`shared/spelling.ts` runs a **Damerau-Levenshtein (optimal string alignment)**
edit distance with a full traceback, producing an aligned, renderable diff:

```ts
compareSpelling('accommodate', 'acommodate')
// {
//   correct: false,
//   distance: 1,
//   mistakes: [{ type: 'missing', expected: 'c', actual: '', position: 1 }],
//   alignment: [...],           // column-aligned cells for the two-row diff
//   explanation: 'You\'re missing a letter "c" after "a".',
// }
```

It distinguishes **missing**, **extra**, **wrong**, **swapped** (transposed) and
**capitalization-only** differences, and flags answers too far off to be a typo
as a different word rather than a misspelling. Case-only differences count as
correct but are still pointed out.

The same function runs on the server when grading, so a tampered client can't
mark its own answers correct.

### Progressive disclosure

Getting a word wrong doesn't hand you the answer:

1. **First slip** — you see *where* the mistakes are (correct letters at those
   positions stay masked as `?`) plus a nudge like "check the middle of the
   word". A **Show me** button is there if you want it.
2. **Second slip** — the correct letters are revealed alongside a masked
   skeleton of the word (`u _ _ q _ _ _ _ _ s`).
3. **Third slip** — the flashcard opens automatically.

**I don't know** jumps straight to the flashcard at any point.

### Flashcard illustrations

When a flashcard first opens, the server looks for a freely-licensed picture of
the word — [Openverse](https://openverse.org) first, Wikimedia Commons as a
fallback. Both are keyless and free. Only licences permitting commercial use
and modification are requested (CC BY, CC BY-SA, CC0, public domain), and the
creator and licence are credited on the image.

Abstract words often have no sensible picture. That is fine: the lookup result
(image *or* nothing) is cached on the word, the card simply omits the image, and
it never searches for that word again. `IMAGES_ENABLED=false` turns the whole
feature off.

### Spaced repetition

`shared/srs.ts` is a Leitner box system with intervals of
0h → 4h → 1d → 3d → 7d → 14d → 30d. Correct promotes a box, a spelling slip
demotes one, and a wrong or revealed answer resets to box 0. Word selection is
weighted random, favouring words that are overdue, low-accuracy or frequently
misspelled; mastered words are heavily de-prioritised. It's isolated behind
`gradeVocabulary` / `scoreForSelection`, so swapping in SM-2 or FSRS later
touches one file.

### Storage and the monthly clear

All data lives in a single JSON file, `server/data/db.json`. The frontend never
reads it directly — it goes through `/api/vocabulary`. Records are user-scoped
(`userId` on every row) so this can become a real database without changing the
routes.

**The store clears itself every 30 days.** The window is checked at startup and
hourly thereafter. Before clearing, a timestamped copy is written to
`server/data/archive/` so nothing is truly lost, and user accounts survive the
clear. Configure with `AUTO_RESET_DAYS`, `AUTO_RESET_ENABLED` and
`AUTO_RESET_ARCHIVE`. The UI shows how many days remain.

---

## API

All routes except `/api/health` and the login endpoint require a session cookie.

| Method   | Route                        | Purpose                                |
| -------- | ---------------------------- | -------------------------------------- |
| `GET`    | `/api/auth/community`        | Public user and word counts            |
| `POST`   | `/api/auth/register`         | Create an account and sign in          |
| `POST`   | `/api/auth/login`            | Sign in, sets an httpOnly cookie       |
| `POST`   | `/api/auth/logout`           | Sign out and revoke issued tokens      |
| `GET`    | `/api/auth/me`               | Current user                           |
| `GET`    | `/api/vocabulary`            | Words + stats + storage metadata       |
| `POST`   | `/api/vocabulary`            | Add a word (triggers AI enrichment)    |
| `PATCH`  | `/api/vocabulary/:id`        | Edit a word                            |
| `DELETE` | `/api/vocabulary/:id`        | Delete a word                          |
| `POST`   | `/api/vocabulary/seed`       | Load the ten demo words                |
| `POST`   | `/api/vocabulary/:id/enrich` | Retry AI enrichment for one word       |
| `POST`   | `/api/vocabulary/:id/image`  | Find and cache an illustration         |
| `POST`   | `/api/vocabulary/reset`      | Clear the store now (manual)           |
| `POST`   | `/api/practice/session`      | Start a session                        |
| `POST`   | `/api/practice/attempt`      | Grade an answer, update the schedule   |
| `POST`   | `/api/ai/vocabulary`         | Structured info for a word             |
| `POST`   | `/api/ai/memory-tip`         | Mnemonic (cached on the word)          |
| `POST`   | `/api/ai/explain`            | Longer explanation of a hard word      |
| `GET`    | `/api/ai/status`             | Whether AI is configured, and why paused |

---

## Security notes

- The Gemini key is read server-side only and never reaches the browser bundle.
- Passwords are stored as **scrypt** hashes with a per-user salt; comparison is
  timing-safe. Login failures are indistinguishable between bad username and
  bad password.
- Sessions are HMAC-SHA256-signed, httpOnly, `SameSite=Lax` cookies, `Secure` in
  production. Each user carries a session epoch that increments on logout, so
  tokens issued earlier stop working immediately.
- Every request body is validated and sanitised with zod before it touches the
  store or the AI provider; every AI response is validated before it's trusted.
- Every route is scoped to the signed-in user; one account cannot read, edit or
  delete another's words.
- A simple in-memory rate limiter caps `/api` at 300 requests/minute, keyed per
  signed-in user so people sharing an IP do not throttle each other.
- `.env`, `.env.local` and `server/data/` are gitignored.

---

---

## Deploying

The app is a Node server that serves the built frontend and owns the JSON
store. `npm run build` produces `dist/`, and `npm start` serves it together
with the API on a single port.

```bash
npm install
npm run build
npm start          # honours $PORT
```

### It needs a host with a persistent disk

All data — accounts, words, progress — lives in `server/data/db.json`. The host
must therefore keep a writable filesystem between requests and restarts.

**Vercel and Netlify will not work for this as-is.** Their serverless functions
get a read-only filesystem apart from a `/tmp` that is wiped between
invocations, so every account and every word would disappear almost
immediately. Nothing in the code is wrong — a file-backed store and a
serverless host are simply incompatible.

These hosts work with no code changes, and all have free tiers:

| Host    | What to configure                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------ |
| Render  | Build `npm install && npm run build`, start `npm start`, add a Persistent Disk mounted at `/data`        |
| Railway | Same commands, add a Volume                                                                              |
| Fly.io  | Same commands, add a Volume                                                                              |

With a disk mounted, point the store at it:

```ini
DATA_FILE=/data/db.json
ARCHIVE_DIR=/data/archive
```

### Required environment variables

Set these in the host's dashboard — never in the repository:

```ini
NODE_ENV=production
SESSION_SECRET=<long random string>
ADMIN_USERNAME=asilbek
ADMIN_PASSWORD_HASH=scrypt$...     # from: npm run hash-password -- 'your-password'
GEMINI_API_KEY=<your key>
DATA_FILE=/data/db.json
ARCHIVE_DIR=/data/archive
```

Production deliberately refuses to start with a plaintext `ADMIN_PASSWORD`.

### If you specifically want Vercel

Keep the frontend on Vercel and swap the storage layer for a hosted database —
Vercel Postgres, Turso, Supabase and MongoDB Atlas all have free tiers. Only
`server/db.ts` and `server/store.ts` need rewriting; the routes, the auth layer
and the entire frontend stay exactly as they are, because every record is
already keyed by `userId`.

### Before pushing to Git

`.env` and `server/data/` are already in `.gitignore`. Confirm with:

```bash
git status --short        # neither should appear
```

If a key ever gets committed by accident, rotate it — deleting the file in a
later commit does not remove it from history.


## Keyboard shortcuts

| Key     | Action                                        |
| ------- | --------------------------------------------- |
| `Enter` | Check your answer / continue to the next word  |
| `Esc`   | Close the flashcard or any dialog              |
| `?`     | Show the shortcut list                         |
| `S`     | Start a practice session                       |
| `/`     | Focus the vocabulary search box                |

---

## Project layout

```
shared/            Types + logic used by both sides
  spelling.ts        Damerau-Levenshtein comparison and diff alignment
  srs.ts             Leitner scheduling and word selection
  spelling.test.ts   Unit tests for both

server/
  index.ts           Express app, rate limiting, static serving
  env.ts             All environment config (the only place secrets are read)
  db.ts              JSON persistence, atomic writes, monthly auto-clear
  auth.ts            scrypt hashing, signed session cookies, requireAuth
  ai.ts              Gemini client: response schemas, circuit breaker, fallbacks
  images.ts          Openverse / Wikimedia illustration lookup
  dictionary.ts      Offline dictionary + seed words
  store.ts           Vocabulary / attempt / stats operations
  validation.ts      zod schemas and input sanitising
  routes/            auth, vocabulary, practice, ai

src/
  components/        UI, including ui/ primitives
  context/           Auth and theme providers
  hooks/             useVocabulary (data), usePractice (session state machine)
  lib/               API client, progressive hints, formatting
```
