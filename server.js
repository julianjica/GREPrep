// GRE Prep — local server. Run on your computer, open from any device on the same Wi-Fi.
//   node server.js            (or double-click start.command on a Mac)
// Environment options: PORT (default 8742), GRE_PIN (fixed access code), GRE_NO_PIN=1 (disable the code),
// CLAUDE_BIN / CODEX_BIN (paths to the AI assistant CLIs), GRE_DATA_DIR (where progress is saved).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/db.js';
import { configureAgent, setProvider, getProvider, PROVIDERS, ask, askJSON, chat, status as agentStatus } from './lib/agent.js';
import { startJob, getJob, cancelJob, plainText } from './lib/generator.js';
import { BANK, TYPES, ESSAY_INSTRUCTIONS, topicAccuracy, daysUntil, sectionOf, answerText, estimateScore } from './public/content.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
let PORT = Number(process.env.PORT || 8742);
const DATA_DIR = process.env.GRE_DATA_DIR || path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');

const store = new Store(DATA_DIR);
configureAgent({ dataDir: DATA_DIR });
const db = () => store.data;
setProvider(db().profile.provider);
// Model names differ between Claude Code and Codex, so each provider keeps its own.
const aiModel = () => (getProvider() === 'codex' ? db().profile.codexModel : db().profile.model);

// ---------- access code (keeps other people on the same Wi-Fi out) ----------
const PIN_REQUIRED = process.env.GRE_NO_PIN !== '1';
const pinFile = path.join(DATA_DIR, 'access-code.txt');
const PIN = process.env.GRE_PIN || (fs.existsSync(pinFile) ? fs.readFileSync(pinFile, 'utf8').trim()
  : (() => { const p = String(crypto.randomInt(100000, 999999)); fs.writeFileSync(pinFile, p); return p; })());
const SESSION_SECRET = crypto.createHash('sha256').update('gre:' + PIN).digest('hex').slice(0, 32);

function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function authorized(req) {
  if (!PIN_REQUIRED || isLocal(req)) return true;
  const cookie = req.headers.cookie || '';
  return cookie.split(';').some((c) => c.trim() === `gre_session=${SESSION_SECRET}`);
}

// ---------- helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 2e6) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  if (url.pathname === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const allQuestions = () => [...BANK, ...db().saved.map((s) => s.question)];
const findQuestion = (id) => allQuestions().find((q) => q.id === id);

// ---------- study logic on the server ----------
const SR_INTERVALS = [1, 3, 7];   // days until next review after 0, 1, 2 correct in a row
const MASTERY = 2;

function recordAttempt({ question, correct, seconds }) {
  const q = question?.id ? (findQuestion(question.id) ?? question) : null;
  if (!q || !TYPES[q.type]) throw new Error('Unknown question');
  db().attempts.push({ questionId: q.id, topic: q.topic, type: q.type, section: sectionOf(q), difficulty: q.difficulty, correct: !!correct, seconds: Math.round(seconds || 0), date: Date.now() });
  const m = db().mistakes[q.id];
  if (correct) {
    if (m && !m.mastered) {
      m.streak += 1; m.lastSeen = Date.now();
      if (m.streak >= MASTERY) m.mastered = true;
      else m.due = Date.now() + SR_INTERVALS[Math.min(m.streak, SR_INTERVALS.length - 1)] * 86400000;
    }
  } else if (m) {
    Object.assign(m, { streak: 0, misses: m.misses + 1, mastered: false, lastSeen: Date.now(), due: Date.now() + 86400000 });
  } else {
    db().mistakes[q.id] = { question: q, reason: 'unclassified', due: Date.now(), streak: 0, misses: 1, mastered: false, lastSeen: Date.now() };
  }
  return db().mistakes[q.id] ?? null;
}

function studentContext() {
  const d = db();
  const acc = Object.entries(topicAccuracy(d.attempts.slice(-300)))
    .filter(([, v]) => v.total >= 2).sort((a, b) => a[1].accuracy - b[1].accuracy);
  const weak = acc.slice(0, 4).map(([t, v]) => `${t} (${Math.round(v.accuracy * 100)}%)`).join(', ') || 'not enough data yet';
  const q = estimateScore(d.attempts, 'quant'); const v = estimateScore(d.attempts, 'verbal');
  return `Student profile: target Quant ${d.profile.targetQuant}, Verbal ${d.profile.targetVerbal}; test in ${daysUntil(d.profile.testDate)} days; ` +
    `rough current estimate Quant ${q ?? 'unknown'}, Verbal ${v ?? 'unknown'}; weakest topics: ${weak}; ` +
    `${Object.values(d.mistakes).filter((m) => !m.mastered).length} unresolved mistakes.`;
}

