# GRE Prep

A self-hosted GRE practice app with an AI tutor. It runs on one computer and can be opened in a browser from any other device on the same network: laptop, tablet or phone.

The AI features (tutor chat, hints, new practice questions, question checking and essay scoring) are handled by an AI coding assistant CLI installed on the host computer. You can choose either:

- **Claude Code** (Anthropic), or
- **Codex** (OpenAI, signed in with ChatGPT).

The app uses the sign-in you already have for that CLI, so it needs no API key. You can switch between them at any time in **Settings → Agent**.

## Requirements

- **Node.js 18 or later.** Check with `node -v`. Install from [nodejs.org](https://nodejs.org) or with your package manager (for example, `brew install node`).
- **At least one AI assistant CLI**, installed and signed in:

  | Assistant | Install | Sign in | Check |
  |---|---|---|---|
  | Claude Code | `npm install -g @anthropic-ai/claude-code` | run `claude` once | `claude -p "say hi"` |
  | Codex | `npm install -g @openai/codex` | `codex login` | `codex exec "say hi"` |

There is nothing else to install. The app has no npm dependencies.

## Start it

```sh
node server.js
```

On macOS you can also double-click **`start.command`**. The first time, macOS may ask you to confirm (right-click → Open).

The server prints where to reach it:

```
On this computer:      http://localhost:8742
On other devices:      http://192.168.1.23:8742
Access code for other devices: 482913
Agent: Claude Code 2.x.x
```

On another device, open the "On other devices" address and enter the access code once. Keep the server running while you study, and press Ctrl+C to stop it.

If another device can't connect, the network may block devices from reaching each other (common on campus and public Wi-Fi). A phone hotspot or a private network tool such as [Tailscale](https://tailscale.com) works around that.

## Choosing the AI assistant

Open **Settings → Agent** and pick **Claude Code** or **ChatGPT Codex**. The status line shows whether the selected CLI is installed on the host.

- **Model** is optional and saved separately for each assistant, for example `sonnet` or `opus` for Claude Code, or `gpt-5` for Codex. Leave it empty to use the assistant's default.
- Tutor conversations continue when you switch. The new assistant receives the conversation so far.
- Codex replies arrive all at once rather than word by word.

## Features

- **Home**: daily goal, streak and countdown to test day.
- **Practice**: a daily set aimed at weak topics, practice by section or question type, instant explanations, AI hints, and "Ask the tutor why" on every question.
- **Timed sections**: Quant (12 questions, 21 min) and Verbal (12 questions, 18 min), with Mark, a Review grid, a hideable timer, and results with time per question.
- **Tutor**: chat with the AI assistant. It knows your targets and weak topics and remembers each conversation. Start a conversation from any question, lesson, essay, flashcard or results page.
- **Generate**: the assistant writes new questions and checks each one (see below).
- **Mistake notebook**: spaced repetition. A missed question comes back after 1, 3 and 7 days until you answer it correctly twice in a row.
- **Also**: a study plan, strategy lessons, vocabulary flashcards, progress charts, essay practice with AI scoring, and light and dark themes.

## How generated questions are checked

| # | Check | How |
|---|-------|-----|
| 1 | Official format | Local rules for each question type (for example, Sentence Equivalence has 6 choices and exactly 2 correct). |
| 2 | 3 independent solves | The question is solved from scratch 3 separate times without its answer key. All three must match the key. |
| 3 | Math re-run as code (Quant) | The assistant includes JavaScript that recomputes the answer. The server runs it in an isolated VM with a 1-second limit. |
| 4 | Expert review | A strict reviewer pass checks for a single defensible answer, no ambiguity, GRE style of at least 4/5, the right difficulty, and a correct explanation. |

Drafts that fail are discarded and rewritten. Each accepted question takes about 5 assistant calls, so expect 1–2 minutes per question.

## Configuration

Set these environment variables when starting the server:

| Variable | Effect |
|---|---|
| `PORT=9000` | Use a different port. Without it, the app uses 8742, or the next free port up to 8751. |
| `GRE_PIN=123456` | Use a fixed access code. |
| `GRE_NO_PIN=1` | Turn off the access code. Only do this on a network you trust. |
| `CLAUDE_BIN=/path/to/claude` | Location of the Claude Code CLI, if it isn't on your `PATH`. |
| `CODEX_BIN=/path/to/codex` | Location of the Codex CLI, if it isn't on your `PATH`. |
| `GRE_AGENT_PARALLEL=3` | Maximum number of assistant processes running at once. |
| `GRE_DATA_DIR=/path` | Where progress is saved. The default is `data/` in this folder. |

## Your data and safety

- All progress is saved in `data/db.json` on the host computer. Back up that file to keep your history. The access code is stored in `data/access-code.txt`. The `data/` folder is not tracked by git.
- The assistant runs in an empty temporary folder outside this project, with its tools turned off: no shell, file editing or web access for Claude Code, and no shell, web search or plugins in a read-only sandbox for Codex. It can only think and write text.
- Anyone on your network who has the access code can use the app, and their usage counts against your Claude or ChatGPT plan. Don't share the code.

GRE® is a registered trademark of ETS. This app is not endorsed or approved by ETS.
