#!/bin/bash
# Double-click this file on your Mac to start GRE Prep.
cd "$(dirname "$0")"

# Finder-launched shells may not include Homebrew / npm paths.
export PATH="$HOME/.local/bin:$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org (LTS) or run: brew install node"
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
if ! command -v claude >/dev/null 2>&1 && [ -z "$CLAUDE_BIN" ]; then
  echo "Warning: the Claude Code CLI ('claude') was not found. The app will run, but AI features need it."
  echo "Install: npm install -g @anthropic-ai/claude-code   then run 'claude' once to sign in."
  echo
fi

node server.js