const TUTOR_SYSTEM = () => `You are a friendly, expert GRE tutor talking with one student through a study app.
Help them understand concepts, work through problems, plan their studying, and build test-day strategy.
- Prefer guiding questions and hints before full solutions when they are working on a problem; give the full solution when they ask or are stuck.
- Be concise: short paragraphs, numbered steps for solutions, plain-text math (x², √, ≤, π).
- When useful, make up a fresh practice question in GRE format and wait for their answer.
- Be accurate. If a question seems flawed or ambiguous, say so.
- You have no tools and cannot see the app; rely on what the student tells you.
${studentContext()}`;

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/login' && m === 'POST') {
    const { pin } = await readBody(req);
    if (!PIN_REQUIRED || String(pin).trim() === PIN) {
      return send(res, 200, { ok: true }, { 'Set-Cookie': `gre_session=${SESSION_SECRET}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` });
    }
    await new Promise((r) => setTimeout(r, 800));   // slow down guessing
    return send(res, 401, { error: 'Wrong access code' });
  }
  if (!authorized(req)) return send(res, 401, { error: 'Access code required' });

  if (p === '/api/state' && m === 'GET') {
    const d = db();
    return send(res, 200, {
      profile: d.profile, attempts: d.attempts, mistakes: d.mistakes, saved: d.saved.map((s) => s.question),
      vocab: d.vocab, planDone: d.planDone,
      essays: d.essays.map(({ id, date, prompt, feedback }) => ({ id, date, prompt, score: feedback?.score ?? null })),
      chats: d.chats.map(({ id, title, updated }) => ({ id, title, updated })).sort((a, b) => b.updated - a.updated),
    });
  }

  if (p === '/api/profile' && m === 'PUT') {
    const body = await readBody(req);
    const allowed = ['onboarded', 'targetQuant', 'targetVerbal', 'testDate', 'dailyMinutes', 'model', 'codexModel', 'provider'];
    for (const k of allowed) if (k in body) db().profile[k] = body[k];
    if (!PROVIDERS[db().profile.provider]) db().profile.provider = 'claude';
    setProvider(db().profile.provider);
    store.save();
    return send(res, 200, db().profile);
  }

  if (p === '/api/attempts' && m === 'POST') {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [body];
    const mistakes = items.map(recordAttempt);
    store.save();
    return send(res, 200, { mistakes });
  }

  let match;
  if ((match = p.match(/^\/api\/mistakes\/([\w-]+)$/)) && m === 'PUT') {
    const body = await readBody(req);
    const mk = db().mistakes[match[1]];
    if (!mk) return send(res, 404, { error: 'Not found' });
    if (body.reason) mk.reason = body.reason;
    store.save();
    return send(res, 200, mk);
  }

  if (p === '/api/vocab' && m === 'POST') {
    const { word, known } = await readBody(req);
    const box = db().vocab[word] ?? 0;
    db().vocab[word] = known ? Math.min(4, box + 1) : 0;
    store.save();
    return send(res, 200, { box: db().vocab[word] });
  }

  if (p === '/api/plan/toggle' && m === 'POST') {
    const { id } = await readBody(req);
    const set = new Set(db().planDone);
    set.has(id) ? set.delete(id) : set.add(id);
    db().planDone = [...set];
    store.save();
    return send(res, 200, { planDone: db().planDone });
  }

  // ---- agent: status ----
  if (p === '/api/agent/status' && m === 'GET') {
    // The selected assistant's status at the top level, plus every assistant's so Settings can offer the choice.
    const all = Object.fromEntries(await Promise.all(Object.keys(PROVIDERS).map(async (k) => [k, await agentStatus(k)])));
    return send(res, 200, { ...all[getProvider()], providers: all });
  }

  // ---- agent: question generation ----
  if (p === '/api/generate' && m === 'POST') {
    const { type, difficulty = 'medium', count = 5, topics = [] } = await readBody(req);
    if (!TYPES[type]) return send(res, 400, { error: 'Unknown type' });
    const job = startJob({
      type, difficulty, count: Math.max(1, Math.min(20, Number(count) || 5)), topics, existing: allQuestions(), model: aiModel(),
      onAccepted(q, checks) { db().saved.push({ question: q, checks, created: Date.now() }); store.save(); },
    });
    return send(res, 200, { id: job.id });
  }
  if ((match = p.match(/^\/api\/jobs\/([\w-]+)$/)) && m === 'GET') {
    const job = getJob(match[1]);
    if (!job) return send(res, 404, { error: 'Not found' });
    const { cancelled, ...rest } = job;
    return send(res, 200, rest);
  }
  if ((match = p.match(/^\/api\/jobs\/([\w-]+)\/cancel$/)) && m === 'POST') { cancelJob(match[1]); return send(res, 200, { ok: true }); }

  // ---- agent: hint for the current question (never reveals the answer) ----
  if (p === '/api/hint' && m === 'POST') {
    const { question } = await readBody(req);
    const q = findQuestion(question?.id) ?? question;
    const { text } = await ask(`${plainText(q)}\n\nThe answer is ${answerText(q)} (do NOT reveal it). Give the student one short hint (1-3 sentences) that points them toward the right approach without giving away the answer or eliminating all wrong choices.`, {
      system: 'You are a GRE tutor giving a single, short, non-revealing hint.', model: aiModel(), timeoutMs: 120000,
    });
    return send(res, 200, { hint: text.trim() });
  }

  // ---- agent: essay scoring ----
  if (p === '/api/essays' && m === 'POST') {
    const { prompt, text } = await readBody(req);
    if (!prompt || !text || text.split(/\s+/).length < 30) return send(res, 400, { error: 'Write at least 30 words first.' });
    const j = await askJSON(`Issue statement: ${prompt}\nTask: ${ESSAY_INSTRUCTIONS}\n\nResponse:\n"""\n${text}\n"""\n\nReturn {"score": number, "traits": {"Position & insight": number, "Reasoning & examples": number, "Organization": number, "Language & grammar": number}, "strengths": ["one or two specific strengths"], "improvements": ["two or three specific, actionable changes that would raise the score"]}`, {
      system: 'You are an experienced GRE Analytical Writing rater. Score Analyze an Issue responses holistically on the official 0–6 scale in half-point steps, as trained ETS raters do. Be honest and specific; do not inflate scores.',
      model: aiModel(), timeoutMs: 180000,
    });
    const feedback = {
      score: Math.max(0, Math.min(6, Number(j.score) || 0)),
      traits: Object.entries(j.traits ?? {}).map(([name, v]) => ({ name, score: Number(v) || 0 })),
      strengths: Array.isArray(j.strengths) ? j.strengths : [],
      improvements: Array.isArray(j.improvements) ? j.improvements : [],
    };
    const essay = { id: crypto.randomUUID(), date: Date.now(), prompt, text, feedback };
    db().essays.push(essay);
    store.save();
    return send(res, 200, essay);
  }

  // ---- agent: tutor chat ----
  if (p === '/api/chats' && m === 'GET') {
    return send(res, 200, db().chats.map(({ id, title, updated }) => ({ id, title, updated })).sort((a, b) => b.updated - a.updated));
  }
  if (p === '/api/chats' && m === 'POST') {
    const { title, context } = await readBody(req);
    const c = { id: crypto.randomUUID(), title: title || 'New conversation', sessionId: null, created: Date.now(), updated: Date.now(), context: context ?? null, messages: [] };
    db().chats.push(c);
    store.save();
    return send(res, 200, c);
  }
  if ((match = p.match(/^\/api\/chats\/([\w-]+)$/))) {
    const c = db().chats.find((x) => x.id === match[1]);
    if (!c) return send(res, 404, { error: 'Not found' });
    if (m === 'GET') return send(res, 200, c);
    if (m === 'DELETE') { db().chats = db().chats.filter((x) => x !== c); store.save(); return send(res, 200, { ok: true }); }
  }
  if ((match = p.match(/^\/api\/chats\/([\w-]+)\/messages$/)) && m === 'POST') {
    const c = db().chats.find((x) => x.id === match[1]);
    if (!c) return send(res, 404, { error: 'Not found' });
    const { text } = await readBody(req);
    if (!text?.trim()) return send(res, 400, { error: 'Empty message' });

    // First message of a conversation started from a question carries that question as context.
    let prompt = text.trim();
    // A session belongs to the assistant that started it. After switching assistants, start a new
    // session and hand over the conversation so far.
    if (c.sessionId && (c.provider ?? 'claude') !== getProvider()) {
      c.sessionId = null;
      const history = c.messages.map((x) => `${x.role === 'user' ? 'Student' : 'Tutor'}: ${x.text}`).join('\n\n');
      if (history) prompt = `Our conversation so far:\n\n${history}\n\nNow, continuing:\n${prompt}`;
    }
    if (!c.sessionId && !c.messages.length && c.context?.question) {
      const q = findQuestion(c.context.question.id) ?? c.context.question;
      prompt = `I'm working on this GRE question:\n\n${plainText(q)}\n\nCorrect answer: ${answerText(q)}\nExplanation from the app: ${q.explanation}\n` +
        (c.context.studentAnswer ? `My answer was: ${c.context.studentAnswer}\n` : '') + `\n${prompt}`;
    }
    c.messages.push({ role: 'user', text: text.trim(), at: Date.now() });
    if (c.title === 'New conversation') c.title = text.trim().slice(0, 60);
    c.updated = Date.now();
    store.save();

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    const write = (obj) => { if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n'); };
    try {
      const result = await chat(prompt, {
        system: TUTOR_SYSTEM(), model: aiModel(), sessionId: c.sessionId, signal: controller.signal,
        onDelta: (t) => write({ t: 'delta', text: t }),
      });
      c.sessionId = result.sessionId ?? c.sessionId;
      c.provider = getProvider();
      if (result.text) c.messages.push({ role: 'assistant', text: result.text, at: Date.now() });
      c.updated = Date.now();
      store.save();
      write({ t: 'done', text: result.text });
    } catch (err) {
      write({ t: 'error', error: err.message });
    }
    return res.end();
  }

  if (p === '/api/reset' && m === 'POST') { store.reset(); return send(res, 200, { ok: true }); }

  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: err.message });
    else res.end();
  }
});

