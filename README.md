# GRE Prep — local web app with a Claude Code tutor

Runs on your Mac and is used from any computer, tablet or phone on the same Wi-Fi. All AI features — the tutor chat, hints, new questions, question checking and essay scoring — are handled by the **Claude Code CLI** on your Mac, using your existing Claude Code sign-in. There is no API key in the app.

## One-time setup (on the Mac that will host it)

1. **Node.js 18 or later**: `node -v` in Terminal. If missing, install the LTS version from nodejs.org or run `brew install node`.
2. **Claude Code**: `npm install -g @anthropic-ai/claude-code`, then run `claude` once and sign in. Check with `claude -p "say hi"`.

No `npm install` is needed. The app has no dependencies.

## Start it

- Double-click **`start.command`** (the first time, macOS may ask you to confirm: right-click → Open), **or**
- in Terminal: `cd` into this folder and run `node server.js`.

The window prints something like:

```
On this computer:      http://localhost:8742
On other devices:      http://192.168.1.23:8742
(or try)              http://Julians-MacBook.local:8742
Access code for other devices: 482913
Agent: Claude Code 2.x.x
```

On the other computer, open the "On other devices" address in a browser and enter the access code once. If macOS asks whether to allow incoming connections for `node`, choose **Allow**.

Keep the window open while studying. Press Ctrl+C to stop.

## What's inside

- **Home**: daily goal, streak, countdown to test day.
- **Practice**: daily set aimed at weak topics, practice by section or question type, instant explanations, hints from the agent, and "Ask the tutor why" on every question.
- **Timed sections**: real timing (Quant 12 questions / 21 min, Verbal 12 / 18 min), Mark, Review grid, hideable timer, and a results page with time per question.
- **Tutor**: chat with a Claude Code agent. It knows your targets and weak topics, streams its replies, and remembers each conversation. Start one from any question, lesson, essay, flashcard or results page.
- **Generate**: the agent writes new questions and validates each one (see below).
- **Mistake notebook**: spaced repetition. A missed question returns after 1, 3 and 7 days until you get it right twice in a row.
- **Also**: a study plan, strategy lessons, vocab flashcards, progress charts, essay practice with agent scoring, and light/dark mode.

## How generated questions are validated

| # | Check | How |
|---|-------|-----|
| 1 | Official format | Local rules per question type (e.g. Sentence Equivalence = 6 choices, exactly 2 correct). |
| 2 | 3 independent solves | The question, without its answer key, is solved from scratch 3 separate times. All must match the key. |
| 3 | Math re-run as code (Quant) | The agent must include JavaScript that recomputes the answer. The server runs it in an isolated VM with a 1-second limit. |
| 4 | Expert review | A strict "item reviewer" pass checks for one defensible answer, no ambiguity, GRE style ≥ 4/5, correct difficulty and explanation. |

Drafts that fail are discarded and rewritten. Expect about 1–2 minutes per accepted question, because each one takes about 5 agent calls.

## Settings and options

- **Model**: in the app under Settings → Agent (e.g. `sonnet`, `opus`). Leave it empty for Claude Code's default.
- Environment variables when starting the server:
  - `PORT=9000` changes the port.
  - `GRE_PIN=123456` sets a fixed access code.
  - `GRE_NO_PIN=1` turns the code off. Only do this on a network you trust.
  - `CLAUDE_BIN=/path/to/claude` points to the CLI if it isn't found.
  - `GRE_AGENT_PARALLEL=3` caps how many agent processes run at once.

## Your data and safety

- All progress is saved in `data/db.json` in this folder on the host Mac. Back up that file to keep your history. The access code is stored in `data/access-code.txt`.
- The agent runs with its file, shell and web tools disabled, inside an empty temporary folder (outside this project). It can only think and write text.
- Anyone on your Wi-Fi who has the access code can use the app, and their usage counts against your Claude plan. Don't share the code.

GRE® is a registered trademark of ETS. This app is not endorsed or approved by ETS.
