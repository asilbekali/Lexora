```
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
````

Open **[http://localhost:5173](http://localhost:5173)** and sign in.

Two processes start together:

| Process      | Port | What it is                      |
| ------------ | ---: | ------------------------------- |
| `dev:web`    | 5173 | Vite + React frontend           |
| `dev:server` | 8787 | Express API (proxied at `/api`) |

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
ADMIN_PASSWORD=your-password
SESSION_SECRET=<long random string>
GEMINI_API_KEY=
```

For a production-shaped setup, pre-hash the password instead:

```bash
npm run hash-password -- 'your-password'
# -> ADMIN_PASSWORD_HASH=scrypt$...$...
```

`ADMIN_PASSWORD_HASH` takes precedence over `ADMIN_PASSWORD`, and plaintext
passwords are rejected outright when `NODE_ENV=production`.

---

## AI

Word enrichment uses **Google Gemini** (Generative Language API) via a plain
`fetch` to `:generateContent` — no SDK.

Get a free key at:

[https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)

Every request sends a `responseSchema`, so Gemini returns JSON matching the
exact shape we asked for; zod re-validates it before anything reaches the store.

`GEMINI_THINKING_LEVEL=low` skips the thinking budget, which for short
dictionary lookups is both faster and dramatically cheaper.

Failures that retrying will not fix — a rejected key or an inaccessible model —
trip a circuit breaker that pauses AI for ten minutes; an exhausted quota
pauses for two.

Leave `GEMINI_API_KEY` empty and the app still works end to end. New words are
filled from a small built-in dictionary, mnemonics fall back to a deterministic
template, and every screen explains what happened.

AI is an enhancement, never a dependency.

Mnemonics are generated lazily: adding a word costs one Gemini call, and the
memory tip is fetched and cached on the word the first time a flashcard needs it.

---

## Scripts

| Command                 | Purpose                                 |
| ----------------------- | --------------------------------------- |
| `npm run dev`           | API + frontend together                 |
| `npm run dev:server`    | API only, with file watching            |
| `npm run dev:web`       | Frontend only                           |
| `npm run build`         | Typecheck, then build the frontend      |
| `npm run preview`       | Build and serve the production bundle   |
| `npm start`             | Serve the built app in production       |
| `npm run typecheck`     | TypeScript type checking                |
| `npm run lint`          | ESLint                                  |
| `npm test`              | Spelling + spaced-repetition unit tests |
| `npm run check`         | Typecheck + lint + tests                |
| `npm run hash-password` | Generate an `ADMIN_PASSWORD_HASH`       |

---

## How it works

### Spelling detection is deterministic

The AI never decides whether you spelled something correctly.

`shared/spelling.ts` runs a **Damerau-Levenshtein (optimal string alignment)**
edit distance with a full traceback, producing an aligned, renderable diff.

It distinguishes:

* Missing letters
* Extra letters
* Wrong letters
* Swapped letters
* Capitalization-only differences

Case-only differences count as correct but are still pointed out.

The same function runs on the server when grading, so a tampered client cannot
mark its own answers correct.

### Progressive disclosure

Getting a word wrong doesn't immediately hand you the answer:

1. **First slip** — you see where the mistakes are.
2. **Second slip** — the correct letters are revealed alongside a masked skeleton.
3. **Third slip** — the flashcard opens automatically.

**I don't know** jumps straight to the flashcard at any point.

### Flashcard illustrations

When a flashcard first opens, the server looks for a freely licensed picture
of the word using Openverse first and Wikimedia Commons as a fallback.

Both are keyless and free.

Only licenses permitting commercial use and modification are requested
(CC BY, CC BY-SA, CC0, public domain), and the creator and license are credited
on the image.

Abstract words can have no sensible picture. In that case, the card simply
omits the image.

`IMAGES_ENABLED=false` turns the whole feature off.

### Spaced repetition

`shared/srs.ts` is a Leitner box system with intervals of:

```text
0h → 4h → 1d → 3d → 7d → 14d → 30d
```

Correct answers promote a box.

A spelling slip demotes one.

A wrong or revealed answer resets to box 0.

Word selection is weighted randomly, favouring words that are overdue, have low
accuracy, or are frequently misspelled.

---

## Storage and monthly clear

All data lives in:

```text
server/data/db.json
```

The frontend never reads it directly. It goes through:

```text
/api/vocabulary
```

Records are user-scoped using `userId`.

The store clears itself every 30 days.

Before clearing, a timestamped copy is written to:

```text
server/data/archive/
```

User accounts survive the clear.

Configure this with:

```ini
AUTO_RESET_DAYS=
AUTO_RESET_ENABLED=
AUTO_RESET_ARCHIVE=
```

---

## API

All routes except `/api/health` and the login endpoint require a session cookie.