function lanAddresses() {
  // Label interfaces so it's clear which address to use. On a Mac, en0/en1 is usually Wi-Fi or Ethernet;
  // utun* is a VPN (Tailscale shows up as a 100.x address); bridge*/vmnet*/docker* are virtual machines.
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      let label = 'other';
      if (/^en\d/.test(name)) label = 'Wi-Fi / Ethernet';
      if (/^utun|^tun|^wg|tailscale/i.test(name) || i.address.startsWith('100.')) label = 'VPN (e.g. Tailscale)';
      if (/^bridge|^vmnet|^docker|^veth|^vboxnet/.test(name)) label = 'virtual, ignore';
      out.push({ name, address: i.address, label });
    }
  }
  const rank = (x) => (x.label === 'Wi-Fi / Ethernet' ? 0 : x.label.startsWith('VPN') ? 1 : x.label === 'other' ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

// If the port is taken, try the next few automatically.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && !process.env.PORT && PORT < 8752) {
    console.log(`  Port ${PORT} is busy, trying ${PORT + 1}…`);
    PORT += 1;
    setTimeout(() => server.listen(PORT, '0.0.0.0'), 100);
  } else {
    console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Start with another, e.g. PORT=8800 node server.js` : err);
    process.exit(1);
  }
});

server.on('listening', async () => {
  const st = await agentStatus();
  const host = os.hostname().replace(/\.local$/, '');
  console.log('\n  GRE Prep is running.\n');
  console.log(`  On this computer:      http://localhost:${PORT}`);
  const addrs = lanAddresses();
  if (!addrs.length) console.log('  On other devices:      (no network connection found)');
  for (const a of addrs) console.log(`  On other devices:      http://${a.address}:${PORT}   [${a.name}: ${a.label}]`);
  console.log(`  (or try)              http://${host}.local:${PORT}`);
  if (PIN_REQUIRED) console.log(`\n  Access code for other devices: ${PIN}`);
  console.log(st.ok ? `\n  Agent: ${st.label} ${st.version}` : `\n  Agent (${st.label}): NOT AVAILABLE — ${st.error}`);
  console.log('\n  Keep this window open while studying. Press Ctrl+C to stop.\n');
});

server.listen(PORT, '0.0.0.0');

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); process.exit(0); });
