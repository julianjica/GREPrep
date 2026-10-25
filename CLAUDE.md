# GRE Prep — project notes for Claude Code

This file carries over the context from the Claude (Cowork) conversation where this app was designed and built, so work can continue here.

## What this is
A GRE practice web app that runs on the owner's Mac (macOS, Apple Silicon) and is used from other devices on the same Wi-Fi. One student, no sign-in beyond an access code. Every AI feature runs through the **Claude Code CLI in headless mode (`claude -p`)** on the host, using the owner's Claude Code login — deliberately *no* Anthropic API key in the app.

Start: `node server.js` or double-click `start.command`. Zero npm dependencies; Node 18+ (ES modules, `"type": "module"`).

## History / decisions (in order)
1. Started as an iPhone app design (Claude Design canvas, 15 artboards: daily practice, onboarding, plan, lesson, mistake notebook, timed section, results, essay, AI generator, dark mode).
2. Built as a native SwiftUI Xcode project (iOS 17, SwiftData, Claude API via key in Keychain). **Superseded** — not in this folder.
3. Owner switched to: serve from the Mac over the LAN, use an agent (Claude Code CLI) instead of an API, and add a chat tutor. That's this project.
4. LAN access failed on campus Wi-Fi (client isolation; croc only worked via its public relay). Confirmed working over a phone hotspot. Tailscale is the suggested workaround on isolated networks.
5. Default port changed 3000 → **8742** (3000 was taken); auto-falls back to 8743–8751 if busy unless `PORT` is set.

## Layout
- `server.js` — HTTP server (binds 0.0.0.0), static files, JSON API, access-code cookie auth (localhost bypasses it), labeled LAN addresses on startup.
- `lib/agent.js` — Claude Code bridge: `ask` (json output), `askJSON`, `chat` (stream-json + `--include-partial-messages`, `--resume <session_id>` for multi-turn), `status` (`claude --version`). Max 3 concurrent CLI processes. Tools disabled via `--disallowedTools`; runs in an empty temp dir **outside** this project so this CLAUDE.md isn't loaded into the tutor. Falls back to `--append-system-prompt` / no partial messages on older CLIs.
- `lib/generator.js` — question generation jobs (in-memory, polled by the client) with a 4-step validation pipeline: (1) local format rules per GRE type, (2) 3 independent blind solves must match the key, (3) Quant: agent-written JS recomputation run in `node:vm` (1 s timeout), (4) strict item-reviewer pass. Failed drafts are rewritten (max 3× drafts per requested question); duplicates rejected.
- `lib/db.js` — JSON store at `data/db.json` (atomic writes). Also `data/access-code.txt`.
- `public/` — vanilla JS SPA, hash routing. `content.js` is shared by browser and server (32 verified starter questions, vocab, lessons, essay prompts, scoring/plan/picking logic). `app.js` = views + actions (event delegation via `data-action` / `data-input`). `ui.js` = escaping, icons, mini-markdown. `styles.css` = design tokens with light/dark (prefers-color-scheme + `data-theme` override saved in localStorage).

## Conventions
- Always escape dynamic text with `esc()` before inserting HTML (AI output included). Tutor replies go through `md()` which escapes first.
- Question shape: `{id, type, difficulty, topic, passage?, stem, quantityA?, quantityB?, choices[], correct[] (0-based), numericAnswer?, unit?, answerDisplay?, explanation, source: 'bank'|'ai'}`. Types: quantComparison, multipleChoiceSingle, multipleChoiceMulti, numericEntry, textCompletion, sentenceEquivalence, readingComprehension.
- Timing follows the current shorter GRE first sections: Quant 12 Q / 21 min, Verbal 12 Q / 18 min.
- Spaced repetition: missed → due now; retry intervals 1, 3, 7 days; mastered after 2 correct in a row.
- Score estimates are rough (difficulty-weighted accuracy → 130–170); label them as estimates.
- Keep zero dependencies unless there's a strong reason.

## Testing
No real agent is needed to test: make a stub CLI that prints Claude Code-shaped JSON (`{"type":"result","result":...,"session_id":...}` for `--output-format json`; `stream_event` text deltas + `result` for `stream-json`) and run `CLAUDE_BIN=/path/to/stub GRE_DATA_DIR=/tmp/gre-test PORT=8799 node server.js`. Use a separate `GRE_DATA_DIR` so the student's `data/db.json` isn't touched.

## Ideas not done yet
Second (adaptive) section; 2- and 3-blank Text Completion; data-interpretation questions with charts; full-length mock test; export/backup button for progress; showing generated-question validation reports per question in the bank.
