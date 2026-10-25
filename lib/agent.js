// Bridge to the AI assistant CLI running on this computer: Claude Code (`claude -p`) or OpenAI Codex
// (`codex exec`), both in headless mode. Every AI feature (question generation, validation, essay
// scoring, tutor chat) goes through it, so it uses that CLI's existing login. No API key in this app.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const CODEX = process.env.CODEX_BIN || 'codex';
const MAX_PARALLEL = Number(process.env.GRE_AGENT_PARALLEL || 3);

// The tutor and question writer only need to think and write. Built-in tools that touch the
// computer (shell, files, web) are disabled, and the agent runs in an empty folder.
const DISALLOWED_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'Task', 'TodoWrite'];

// Codex has no per-tool deny list; turn off its tool features and keep the sandbox read-only instead.
const CODEX_DISABLED_FEATURES = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'image_generation',
  'browser_use', 'computer_use', 'view_image', 'skill_search', 'tool_suggest'];

export const PROVIDERS = { claude: 'Claude Code', codex: 'ChatGPT Codex' };
let provider = 'claude';
let workdir = process.cwd();
let systemFlag = '--system-prompt';          // falls back to --append-system-prompt on older CLIs
let partialMessages = true;                  // token streaming; disabled automatically if unsupported

export function configureAgent({ dataDir }) {
  // Outside the project on purpose: Claude Code loads CLAUDE.md from its working directory and every
  // parent, so running the tutor inside this folder would feed it the developer notes.
  workdir = path.join(os.tmpdir(), 'gre-prep-agent-workspace');
  fs.mkdirSync(workdir, { recursive: true });
}

/** Choose which CLI handles every following call: 'claude' or 'codex'. */
export function setProvider(name) {
  provider = PROVIDERS[name] ? name : 'claude';
}
export const getProvider = () => provider;

// ---- simple concurrency limit so we never start too many CLI processes ----
let active = 0;
const waiting = [];
async function acquire() {
  if (active < MAX_PARALLEL) { active++; return; }
  await new Promise((resolve) => waiting.push(resolve));
  active++;
}
function release() {
  active--;
  const next = waiting.shift();
  if (next) next();
}

function buildArgs({ prompt, system, format, model, resume, stream }) {
  const args = ['-p', prompt, '--output-format', format];
  if (stream) {
    args.push('--verbose');
    if (partialMessages) args.push('--include-partial-messages');
  }
  if (model) args.push('--model', model);
  if (resume) args.push('--resume', resume);
  if (system) args.push(systemFlag, system);
  args.push('--disallowedTools', ...DISALLOWED_TOOLS);   // keep last: it takes a list
  return args;
}

function run(args, { timeoutMs = 240000, onStdoutLine, signal, bin = CLAUDE } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: workdir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', buffer = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (onStdoutLine) {
        buffer += text;
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (line) onStdoutLine(line);
        }
      }
    });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.code !== 'ENOENT' ? String(err) : bin === CODEX
        ? `Codex CLI not found ("${CODEX}"). Install it (npm install -g @openai/codex) and log in, or set CODEX_BIN.`
        : `Claude Code CLI not found ("${CLAUDE}"). Install it and log in, or set CLAUDE_BIN.` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (onStdoutLine && buffer.trim()) onStdoutLine(buffer.trim());
      resolve({ code, stdout, stderr });
    });
  });
}

function unknownOption(stderr, name) {
  return new RegExp(`unknown option.*${name}|${name}.*(unknown|not recognized)`, 'i').test(stderr);
}

/** One-shot question → answer. Returns { text, sessionId }. */
export async function ask(prompt, opts = {}) {
  return provider === 'codex' ? codexTurn(prompt, { ...opts, ephemeral: true }) : claudeAsk(prompt, opts);
}

async function claudeAsk(prompt, { system, model, timeoutMs } = {}) {
  await acquire();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { code, stdout, stderr } = await run(buildArgs({ prompt, system, format: 'json', model }), { timeoutMs });
      if (code !== 0 && systemFlag === '--system-prompt' && unknownOption(stderr, 'system-prompt')) {
        systemFlag = '--append-system-prompt';
        continue;
      }
      let parsed;
      try { parsed = JSON.parse(stdout.trim().split('\n').pop()); } catch { parsed = null; }
      if (!parsed) throw new Error(cleanError(stderr || stdout || `Claude Code exited with code ${code}`, 'claude'));
      if (parsed.is_error) throw new Error(cleanError(parsed.result || 'Claude Code reported an error', 'claude'));
      return { text: parsed.result ?? '', sessionId: parsed.session_id };
    }
    throw new Error('Claude Code rejected the system prompt option.');
  } finally {
    release();
  }
}

/** Ask and parse the first JSON object in the reply. */
export async function askJSON(prompt, opts) {
  const { text } = await ask(prompt + '\n\nRespond with JSON only. No prose, no code fences.', opts);
  const json = extractJSON(text);
  if (!json) throw new Error(`Couldn't read the agent's JSON: ${text.slice(0, 160)}`);
  return json;
}

export function extractJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/**
 * Streaming chat turn. Calls onDelta(text) as tokens arrive.
 * Pass the previous sessionId to continue the same conversation (claude --resume / codex exec resume).
 * Session ids only work with the provider that created them.
 */