| Method   | Route                        | Purpose                                 |
| -------- | ---------------------------- | --------------------------------------- |
| `GET`    | `/api/auth/community`        | Public user and word counts             |
| `POST`   | `/api/auth/register`         | Create an account and sign in           |
| `POST`   | `/api/auth/login`            | Sign in and set an httpOnly cookie      |
| `POST`   | `/api/auth/logout`           | Sign out and revoke issued tokens       |
| `GET`    | `/api/auth/me`               | Current user                            |
| `GET`    | `/api/vocabulary`            | Words + stats + storage metadata        |
| `POST`   | `/api/vocabulary`            | Add a word and trigger AI enrichment    |
| `PATCH`  | `/api/vocabulary/:id`        | Edit a word                             |
| `DELETE` | `/api/vocabulary/:id`        | Delete a word                           |
| `POST`   | `/api/vocabulary/seed`       | Load the ten demo words                 |
| `POST`   | `/api/vocabulary/:id/enrich` | Retry AI enrichment                     |
| `POST`   | `/api/vocabulary/:id/image`  | Find and cache an illustration          |
| `POST`   | `/api/vocabulary/reset`      | Clear the store manually                |
| `POST`   | `/api/practice/session`      | Start a practice session                |
| `POST`   | `/api/practice/attempt`      | Grade an answer and update the schedule |
| `POST`   | `/api/ai/vocabulary`         | Structured information for a word       |
| `POST`   | `/api/ai/memory-tip`         | Generate a mnemonic                     |
| `POST`   | `/api/ai/explain`            | Longer explanation of a difficult word  |
| `GET`    | `/api/ai/status`             | Check whether AI is configured          |

---

## Security notes

* The Gemini key is read server-side only and never reaches the browser bundle.
* Passwords are stored as scrypt hashes with a per-user salt.
* Login failures are indistinguishable between bad username and bad password.
* Sessions use HMAC-SHA256-signed httpOnly cookies.
* Production cookies use `Secure`.
* Every request body is validated and sanitized with zod.
* Every AI response is validated before being trusted.
* Every route is scoped to the signed-in user.
* One account cannot read, edit, or delete another user's words.
* API requests are rate-limited.
* `.env`, `.env.local`, and `server/data/` are gitignored.

---

## Deploying

The app is a Node server that serves the built frontend and owns the JSON store.

Build:

```bash
npm install
npm run build
```

Start:

```bash
npm start
```

The application honours the `$PORT` environment variable.

### Storage is chosen automatically

All data — accounts, words, and progress — lives in one JSON document. Where
that document is kept depends on the host:

| Host                        | Driver        | Notes                                    |
| --------------------------- | ------------- | ---------------------------------------- |
| Local, Render, Railway, Fly | file          | `server/data/db.json`, or a mounted disk |
| Vercel                      | Upstash Redis | serverless filesystems are ephemeral      |

On a host with a real disk, point the store at it:

```ini
DATA_FILE=/data/db.json
ARCHIVE_DIR=/data/archive
```

### Required production environment variables

```ini
NODE_ENV=production
SESSION_SECRET=<long random string>
ADMIN_USERNAME=asilbek
ADMIN_PASSWORD_HASH=scrypt$...     # from: npm run hash-password -- 'your-password'
GEMINI_API_KEY=<your key>
```

Production deliberately refuses to start with a plaintext `ADMIN_PASSWORD`.

### Vercel

Vercel serves `dist/` statically and routes every `/api/*` request to the
serverless function in `api/[[...path]].ts`, which runs the same Express app.
Without that function Vercel would only see a static site and answer 404 to
every endpoint.

Because a serverless filesystem is wiped between invocations, the JSON store
moves to **Upstash Redis** — the whole database stays one JSON document, just
kept in Redis instead of a file.

1. Vercel dashboard → **Storage** → add **Upstash Redis** (free tier). It sets
   `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you.
2. Add the environment variables listed above.
3. Redeploy.

The driver is chosen automatically: Upstash when those two variables exist, a
file otherwise. Nothing to configure in code, and local development is
unaffected. If the app is deployed to a serverless host with no Redis attached
it refuses to start and says so, rather than silently losing every account.

One caveat worth knowing: writes are read-modify-write on a single document, so
two people saving in the same instant can have one overwrite the other. Writes
are coalesced and flushed before each response, which makes the window very
small, but it is not zero. At a few dozen users this is fine; beyond that, move
`server/db.ts` and `server/store.ts` onto Postgres.


---

## Before pushing to Git

`.env` and `server/data/` should already be in `.gitignore`.

Confirm with:

```bash
git status --short
```

Neither `.env` nor `server/data/` should appear.

If an API key ever gets committed accidentally, rotate the key immediately.
Deleting the file in a later commit does not remove the key from Git history.

---

## Keyboard shortcuts

| Key     | Action                                        |
| ------- | --------------------------------------------- |
| `Enter` | Check your answer / continue to the next word |
| `Esc`   | Close the flashcard or dialog                 |
| `?`     | Show the shortcut list                        |
| `S`     | Start a practice session                      |
| `/`     | Focus the vocabulary search box               |

---

## Project layout

```text
shared/
  spelling.ts
  srs.ts
  spelling.test.ts

server/
  index.ts
  env.ts
  db.ts
  auth.ts
  ai.ts
  images.ts
  dictionary.ts
  store.ts
  validation.ts
  routes/

src/
  components/
  context/
  hooks/
  lib/
```

```

This is based on the README content you uploaded. :contentReference[oaicite:0]{index=0}
```