export async function chat(message, opts = {}) {
  if (provider !== 'codex') return claudeChat(message, opts);
  const result = await codexTurn(message, { ...opts, timeoutMs: 300000 });
  // Codex's JSON events carry whole messages, not token deltas, so the reply arrives in one piece.
  if (result.text && !result.aborted) opts.onDelta?.(result.text);
  return result;
}

async function claudeChat(message, { system, model, sessionId, onDelta, signal } = {}) {
  await acquire();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let full = '', streamed = '', newSession = sessionId, errorText = null;
      const { code, stderr } = await run(buildArgs({ prompt: message, system, format: 'stream-json', model, resume: sessionId, stream: true }), {
        signal,
        timeoutMs: 300000,
        onStdoutLine(line) {
          let ev;
          try { ev = JSON.parse(line); } catch { return; }
          if (ev.session_id) newSession = ev.session_id;
          if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
            streamed += ev.event.delta.text;
            onDelta?.(ev.event.delta.text);
          } else if (ev.type === 'assistant') {
            const text = (ev.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
            if (text) full += (full ? '\n\n' : '') + text;
          } else if (ev.type === 'result') {
            if (ev.is_error) errorText = ev.result || 'Claude Code reported an error';
            else if (typeof ev.result === 'string' && ev.result) full = ev.result;
          }
        },
      });
      if (code !== 0 && partialMessages && unknownOption(stderr, 'include-partial-messages')) { partialMessages = false; continue; }
      if (code !== 0 && systemFlag === '--system-prompt' && unknownOption(stderr, 'system-prompt')) { systemFlag = '--append-system-prompt'; continue; }
      if (signal?.aborted) return { text: streamed || full, sessionId: newSession, aborted: true };
      if (errorText || (code !== 0 && !full && !streamed)) throw new Error(cleanError(errorText || stderr || `Claude Code exited with code ${code}`, 'claude'));
      const text = full || streamed;
      // If tokens weren't streamed (older CLI), send the whole reply now.
      if (!streamed && text) onDelta?.(text);
      return { text, sessionId: newSession };
    }
    throw new Error('Claude Code rejected the chat options.');
  } finally {
    release();
  }
}

/**
 * One Codex turn (`codex exec --json`, or `codex exec resume <id>` to continue a conversation).
 * Note: codex exits 0 even when the turn fails, so failure is read from the `turn.failed` / `error` events.
 */
async function codexTurn(prompt, { system, model, sessionId, timeoutMs, signal, ephemeral } = {}) {
  await acquire();
  try {
    const args = ['exec'];
    if (sessionId) args.push('resume');
    args.push('--json', '--skip-git-repo-check', '--ignore-user-config', '-c', 'sandbox_mode="read-only"', '-c', 'web_search="disabled"');
    for (const f of CODEX_DISABLED_FEATURES) args.push('--disable', f);
    if (ephemeral) args.push('--ephemeral');
    if (model) args.push('-m', model);
    // The value is parsed as TOML; a JSON-escaped string is a valid TOML basic string.
    if (system) args.push('-c', `developer_instructions=${JSON.stringify(system)}`);
    if (sessionId) args.push(sessionId);
    args.push('--', prompt);

    let text = '', newSession = sessionId, errorText = null;
    const { code, stderr } = await run(args, {
      bin: CODEX, signal, timeoutMs,
      onStdoutLine(line) {
        let ev;
        try { ev = JSON.parse(line); } catch { return; }
        if (ev.type === 'thread.started' && ev.thread_id) newSession = ev.thread_id;
        // Codex may send short progress notes before its answer; the last message is the answer.
        else if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && ev.item.text) text = ev.item.text;
        else if (ev.type === 'turn.failed') errorText = ev.error?.message || 'Codex reported an error';
        else if (ev.type === 'error' && !errorText) errorText = ev.message || 'Codex reported an error';
        // item.type === 'error' events are warnings (e.g. config notices) and are ignored.
      },
    });
    if (signal?.aborted) return { text, sessionId: newSession, aborted: true };
    if (errorText || !text) throw new Error(cleanError(errorText || stderr || `Codex exited with code ${code}`, 'codex'));
    return { text, sessionId: newSession };
  } finally {
    release();
  }
}

/** Is the selected CLI (or the named one) installed and runnable? */
export async function status(name = provider) {
  const bin = name === 'codex' ? CODEX : CLAUDE;
  const { code, stdout, stderr } = await run(['--version'], { bin, timeoutMs: 15000 });
  const base = { provider: name, label: PROVIDERS[name] };
  return code === 0
    ? { ...base, ok: true, version: stdout.trim() }
    : { ...base, ok: false, error: cleanError(stderr || stdout || `${PROVIDERS[name]} CLI not available`, name).split('\n')[0] };
}

function cleanError(text, name = provider) {
  const t = String(text).trim();
  // Codex errors arrive as JSON from the API; show the readable message inside.
  const inner = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(t);
  const msg = inner ? JSON.parse(`"${inner[1]}"`) : t;
  if (/not logged in|login|authenticat|invalid api key|unauthorized/i.test(msg)) {
    return name === 'codex'
      ? 'Codex is not logged in on the host computer. Open Terminal there, run `codex login`, and sign in with ChatGPT.'
      : 'Claude Code is not logged in on the host computer. Open Terminal there, run `claude`, and sign in.';
  }
  return msg.slice(0, 400);
}
