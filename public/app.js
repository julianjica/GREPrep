import * as C from './content.js';
import { esc, icon, md, clock, pct, meter, relDay } from './ui.js';

const app = document.getElementById('app');
let S = null;                       // state from the server (progress lives on the host computer)
let agent = { ok: null };           // selected AI assistant CLI status (+ every assistant's under .providers)
const ui = {
  session: null, exam: null, vocab: null, lessonStep: {}, mistakeFilter: null, planDay: 0, onboardingStep: 0,
  gen: { type: 'quantComparison', difficulty: 'medium', count: 5, focusWeak: true, job: null, showRejected: false, polling: null },
  writing: null, chat: { current: null, streaming: false, list: [] }, toast: null,
};

// ---------------------------------------------------------------- API

class AuthError extends Error {}
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && path !== '/api/login') throw new AuthError();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function load() {
  try {
    S = await api('/api/state');
    ui.chat.list = S.chats;
    render();
    api('/api/agent/status').then((s) => { agent = s; if (!['session', 'exam'].includes(route().name)) render(); }).catch(() => {});
  } catch (err) {
    if (err instanceof AuthError) return renderLogin();
    app.innerHTML = `<div class="center-screen"><div class="card pad-lg stack" style="max-width:420px"><div class="h2">Can't reach the GRE Prep server</div><p class="muted">Make sure the server is still running on the host computer, then reload.</p><button class="btn" onclick="location.reload()">Reload</button></div></div>`;
  }
}

function toast(text) {
  ui.toast = text;
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = text; el.setAttribute('role', 'status');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------------------------------------------------------------- derived data

const pool = () => [...C.BANK, ...S.saved];
const profile = () => S.profile;
const openMistakes = () => Object.values(S.mistakes).filter((m) => !m.mastered);
const dueMistakes = () => openMistakes().filter((m) => m.due <= Date.now());
function weakTopics(type) {
  const list = type ? S.attempts.filter((a) => a.type === type) : S.attempts;
  return Object.entries(C.topicAccuracy(list)).filter(([, v]) => v.accuracy < 0.7).sort((a, b) => a[1].accuracy - b[1].accuracy).slice(0, 3).map(([k]) => k);
}
function wordOfDay() {
  const day = Math.floor(Date.now() / 86400000);
  return C.VOCAB[day % C.VOCAB.length];
}

// ---------------------------------------------------------------- routing

function route() {
  const [name = 'home', param] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'home', param: param ? decodeURIComponent(param) : undefined };
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

function render() {
  if (!S) return;
  if (!profile().onboarded) return (app.innerHTML = viewOnboarding());
  const r = route();
  const views = {
    home: () => shell(viewHome(), 'home'),
    practice: () => shell(viewPractice(), 'practice'),
    tutor: () => shell(viewTutor(r.param), 'tutor', true),
    vocab: () => shell(viewVocab(), 'vocab'),
    progress: () => shell(viewProgress(), 'progress'),
    plan: () => shell(viewPlan(), 'home'),
    lessons: () => shell(viewLessons(), 'practice'),
    lesson: () => shell(viewLesson(r.param), 'practice'),
    mistakes: () => shell(viewMistakes(), 'practice'),
    writing: () => shell(viewWriting(), 'practice'),
    generate: () => shell(viewGenerate(), 'practice'),
    settings: () => shell(viewSettings(), 'settings'),
    goal: () => shell(viewGoal(), 'settings'),
    session: () => (ui.session ? viewSession() : shell(viewPractice(), 'practice')),
    exam: () => (ui.exam ? viewExam() : shell(viewPractice(), 'practice')),
  };
  app.innerHTML = (views[r.name] ?? views.home)();
  afterRender(r);
}

function afterRender(r) {
  if (r.name === 'tutor') {
    const box = document.getElementById('messages');
    if (box) box.scrollTop = box.scrollHeight;
  }
  if (r.name === 'tutor' && r.param && (!ui.chat.current || ui.chat.current.id !== r.param)) loadChat(r.param);
}

const NAV = [
  ['home', 'Home', 'home'], ['practice', 'Practice', 'practice'], ['tutor', 'Tutor', 'chat'],
  ['vocab', 'Vocab', 'cards'], ['progress', 'Progress', 'chart'],
];

function shell(content, active, wide = false) {
  const links = NAV.map(([id, label, ic]) => `<a class="navlink${active === id ? ' active' : ''}" href="#/${id}" ${active === id ? 'aria-current="page"' : ''}>${icon(ic)}${label}</a>`).join('');
  const tabs = NAV.map(([id, label, ic]) => `<a class="${active === id ? 'active' : ''}" href="#/${id}" ${active === id ? 'aria-current="page"' : ''}>${icon(ic, 22)}${label}</a>`).join('');
  const agentState = agent.ok === null ? '' : `<div class="agent-pill" title="${esc(agent.ok ? agent.version : agent.error)}"><span class="dot ${agent.ok ? 'ok' : 'bad'}"></span>${agent.ok ? 'Agent ready' : 'Agent offline'}</div>`;
  return `<div class="shell">
    <nav class="sidenav" aria-label="Main">
      <div class="brand"><span class="brand-mark">GRE</span>GRE Prep</div>
      ${links}
      <div class="spacer"></div>
      ${agentState}
      <a class="navlink${active === 'settings' ? ' active' : ''}" href="#/settings">${icon('gear')}Settings</a>
    </nav>
    <main class="content"><div class="page${wide ? ' wide' : ''}">${content}</div></main>
    <nav class="tabbar" aria-label="Main">${tabs}</nav>
  </div>`;
}

const backLink = (href, label) => `<a href="${href}" class="row small" style="gap:4px;min-height:44px;font-weight:500">${icon('back', 18)}${esc(label)}</a>`;

// ---------------------------------------------------------------- login & onboarding

function renderLogin(error) {
  app.innerHTML = `<div class="center-screen"><form class="card pad-lg stack" style="width:100%;max-width:380px" id="login-form">
    <div class="brand" style="padding:0"><span class="brand-mark">GRE</span>GRE Prep</div>
    <p class="muted small">Enter the access code shown in the server window on the host computer.</p>
    <label class="lbl" for="pin">Access code</label>
    <input class="field" id="pin" inputmode="numeric" autocomplete="one-time-code" autofocus>
    ${error ? `<p class="small" style="color:var(--wrong)">${esc(error)}</p>` : ''}
    <button class="btn block" type="submit">Continue</button></form></div>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/login', { method: 'POST', body: { pin: document.getElementById('pin').value } }); load(); }
    catch (err) { renderLogin(err.message); }
  });
}

function goalFields() {
  const p = profile();
  const date = new Date(p.testDate);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const stepper = (key, label) => `<div class="row between"><span>${label}</span><div class="stepper">
      <button type="button" data-action="score" data-key="${key}" data-d="-1" aria-label="Lower ${label} target">−</button>
      <output>${p[key]}</output>
      <button type="button" data-action="score" data-key="${key}" data-d="1" aria-label="Raise ${label} target">+</button></div></div>`;
  return `<div class="card stack">
      <div class="row between"><span class="h3">Target score</span><span class="muted">Total <strong style="color:var(--ink);font-size:20px">${p.targetQuant + p.targetVerbal}</strong></span></div>
      ${stepper('targetQuant', 'Quant')}${stepper('targetVerbal', 'Verbal')}
      <p class="xs muted">Each section is scored 130–170.</p></div>
    <div class="stack"><label class="h3" for="test-date">When is your test?</label>
      <input class="field" type="date" id="test-date" data-input="testDate" value="${iso}" min="${new Date().toISOString().slice(0, 10)}">
      <div class="row wrap" style="gap:8px">
        <button class="chip" data-action="test-in" data-days="30">In 1 month</button>
        <button class="chip" data-action="test-in" data-days="42">In 6 weeks</button>
        <button class="chip" data-action="test-in" data-days="90">In 3 months</button></div></div>
    <div class="stack"><span class="h3">Daily study time</span>
      <div class="segmented" role="group" aria-label="Daily study time">${[15, 30, 60, 90].map((m) => `<button data-action="minutes" data-m="${m}" aria-pressed="${p.dailyMinutes === m}">${m} min</button>`).join('')}</div></div>`;
}

function viewOnboarding() {
  if (ui.onboardingStep === 0) {
    const f = (ic, t) => `<div class="row" style="align-items:flex-start;gap:14px"><span class="icon-tile t-accent" style="width:36px;height:36px">${icon(ic, 18)}</span><span>${t}</span></div>`;
    return `<div class="center-screen"><div class="stack" style="max-width:460px;gap:22px">
      <span class="brand-mark" style="width:56px;height:56px;font-size:18px;border-radius:14px">GRE</span>
      <h1 class="title">Prepare to ace the GRE</h1>
      ${f('calendar', 'A day-by-day plan built around your test date')}
      ${f('chat', 'A tutor agent you can chat with about any problem')}
      ${f('sparkles', 'Unlimited new questions, each checked 4 ways before you see it')}
      ${f('timer', 'Timed sections that work like the real test')}
      ${f('book', 'A mistake notebook that brings back what you miss')}
      <button class="btn block" data-action="onboard-next">Get started</button></div></div>`;
  }
  return `<div class="center-screen"><div class="stack" style="max-width:520px;width:100%;gap:20px">
    <h1 class="title">Set your goal</h1><p class="muted">We'll build a plan around your target and test date.</p>
    ${goalFields()}
    <button class="btn block" data-action="onboard-done">Build my plan</button></div></div>`;
}

function viewGoal() {
  return `${backLink('#/settings', 'Settings')}<h1 class="title">Edit goal</h1>${goalFields()}
    <button class="btn block" data-action="goal-save">Save</button>`;
}

// ---------------------------------------------------------------- home

function viewHome() {
  const p = profile();
  const goal = C.dailyGoal(p.dailyMinutes);
  const today = C.answeredToday(S.attempts);
  const streak = C.streak(S.attempts);
  const wod = wordOfDay();
  const row = (action, data, ic, tile, title, detail) => `<button class="card row" data-action="${action}" ${data}>
      <span class="icon-tile ${tile}">${icon(ic, 22)}</span>
      <span style="flex:1"><span class="h3" style="display:block">${title}</span><span class="small muted">${detail}</span></span>${icon('chevron', 18)}</button>`;
  const tile = (href, ic, color, title, detail) => `<a class="card stack tight" href="${href}"><span style="color:${color}">${icon(ic, 22)}</span><span class="h3" style="font-size:15px">${title}</span><span class="xs muted">${detail}</span></a>`;
  return `
    <header class="row between">
      <div class="stack tight"><a href="#/plan" class="small muted">Test in ${C.daysUntil(p.testDate)} days · <span style="color:var(--accent);font-weight:600">View plan</span></a>
        <h1 class="title">Ready to practice?</h1></div>
      <span class="tag" style="background:var(--warn-soft);color:var(--warn);text-transform:none;letter-spacing:0;font-size:14px;padding:8px 12px;border-radius:999px" aria-label="${streak} day streak">${icon('flame', 16)}${streak} day${streak === 1 ? '' : 's'}</span>
    </header>
    <section class="hero">
      <div class="row between"><h2 class="h3">Today's set</h2><span class="small" style="opacity:.85">10 questions · ~15 min</span></div>
      <div class="stack tight"><div class="row between small"><span>Daily goal</span><strong>${Math.min(today, goal)} / ${goal}</strong></div>${meter(today / goal, '#fff')}</div>
      <button class="btn white block" data-action="daily">Start practice ${icon('arrow', 18)}</button>
    </section>
    <div class="grid2">
      <a class="card row dashed" href="#/tutor"><span class="icon-tile t-accent">${icon('chat', 22)}</span><span><span class="h3" style="display:block">Ask the tutor</span><span class="small muted">Talk through any problem</span></span></a>
      <a class="card row dashed" href="#/generate"><span class="icon-tile t-accent">${icon('sparkles', 22)}</span><span><span class="h3" style="display:block">New questions</span><span class="small muted">Written and checked by the agent</span></span></a>
    </div>
    <section class="stack"><h2 class="h2">Practice by section</h2>
      ${row('section', 'data-s="quant"', 'function', 't-accent', 'Quantitative Reasoning', 'Algebra, geometry, data analysis')}
      ${row('section', 'data-s="verbal"', 'reader', 't-good', 'Verbal Reasoning', 'Text completion, reading, equivalence')}
      ${row('nav', 'data-to="#/writing"', 'pencil', 't-warn', 'Analytical Writing', 'Issue essay, timed, scored by the agent')}
    </section>
    <section class="stack"><h2 class="h2">Train like test day</h2>
      <div class="grid4 collapse">
        ${tile('#/practice', 'timer', 'var(--accent)', 'Timed section', 'Real test timing')}
        ${tile('#/lessons', 'bulb', 'var(--correct)', 'Strategy lessons', `${C.LESSONS.length} short lessons`)}
        ${tile('#/mistakes', 'book', 'var(--warn)', 'Mistake notebook', `${dueMistakes().length} due today`)}
        ${tile('#/plan', 'calendar', 'var(--accent)', 'Study plan', 'Your schedule')}
      </div></section>
    <a class="card row between" href="#/vocab"><span class="stack tight"><span class="eyebrow">Word of the day</span><span style="font-size:22px;font-weight:700">${esc(wod.word)}</span><span class="small muted">${esc(wod.def)}</span></span><span class="small" style="font-weight:600">Review</span></a>`;
}

// ---------------------------------------------------------------- practice hub & session

function viewPractice() {
  const all = pool();
  const sec = (s) => {
    const types = Object.entries(C.TYPES).filter(([, t]) => t.section === s);
    return `<section class="stack"><h2 class="h2">${C.SECTIONS[s].title}</h2><div class="card stack" style="gap:0">
      <button class="row between" style="border:none;background:none;min-height:52px;padding:4px 0;text-align:left" data-action="section" data-s="${s}"><span class="row">${icon('practice', 18)}Mixed ${C.SECTIONS[s].short} set</span><span class="small muted">10 questions</span></button>
      ${types.map(([id, t]) => `<div class="divider"></div><button class="row between" style="border:none;background:none;min-height:52px;padding:4px 0;text-align:left" data-action="type" data-t="${id}"><span>${t.title}</span><span class="small muted">${all.filter((q) => q.type === id).length} questions</span></button>`).join('')}
      <div class="divider"></div><button class="row between" style="border:none;background:none;min-height:52px;padding:4px 0;text-align:left" data-action="exam" data-s="${s}"><span class="row">${icon('timer', 18)}Timed section</span><span class="small muted">${C.SECTIONS[s].examCount} questions · ${C.SECTIONS[s].examMinutes} min</span></button>
    </div></section>`;
  };
  return `<h1 class="title">Practice</h1>
    <a class="card row dashed" href="#/generate"><span class="icon-tile t-accent">${icon('sparkles', 22)}</span><span style="flex:1"><span class="h3" style="display:block">Generate new questions</span><span class="small muted">${S.saved.length} agent-verified questions in your bank</span></span>${icon('chevron', 18)}</a>
    ${sec('quant')}${sec('verbal')}
    <section class="stack"><h2 class="h2">Study tools</h2><div class="grid2">
      <a class="card row" href="#/mistakes">${icon('book')}<span>Mistake notebook</span></a>
      <a class="card row" href="#/lessons">${icon('bulb')}<span>Strategy lessons</span></a>
      <a class="card row" href="#/writing">${icon('pencil')}<span>Analytical Writing</span></a>
      <a class="card row" href="#/plan">${icon('calendar')}<span>Study plan</span></a>
    </div></section>`;
}

function startSession(title, questions) {
  ui.session = { title, questions, index: 0, selected: [], numeric: '', revealed: false, results: [], startedAt: Date.now(), mistake: null, hint: null, hintLoading: false, finished: false };
  go('#/session');
}

function renderQuestion(q, { selected, numeric, revealed, exam }) {
  const multi = C.allowsMultiple(q);
  let html = `<p class="small muted">${esc(C.instruction(q))}</p>`;
  if (q.passage) html += `<div class="card passage">${esc(q.passage)}</div>`;
  if (q.type === 'quantComparison') {
    if (q.stem) html += `<p style="text-align:center;font-size:17px">${esc(q.stem)}</p>`;
    html += `<div class="qboxes"><div class="qbox"><span class="eyebrow">Quantity A</span><span class="v">${esc(q.quantityA)}</span></div><div class="qbox"><span class="eyebrow">Quantity B</span><span class="v">${esc(q.quantityB)}</span></div></div>`;
  } else {
    html += `<p class="qstem">${esc(q.stem)}</p>`;
  }
  if (q.type === 'numericEntry') {
    const state = revealed ? (C.isCorrect(q, [], numeric) ? 'right' : 'wrong') : '';
    html += `<div class="numeric"><label class="sr-only" for="numeric">Your answer</label><input id="numeric" class="${state}" data-input="${exam ? 'exam-numeric' : 'numeric'}" value="${esc(numeric)}" inputmode="decimal" autocomplete="off" ${revealed ? 'disabled' : ''}>${q.unit ? `<span>${esc(q.unit)}</span>` : ''}</div>`;
    if (revealed) html += `<p class="small" style="color:var(--correct);font-weight:600">Correct answer: ${esc(C.answerText(q))}</p>`;
  } else {
    html += `<div class="choices" role="${multi ? 'group' : 'radiogroup'}" aria-label="Answer choices">` + q.choices.map((c, i) => {
      const sel = selected.includes(i);
      let cls = sel ? 'selected' : '';
      let mark = '';
      if (revealed) {
        if (q.correct.includes(i)) { cls = 'right'; mark = icon('check', 20, 'Correct answer'); }
        else if (sel) { cls = 'wrong'; mark = icon('x', 20, 'Your answer, incorrect'); }
        else cls = 'dim';
      }
      const marker = exam ? '<span class="mk"></span>' : `<span class="ltr">${C.letter(i)}</span>`;
      return `<button class="choice ${cls}${multi ? ' multi' : ''}${exam ? ' exam' : ''}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${sel}" data-action="${exam ? 'exam-pick' : 'pick'}" data-i="${i}">${marker}<span class="txt">${esc(c)}</span>${mark}</button>`;
    }).join('') + '</div>';
  }
  return html;
}

function viewSession() {
  const s = ui.session;
  if (!s.questions.length) {
    return `<div class="session"><div class="center-screen" style="min-height:60vh"><div class="stack" style="text-align:center;align-items:center"><div class="h2">No questions here yet</div><p class="muted">Generate some with the agent first.</p><a class="btn" href="#/generate">Generate questions</a><a href="#/practice">Back to practice</a></div></div></div>`;
  }
  if (s.finished) {
    const correct = s.results.filter(Boolean).length;
    return `<div class="session"><div class="center-screen" style="min-height:70vh"><div class="stack" style="text-align:center;align-items:center;max-width:420px">
      <span style="color:var(--accent)">${icon('check', 56)}</span>
      <h1 class="title">${correct} of ${s.results.length} correct</h1>
      <p class="muted">${correct < s.results.length ? 'Missed questions were added to your mistake notebook for spaced review.' : 'Clean sweep. Try a harder set or a timed section next.'}</p>
      <div class="row"><button class="btn secondary" data-action="session-tutor-summary">${icon('chat', 18)}Discuss with tutor</button><button class="btn" data-action="session-close">Done</button></div>
    </div></div></div>`;
  }
  const q = s.questions[s.index];
  const correct = s.results[s.index];
  const reasonChips = !s.revealed || correct || !s.mistake ? '' : `<div class="divider"></div><p class="small" style="font-weight:600">Why did you miss it?</p>
    <div class="row wrap" style="gap:8px">${Object.entries(C.REASONS).filter(([k]) => k !== 'unclassified').map(([k, label]) => `<button class="chip" data-action="reason" data-r="${k}" aria-pressed="${s.mistake.reason === k}">${label}</button>`).join('')}</div>
    <p class="xs muted">Saved to your mistake notebook. It will come back tomorrow.</p>`;
  return `<div class="session">
    <div class="session-head">
      <button class="iconbtn" data-action="session-close" aria-label="Close practice">${icon('x')}</button>
      <div style="flex:1" class="stack tight"><div class="row between xs muted"><span>Question ${s.index + 1} of ${s.questions.length}</span><span>${esc(s.title)}</span></div>${meter((s.index + (s.revealed ? 1 : 0)) / s.questions.length, null, true)}</div>
    </div>
    <div class="session-body">
      <div class="row wrap" style="gap:8px"><span class="tag">${esc(C.TYPES[q.type].title)}</span>${q.source === 'ai' ? `<span class="tag good">${icon('check', 12)}Agent · Verified</span>` : ''}</div>
      ${renderQuestion(q, { selected: s.selected, numeric: s.numeric, revealed: s.revealed })}
      ${s.hint ? `<div class="callout info small">${icon('bulb', 16)} ${esc(s.hint)}</div>` : ''}
      ${s.revealed ? `<section class="card stack" aria-live="polite">
        <h2 class="h3" style="color:var(${correct ? '--correct' : '--wrong'})">${correct ? 'Correct — nice work' : `Not quite — answer ${esc(C.answerText(q))}`}</h2>
        <p class="small">${esc(q.explanation)}</p>
        <div class="row wrap" style="gap:8px"><span class="tag plain">${esc(q.topic)}</span><span class="tag plain">${esc(q.difficulty)}</span></div>
        <button class="btn soft small" style="align-self:flex-start" data-action="ask-tutor">${icon('chat', 16)}${correct ? 'Discuss with the tutor' : 'Ask the tutor why'}</button>
        ${reasonChips}</section>` : ''}
    </div>
    <div class="session-foot">
      ${s.revealed ? `<button class="btn dark block" data-action="session-next">${s.index + 1 < s.questions.length ? 'Next question' : 'See summary'}</button>`
        : `<button class="btn secondary" data-action="hint" ${s.hintLoading || s.hint ? 'disabled' : ''} aria-label="Get a hint">${s.hintLoading ? '<span class="spinner"></span>' : icon('bulb', 18)}<span>Hint</span></button>
           <button class="btn block" id="check-btn" data-action="check" ${C.hasAnswer(q, s.selected, s.numeric) ? '' : 'disabled'}>Check answer</button>`}
    </div></div>`;
}

// ---------------------------------------------------------------- timed exam

let examTimer = null;
function startExam(section) {
  const sec = C.SECTIONS[section];
  const qs = C.makeSet(pool(), S.attempts, sec.examCount, { section }).sort((a, b) => (a.passage ?? '').localeCompare(b.passage ?? ''));
  ui.exam = { section, questions: qs, index: 0, sel: {}, num: {}, marked: [], visited: [0], review: false, showTimer: true, remaining: sec.examMinutes * 60, limit: sec.examMinutes * 60, spent: {}, result: null, confirm: false };
  clearInterval(examTimer);
  examTimer = setInterval(tickExam, 1000);
  go('#/exam');
}

function tickExam() {
  const e = ui.exam;
  if (!e || e.result) { clearInterval(examTimer); return; }
  if (route().name !== 'exam') return;   // paused while away
  if (!e.review) e.spent[e.index] = (e.spent[e.index] ?? 0) + 1;
  e.remaining -= 1;
  const el = document.getElementById('exam-timer');
  if (el && e.showTimer) { el.querySelector('span').textContent = clock(e.remaining); el.classList.toggle('low', e.remaining < 120); }
  if (e.remaining <= 0) finishExam();
}

const examAnswered = (e, i) => C.hasAnswer(e.questions[i], e.sel[i] ?? [], e.num[i] ?? '');

async function finishExam() {
  const e = ui.exam;
  clearInterval(examTimer);
  const correct = e.questions.map((q, i) => C.isCorrect(q, e.sel[i] ?? [], e.num[i] ?? ''));
  const seconds = e.questions.map((_, i) => e.spent[i] ?? 0);
  e.result = { correct, seconds, timeUsed: e.limit - Math.max(0, e.remaining), score: C.scaledScore(e.questions.map((q, i) => ({ correct: correct[i], difficulty: q.difficulty }))) };
  render();
  try {
    await api('/api/attempts', { method: 'POST', body: { items: e.questions.map((q, i) => ({ question: q, correct: correct[i], seconds: seconds[i] })) } });
    S = await api('/api/state');
  } catch (err) { toast(err.message); }
}

function viewExam() {
  const e = ui.exam;
  if (e.result) return viewExamResults();
  if (!e.questions.length) return `<div class="session"><p>No questions available for this section.</p><a href="#/practice">Back</a></div>`;
  const sec = C.SECTIONS[e.section];
  const unanswered = e.questions.filter((_, i) => !examAnswered(e, i)).length;
  const marked = e.marked.includes(e.index);
  const body = e.review ? `
    <h1 class="h2">Review section</h1>
    <div class="row wrap xs muted" style="gap:14px"><span class="row" style="gap:6px"><span class="tile ans" style="width:14px;height:14px;border-radius:3px;border:0"></span>Answered</span><span class="row" style="gap:6px"><span class="tile marked" style="width:14px;height:14px;border-radius:3px;background:none"></span>Marked</span><span class="row" style="gap:6px"><span class="tile" style="width:14px;height:14px;border-radius:3px"></span>Not answered</span></div>
    <div class="grid4">${e.questions.map((_, i) => {
      const a = examAnswered(e, i); const m = e.marked.includes(i);
      return `<button class="tile${a ? ' ans' : ''}${m ? ' marked' : ''}" data-action="exam-go" data-i="${i}" aria-label="Question ${i + 1}, ${m ? 'marked' : a ? 'answered' : 'not answered'}">${i + 1}<small>${m ? 'Marked' : a ? 'Answered' : e.visited.includes(i) ? 'Open' : 'Not seen'}</small></button>`;
    }).join('')}</div>
    <p class="small muted">Like the real GRE, you can move freely within a section and change answers until time runs out.</p>
    <button class="btn dark block" data-action="exam-end">End section and see results</button>`
    : renderQuestion(e.questions[e.index], { selected: e.sel[e.index] ?? [], numeric: e.num[e.index] ?? '', exam: true });
  const confirm = e.confirm ? `<div class="callout warn stack" role="alertdialog" aria-label="End section?"><strong>End this section?</strong><span class="small">${unanswered} question${unanswered === 1 ? ' is' : 's are'} unanswered. There's no penalty for guessing.</span><div class="row"><button class="btn small dark" data-action="exam-finish">End and see results</button><button class="btn small secondary" data-action="exam-cancel-end">Keep working</button></div></div>` : '';
  return `<div class="session">
    <div class="exambar">
      <div class="row between"><button class="btn small" data-action="exam-end">End section</button>
        <button class="timer${e.remaining < 120 && e.showTimer ? ' low' : ''}" id="exam-timer" data-action="exam-timer" aria-label="Show or hide timer">${icon('timer', 16)}<span>${e.showTimer ? clock(e.remaining) : 'Show time'}</span></button></div>
      <div class="row between wrap"><span class="small" style="opacity:.85">${sec.short} · <strong>${e.review ? 'Review' : `Question ${e.index + 1} of ${e.questions.length}`}</strong></span>
        <div class="row" style="gap:8px"><button class="btn small mark" data-action="exam-mark" aria-pressed="${marked}" ${e.review ? 'disabled' : ''}>${icon('flag', 14)}Mark</button>
        <button class="btn small rev" data-action="exam-review" aria-pressed="${e.review}">Review</button></div></div>
    </div>
    <div class="session-body" style="padding-top:20px">${confirm}${body}</div>
    <div class="session-foot"><button class="btn secondary block" data-action="exam-prev" ${e.index === 0 && !e.review ? 'disabled' : ''}>Back</button><button class="btn block" data-action="exam-next">${e.review || e.index < e.questions.length - 1 ? 'Next' : 'Review'}</button></div>
  </div>`;
}

function viewExamResults() {
  const e = ui.exam; const r = e.result;
  const n = e.questions.length;
  const pace = Math.floor(e.limit / n);
  const max = Math.max(...r.seconds, pace * 2, 1);
  const right = r.correct.filter(Boolean).length;
  const slow = e.questions.map((q, i) => [i, q]).filter(([i]) => !r.correct[i] && r.seconds[i] > pace * 1.5).sort((a, b) => r.seconds[b[0]] - r.seconds[a[0]])[0];
  const lesson = slow ? (C.LESSONS.find((l) => l.practiceType === slow[1].type) ?? C.LESSONS[C.LESSONS.length - 1]) : null;
  return `<div class="session"><div class="session-body">
    <div class="row between"><h1 class="h2">${C.SECTIONS[e.section].short} results</h1><button class="btn small secondary" data-action="exam-close">Done</button></div>
    <section class="card pad-lg stack">
      <span class="small muted">Estimated scaled score</span><span style="font-size:48px;font-weight:700;line-height:1">${r.score}</span>
      <div class="divider"></div>
      <div class="grid3"><div><div class="h2">${right}/${n}</div><div class="xs muted">Correct</div></div><div><div class="h2">${clock(r.timeUsed)}</div><div class="xs muted">of ${clock(e.limit)}</div></div><div><div class="h2">${clock(Math.floor(r.timeUsed / n))}</div><div class="xs muted">avg / Q</div></div></div>
    </section>
    <section class="card stack">
      <div class="row between"><h2 class="h3">Time per question</h2><span class="xs muted">Target ${clock(pace)}</span></div>
      <div class="row xs" style="gap:14px"><span class="row" style="gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:var(--accent)"></span>Correct</span><span class="row" style="gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:var(--warn)"></span>Missed</span></div>
      <div class="bars" style="grid-template-columns:repeat(${n},minmax(0,1fr))" role="img" aria-label="${esc(r.seconds.map((s, i) => `Question ${i + 1}: ${s} seconds, ${r.correct[i] ? 'correct' : 'missed'}`).join('; '))}">
        <div class="pace-line" style="bottom:${18 + (pace / max) * 100}px"></div>
        ${r.seconds.map((s, i) => `<div class="b"><div style="height:${Math.max(4, (s / max) * 100)}px;background:var(${r.correct[i] ? '--accent' : '--warn'})"></div><span>${i + 1}</span></div>`).join('')}
      </div></section>
    ${slow ? `<a class="callout info row" style="align-items:flex-start;color:var(--ink)" href="#/lesson/${lesson.id}">${icon('bulb')}<span><strong>You spent ${clock(r.seconds[slow[0]])} on Q${slow[0] + 1} and still missed it.</strong><br><span class="small">It was a ${esc(C.TYPES[slow[1].type].title)} question. Review "${esc(lesson.title)}" to speed these up.</span></span></a>` : ''}
    <section class="stack"><h2 class="h3">Missed questions</h2>
      ${right === n ? '<p class="muted">None. Excellent work.</p>' : ''}
      ${e.questions.map((q, i) => r.correct[i] ? '' : `<div class="card stack">
        <div class="row between"><span class="row"><span class="icon-tile t-warn" style="width:32px;height:32px;font-weight:700">${i + 1}</span><span><strong>${esc(q.topic)}</strong><br><span class="xs muted">Answer ${esc(C.answerText(q))} · ${clock(r.seconds[i])}</span></span></span>
        <button class="btn small soft" data-action="exam-tutor" data-i="${i}">${icon('chat', 16)}Ask tutor</button></div>
        <details><summary class="small" style="cursor:pointer;color:var(--accent)">Show question and explanation</summary><div class="stack" style="margin-top:12px">${renderQuestion(q, { selected: e.sel[i] ?? [], numeric: e.num[i] ?? '', revealed: true })}<p class="small">${esc(q.explanation)}</p></div></details>
      </div>`).join('')}
      <p class="xs muted">Missed questions were added to your mistake notebook.</p>
    </section></div></div>`;
}

// ---------------------------------------------------------------- vocab

function viewVocab() {
  if (!ui.vocab) {
    const queue = [...C.VOCAB].sort(() => Math.random() - 0.5).sort((a, b) => (S.vocab[a.word] ?? 0) - (S.vocab[b.word] ?? 0));
    ui.vocab = { queue, pos: 0, revealed: false, again: 0 };
  }
  const v = ui.vocab;
  const w = v.queue[v.pos % v.queue.length];
  const known = Object.values(S.vocab).filter((b) => b >= 3).length;
  const stat = (n, l) => `<div class="card" style="padding:10px 12px"><div class="h2">${n}</div><div class="xs muted">${l}</div></div>`;
  return `<div class="row between"><h1 class="title">Vocab</h1><span class="small muted">Card ${v.pos % v.queue.length + 1} of ${v.queue.length}</span></div>
    <div class="grid3">${stat(known, 'Known')}${stat(v.again, 'Review again')}${stat(C.VOCAB.length, 'In deck')}</div>
    <button class="flash" data-action="flip" aria-label="Flip card">
      <span class="eyebrow">${esc(w.pos)}</span><span class="word">${esc(w.word)}</span>
      ${v.revealed ? `<span style="font-size:19px;font-weight:500">${esc(w.def)}</span><span class="muted" style="font-style:italic">${esc(w.example)}</span><span class="tag" style="text-transform:none;letter-spacing:0">Synonyms: ${esc(w.syn)}</span>`
        : `<span class="row muted small" style="gap:6px">${icon('flip', 16)}Tap to see the definition</span>`}
    </button>
    <div class="grid2"><button class="btn secondary" data-action="vocab" data-known="0" style="color:var(--warn)">Again</button><button class="btn" data-action="vocab" data-known="1">Got it</button></div>
    <button class="btn ghost" data-action="vocab-tutor" style="align-self:center">${icon('chat', 16)}Quiz me on this word with the tutor</button>`;
}

// ---------------------------------------------------------------- progress

function viewProgress() {
  const p = profile();
  const last30 = S.attempts.filter((a) => a.date > Date.now() - 30 * 86400000);
  const est = (s, target) => {
    const v = C.estimateScore(S.attempts, s);
    return `<div class="card stack tight"><span class="small muted">Est. ${C.SECTIONS[s].short}</span><span style="font-size:32px;font-weight:700">${v ?? '—'}</span><span class="xs" style="font-weight:600;color:var(${v && v >= target ? '--correct' : '--muted'})">${v ? `Target ${target}` : 'Answer 10+ to unlock'}</span></div>`;
  };
  const days = [...Array(7)].map((_, i) => {
    const d = C.startOfDay(Date.now() - (6 - i) * 86400000);
    return { label: new Date(d).toLocaleDateString(undefined, { weekday: 'narrow' }), count: S.attempts.filter((a) => C.startOfDay(a.date) === d).length, today: i === 6 };
  });
  const maxDay = Math.max(1, ...days.map((d) => d.count));
  const topics = Object.entries(C.topicAccuracy(last30)).sort((a, b) => a[1].accuracy - b[1].accuracy);
  return `<h1 class="title">Progress</h1><p class="small muted">Last 30 days</p>
    <div class="grid2">${est('quant', p.targetQuant)}${est('verbal', p.targetVerbal)}</div>
    <section class="card stack"><div class="row between"><h2 class="h3">This week</h2><span class="small muted">${days.reduce((s, d) => s + d.count, 0)} questions</span></div>
      <div class="bars" style="grid-template-columns:repeat(7,minmax(0,1fr));height:120px" role="img" aria-label="${esc(days.map((d) => `${d.label}: ${d.count}`).join(', '))}">
        ${days.map((d) => `<div class="b"><div style="height:${Math.max(4, (d.count / maxDay) * 90)}px;background:var(--accent);opacity:${d.today ? 1 : 0.5}"></div><span>${d.label}</span></div>`).join('')}</div></section>
    <section class="card stack"><div class="row between"><h2 class="h3">Accuracy by topic</h2><span class="xs muted">Weakest first</span></div>
      ${topics.length ? topics.map(([t, v]) => `<div class="stack tight"><div class="row between small"><span>${esc(t)}</span><strong>${pct(v.accuracy)}</strong></div>${meter(v.accuracy, v.accuracy < 0.65 ? 'var(--warn)' : null)}</div>`).join('') : '<p class="small muted">Answer a few questions to see your strengths and weak spots.</p>'}
      ${topics.length ? `<div class="grid2"><button class="btn soft" data-action="drill" data-topic="${esc(topics[0][0])}">Drill ${esc(topics[0][0])}</button><button class="btn secondary" data-action="tutor-weak">${icon('chat', 16)}Make a plan with the tutor</button></div>` : ''}
    </section>
    <p class="xs muted">Score estimates are a rough guide based on recent accuracy and question difficulty. Official ETS practice tests are the best predictor.</p>`;
}

// ---------------------------------------------------------------- plan

function viewPlan() {
  const p = profile();
  const left = C.daysUntil(p.testDate);
  const total = Math.max(left, 42);
  const days = [...Array(7)].map((_, i) => C.startOfDay(Date.now()) + i * 86400000 + 3600000);
  const tasks = C.planTasks(days[ui.planDay], p.testDate, total, p.dailyMinutes);
  const done = new Set(S.planDone);
  const phase = C.planPhase(Date.now(), p.testDate, total);
  const estQ = C.estimateScore(S.attempts, 'quant'), estV = C.estimateScore(S.attempts, 'verbal');
  const stat = (v, l) => `<div><div style="font-size:26px;font-weight:700">${v}</div><div class="xs" style="opacity:.7">${l}</div></div>`;
  return `${backLink('#/home', 'Home')}
    <div class="row between"><h1 class="title">Your plan</h1><a href="#/goal" class="small" style="font-weight:600">Edit goal</a></div>
    <section class="grid3" style="background:var(--bar);color:#fff;border-radius:20px;padding:18px">${stat(left, 'days left')}${stat(p.targetQuant + p.targetVerbal, 'target')}${stat(estQ && estV ? estQ + estV : '—', 'current est.')}</section>
    <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px">${days.map((d, i) => {
      const dt = new Date(d); const sel = i === ui.planDay;
      return `<button data-action="plan-day" data-i="${i}" aria-pressed="${sel}" style="min-height:64px;border:none;border-radius:14px;background:${sel ? 'var(--accent)' : 'var(--card)'};color:${sel ? 'var(--on-accent)' : 'var(--ink)'};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px"><span class="xs">${dt.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>${dt.getDate()}</strong></button>`;
    }).join('')}</div>
    <section class="card stack" style="gap:0">
      <div class="row between" style="padding-bottom:8px"><h2 class="h3">${ui.planDay === 0 ? 'Today' : new Date(days[ui.planDay]).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h2><span class="small muted">${tasks.filter((t) => done.has(t.id)).length} of ${tasks.length} done</span></div>
      ${tasks.map((t) => `<div class="divider"></div><div class="row" style="min-height:60px">
        <button data-action="plan-toggle" data-id="${esc(t.id)}" role="checkbox" aria-checked="${done.has(t.id)}" aria-label="${esc(t.title)}" style="width:44px;height:44px;border:none;background:none;display:grid;place-items:center">
          <span style="width:26px;height:26px;border-radius:8px;border:2px solid ${done.has(t.id) ? 'var(--correct)' : 'var(--border)'};background:${done.has(t.id) ? 'var(--correct)' : 'transparent'};color:var(--on-accent);display:grid;place-items:center">${done.has(t.id) ? icon('check', 16) : ''}</span></button>
        <button data-action="plan-open" data-dest="${esc(JSON.stringify(t.dest))}" style="flex:1;border:none;background:none;text-align:left;display:flex;align-items:center;justify-content:space-between;min-height:52px"><span><span style="font-weight:500">${esc(t.title)}</span><br><span class="xs muted">${esc(t.detail)}</span></span>${icon('chevron', 16)}</button></div>`).join('')}
    </section>
    <section class="stack"><h2 class="h2">Roadmap</h2><div class="card stack" style="gap:16px">${C.PHASES.map(([name, detail], i) => `<div class="row" style="align-items:flex-start">
      <span style="width:28px;height:28px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;font-size:13px;font-weight:700;background:${i === phase ? 'var(--accent)' : 'var(--track)'};color:${i === phase ? 'var(--on-accent)' : 'var(--muted)'}">${i + 1}</span>
      <span><strong>${name}${i === phase ? ' · now' : ''}</strong><br><span class="small muted">${detail}</span></span></div>`).join('')}</div></section>`;
}

// ---------------------------------------------------------------- lessons & mistakes

function viewLessons() {
  return `${backLink('#/practice', 'Practice')}<h1 class="title">Strategy lessons</h1>
    ${C.LESSONS.map((l) => `<a class="card row between" href="#/lesson/${l.id}"><span><span class="h3" style="display:block">${esc(l.title)}</span><span class="small muted">${l.section ? C.SECTIONS[l.section].short : 'Test strategy'} · ${l.minutes} min</span></span>${icon('chevron', 18)}</a>`).join('')}`;
}

function viewLesson(id) {
  const l = C.LESSONS.find((x) => x.id === id) ?? C.LESSONS[0];
  const step = ui.lessonStep[l.id] ?? 0;
  const s = l.steps[step];
  const last = step === l.steps.length - 1;
  return `${backLink('#/lessons', 'Lessons')}
    <div class="row" style="gap:6px" aria-label="Step ${step + 1} of ${l.steps.length}">${l.steps.map((_, i) => `<div style="flex:1;height:4px;border-radius:999px;background:${i <= step ? 'var(--correct)' : 'var(--border)'}"></div>`).join('')}</div>
    <span class="eyebrow" style="color:var(--correct)">${l.section ? C.SECTIONS[l.section].short : 'Strategy'} · ${l.minutes} min</span>
    <h1 class="title">${esc(l.title)}</h1>
    <h2 class="h2">${esc(s.heading)}</h2><p style="font-size:17px">${esc(s.body)}</p>
    ${s.bullets?.length ? `<div class="card stack">${s.bullets.map((b, i) => `<div class="row" style="align-items:flex-start;gap:10px"><strong style="color:var(--accent)">${i + 1}</strong><span>${esc(b)}</span></div>`).join('')}</div>` : ''}
    ${s.callout ? `<div class="callout good">${esc(s.callout)}</div>` : ''}
    ${last && l.practiceType ? `<button class="btn soft" data-action="type" data-t="${l.practiceType}" data-count="5">Try 5 ${esc(C.TYPES[l.practiceType].title)} questions</button>` : ''}
    <button class="btn ghost" data-action="lesson-tutor" data-id="${l.id}" style="align-self:flex-start">${icon('chat', 16)}Ask the tutor about this strategy</button>
    <div class="grid2"><button class="btn secondary" data-action="lesson-step" data-id="${l.id}" data-d="-1" ${step === 0 ? 'disabled' : ''}>Back</button><button class="btn" data-action="lesson-step" data-id="${l.id}" data-d="1">${last ? 'Start over' : 'Continue'}</button></div>`;
}

function viewMistakes() {
  const open = openMistakes().sort((a, b) => a.due - b.due);
  const f = ui.mistakeFilter;
  const visible = open.filter((m) => !f || m.reason === f);
  const due = dueMistakes();
  const mastered = Object.values(S.mistakes).length - open.length;
  return `${backLink('#/practice', 'Practice')}<h1 class="title">Mistake notebook</h1>
    <p class="small muted">Missed questions come back on a spaced schedule until you get them right twice in a row. ${mastered} mastered so far.</p>
    <div class="row wrap" style="gap:8px"><button class="chip" data-action="mfilter" data-r="" aria-pressed="${!f}">All · ${open.length}</button>
      ${Object.entries(C.REASONS).map(([k, label]) => { const n = open.filter((m) => m.reason === k).length; return n ? `<button class="chip" data-action="mfilter" data-r="${k}" aria-pressed="${f === k}">${label} · ${n}</button>` : ''; }).join('')}</div>
    <button class="btn block" data-action="retry-due" ${due.length ? '' : 'disabled'}>Retry ${due.length} due question${due.length === 1 ? '' : 's'}</button>
    ${visible.length ? '' : `<p class="muted">${open.length ? 'Nothing in this filter.' : 'No mistakes yet. Questions you miss will appear here.'}</p>`}
    ${visible.map((m) => `<button class="card stack" data-action="retry-one" data-id="${esc(m.question.id)}">
      <span class="row between"><span class="xs muted" style="font-weight:600">${esc(m.question.topic)}</span><span class="tag ${m.due <= Date.now() ? '' : 'plain'}" style="${m.due <= Date.now() ? 'background:var(--warn-soft);color:var(--warn);' : ''}text-transform:none;letter-spacing:0">${relDay(m.due)}</span></span>
      <span class="small">${esc((m.question.stem || `${m.question.quantityA} vs ${m.question.quantityB}`).slice(0, 180))}</span>
      <span class="xs muted">Reason: <strong style="color:var(--ink)">${C.REASONS[m.reason] ?? 'Not tagged'}</strong> · Missed ${m.misses}×</span></button>`).join('')}`;
}

// ---------------------------------------------------------------- writing

let writingTimer = null;
function viewWriting() {
  if (!ui.writing) ui.writing = { promptIndex: Math.floor(Math.random() * C.ESSAY_PROMPTS.length), text: '', started: false, remaining: 1800, scoring: false, result: null, error: null };
  const w = ui.writing;
  const prompt = C.ESSAY_PROMPTS[w.promptIndex];
  const words = w.text.trim() ? w.text.trim().split(/\s+/).length : 0;
  const f = w.result?.feedback;
  return `${backLink('#/practice', 'Practice')}
    <div class="row between"><span class="eyebrow" style="color:var(--warn)">Analyze an Issue · 30 min</span><span class="tag plain" style="font-size:15px;font-weight:700" id="essay-timer">${icon('timer', 16)}<span>${clock(w.remaining)}</span></span></div>
    <section class="card stack"><p class="h3">${esc(prompt)}</p><p class="small muted">${esc(C.ESSAY_INSTRUCTIONS)}</p>
      ${!w.started && !f ? '<button class="btn ghost small" style="align-self:flex-start" data-action="essay-prompt">Different prompt</button>' : ''}</section>
    ${f ? `<section class="card stack" aria-live="polite">
        <div class="row between"><h2 class="h3">Scored feedback</h2><span><strong style="font-size:30px">${f.score.toFixed(1)}</strong><span class="muted"> / 6</span></span></div>
        ${f.traits.map((t) => `<div class="stack tight"><div class="row between small"><span>${esc(t.name)}</span><strong>${t.score.toFixed(1)} / 6</strong></div>${meter(t.score / 6, null, true)}</div>`).join('')}
        ${f.strengths.map((s) => `<div class="callout good small"><strong>Strength:</strong> ${esc(s)}</div>`).join('')}
        ${f.improvements.map((s) => `<div class="callout warn small"><strong>To improve:</strong> ${esc(s)}</div>`).join('')}
        <p class="xs muted">Agent scoring is an estimate based on the official 0–6 rubric.</p>
        <div class="grid2"><button class="btn secondary" data-action="essay-tutor">${icon('chat', 16)}Discuss with tutor</button><button class="btn dark" data-action="essay-new">Write another</button></div></section>`
      : `<div class="stack tight"><label class="lbl" for="essay">Your response</label>
        <textarea class="field" id="essay" data-input="essay" rows="16" placeholder="Start with a clear position, then support it with two or three specific examples…" ${w.remaining <= 0 ? 'disabled' : ''}>${esc(w.text)}</textarea>
        <div class="row between xs muted"><span id="word-count">${words} words</span><span>${w.remaining <= 0 ? "Time's up" : 'Strong essays usually run 500–600'}</span></div></div>
        ${w.error ? `<p class="small" style="color:var(--wrong)">${esc(w.error)}</p>` : ''}
        <button class="btn block" id="essay-submit" data-action="essay-submit" ${words < 30 || w.scoring ? 'disabled' : ''}>${w.scoring ? '<span class="spinner"></span> Scoring with the agent…' : 'Submit for scoring'}</button>`}
    ${S.essays.length && !f ? `<h2 class="h3">Past essays</h2>${S.essays.slice(-5).reverse().map((e) => `<div class="card row between"><span><span class="small">${esc(e.prompt.slice(0, 80))}…</span><br><span class="xs muted">${new Date(e.date).toLocaleDateString()}</span></span><strong>${e.score?.toFixed?.(1) ?? '—'}</strong></div>`).join('')}` : ''}`;
}

function tickWriting() {
  const w = ui.writing;
  if (!w || !w.started || w.result || w.remaining <= 0 || route().name !== 'writing') return;
  w.remaining -= 1;
  const el = document.querySelector('#essay-timer span');
  if (el) el.textContent = clock(w.remaining);
  if (w.remaining <= 0) render();
}
writingTimer = setInterval(tickWriting, 1000);

// ---------------------------------------------------------------- generate

function viewGenerate() {
  const g = ui.gen;
  const job = g.job;
  const weak = weakTopics(g.type);
  const agentWarn = agent.ok === false ? `<div class="callout bad small"><strong>Agent offline.</strong> ${esc(agent.error)}</div>` : '';
  if (!job) {
    return `${backLink('#/practice', 'Practice')}<h1 class="title">Generate questions</h1>
      <p class="muted">The ${esc(agent.label || 'AI')} agent on the host computer writes fresh GRE-style questions aimed at your weak spots, then checks each one before you see it.</p>
      ${agentWarn}
      <div class="stack"><span class="h3">Question type</span><div class="row wrap" style="gap:8px">${Object.entries(C.TYPES).map(([id, t]) => `<button class="chip" data-action="gen-type" data-t="${id}" aria-pressed="${g.type === id}">${t.title}</button>`).join('')}</div></div>
      <div class="stack"><span class="h3">Difficulty</span><div class="segmented" role="group" aria-label="Difficulty">${['easy', 'medium', 'hard'].map((d) => `<button data-action="gen-diff" data-d="${d}" aria-pressed="${g.difficulty === d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div></div>
      <div class="card row between"><span>Number of questions</span><div class="stepper"><button data-action="gen-count" data-d="-1" aria-label="Fewer">−</button><output>${g.count}</output><button data-action="gen-count" data-d="1" aria-label="More">+</button></div></div>
      <label class="card row between" style="cursor:pointer"><span><span style="display:block">Focus on my weak topics</span><span class="xs muted">${weak.length ? esc(weak.join(', ')) : 'No weak topics yet for this type'}</span></span><input type="checkbox" data-action="gen-weak" ${g.focusWeak ? 'checked' : ''} style="width:22px;height:22px"></label>
      <div class="callout info row" style="align-items:flex-start">${icon('shield')}<span class="small">Every question is solved independently 3 times, Quant math is re-run as code on the host computer, and a strict reviewer pass checks for one defensible answer and real GRE style. Anything that fails is thrown out and rewritten. Expect about 1–2 minutes per question.</span></div>
      <button class="btn block" data-action="gen-start" ${agent.ok === false ? 'disabled' : ''}>${icon('sparkles', 18)}Generate &amp; verify</button>`;
  }
  const running = job.status === 'running';
  const rejected = job.reports.filter((r) => !r.accepted);
  const firstOk = job.reports.find((r) => r.accepted);
  return `${backLink('#/practice', 'Practice')}
    <h1 class="title">${running ? 'Generating…' : job.status === 'failed' ? 'Generation stopped' : `${job.accepted.length} questions ready`}</h1>
    <p class="muted">${esc(C.TYPES[job.type].title)} · ${job.difficulty} · ${job.accepted.length} of ${job.count} verified · ${rejected.length} rejected</p>
    ${running ? `<div class="row"><span class="spinner"></span><strong>${esc(job.statusText)}</strong></div>${meter(job.accepted.length / job.count)}` : ''}
    ${job.error ? `<div class="callout bad small">${esc(job.error)}</div>` : ''}
    ${firstOk ? `<section class="card stack" style="gap:4px"><h2 class="h3" style="margin-bottom:6px">Validation report (question 1)</h2>${firstOk.checks.map((c) => `<div class="divider"></div><div class="row" style="align-items:flex-start;padding:8px 0"><span class="icon-tile t-good" style="width:24px;height:24px;border-radius:50%">${icon('check', 14)}</span><span><strong class="small">${esc(c.name)}</strong><br><span class="xs muted">${esc(c.detail)}</span></span></div>`).join('')}</section>` : ''}
    ${job.reports.length ? `<section class="stack"><h2 class="h3">Drafts</h2>${job.reports.slice().reverse().map((r) => `<div class="card row" style="align-items:flex-start;padding:12px"><span style="color:var(${r.accepted ? '--correct' : '--wrong'})">${icon(r.accepted ? 'check' : 'x', 18)}</span><span><strong class="small">Draft ${r.draft} ${r.accepted ? 'passed' : 'rejected'}</strong>${r.accepted ? '' : `<br><span class="xs muted">${esc(r.failure)}</span>`}</span></div>`).join('')}</section>` : ''}
    ${running ? '<button class="btn secondary block" data-action="gen-cancel">Cancel</button>'
      : `${job.accepted.length ? '<button class="btn block" data-action="gen-practice">Start these questions</button>' : ''}<button class="btn ghost" data-action="gen-reset">Change settings</button>`}`;
}

async function pollJob() {
  const g = ui.gen;
  if (!g.job || g.job.status !== 'running') return;
  try {
    g.job = await api(`/api/jobs/${g.job.id}`);
    if (g.job.status !== 'running') S = await api('/api/state');
    if (route().name === 'generate') render();
  } catch { /* keep polling */ }
  if (g.job.status === 'running') g.polling = setTimeout(pollJob, 2000);
}

// ---------------------------------------------------------------- tutor chat

function viewTutor(id) {
  const c = ui.chat.current && ui.chat.current.id === id ? ui.chat.current : null;
  const list = `<aside class="chat-list" aria-label="Conversations">
      <button class="btn small" data-action="chat-new" style="margin-bottom:8px">${icon('plus', 16)}New conversation</button>
      ${ui.chat.list.map((x) => `<a href="#/tutor/${x.id}" class="${x.id === id ? 'active' : ''}">${esc(x.title)}</a>`).join('') || '<p class="xs muted" style="padding:0 12px">No conversations yet.</p>'}</aside>`;
  const agentWarn = agent.ok === false ? `<div class="callout bad small" style="margin:12px 12px 0">Agent offline: ${esc(agent.error)}</div>` : '';
  const suggestions = (items) => `<div class="suggestions">${items.map((s) => `<button class="chip" data-action="chat-suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
  let body;
  if (!id) {
    body = `<div class="messages"><div class="stack" style="margin:auto;max-width:480px;text-align:center;align-items:center">
        <span class="icon-tile t-accent" style="width:56px;height:56px">${icon('chat', 28)}</span>
        <h1 class="h2">Chat with your GRE tutor</h1>
        <p class="muted small">A ${esc(agent.label || 'AI')} agent running on the host computer. It knows your targets and weak topics. Ask about a problem, a concept, or how to plan your week.</p>
        ${suggestions(['Explain how to approach Quantitative Comparison', 'Quiz me on hard vocabulary', 'What should I focus on this week?', 'Give me a tricky probability question'])}
      </div></div>${composer(false)}`;
  } else if (!c) {
    body = `<div class="messages"><span class="spinner" style="margin:auto"></span></div>`;
  } else {
    const msgs = c.messages.map((m) => m.role === 'user' ? `<div class="msg user">${esc(m.text)}</div>` : m.role === 'error' ? `<div class="msg error">${esc(m.text)}</div>` : `<div class="msg assistant">${md(m.text)}</div>`).join('');
    const ctx = c.context?.question ? `<div class="callout info small" style="align-self:stretch"><strong>About this question:</strong> ${esc((c.context.question.stem || `${c.context.question.quantityA} vs ${c.context.question.quantityB}`).slice(0, 160))}</div>` : '';
    const empty = !c.messages.length ? suggestions(c.context?.question ? ['Why is my answer wrong?', 'Walk me through it step by step', 'Give me a hint, not the answer', 'Give me a similar question'] : ['Explain this differently', 'Give me a practice question']) : '';
    body = `<div class="messages" id="messages" aria-live="polite">${ctx}${msgs}${ui.chat.streaming ? '<div class="msg assistant" id="streaming"><span class="typing"><i></i><i></i><i></i></span></div>' : ''}${empty}</div>${composer(ui.chat.streaming)}`;
  }
  return `<div class="chat-layout">${list}<section class="chat-main">${agentWarn}${body}</section></div>`;
}

const composer = (busy) => `<form class="composer" id="composer"><label class="sr-only" for="chat-input">Message the tutor</label>
  <textarea class="field" id="chat-input" rows="1" placeholder="Ask anything about the GRE…" ${busy ? 'disabled' : ''}></textarea>
  <button class="btn" type="submit" aria-label="Send" ${busy ? 'disabled' : ''}>${icon('send', 18)}</button></form>`;

async function loadChat(id) {
  try {
    ui.chat.current = await api(`/api/chats/${id}`);
    if (route().name === 'tutor' && route().param === id) render();
  } catch { go('#/tutor'); }
}

async function newChat({ title, context, firstMessage } = {}) {
  const c = await api('/api/chats', { method: 'POST', body: { title, context } });
  ui.chat.list.unshift({ id: c.id, title: c.title, updated: c.updated });
  ui.chat.current = c;
  go(`#/tutor/${c.id}`);
  if (firstMessage) sendChat(firstMessage);
  return c;
}

async function sendChat(text) {
  text = text.trim();
  if (!text || ui.chat.streaming) return;
  let c = ui.chat.current;
  if (!c || route().param !== c.id) { await newChat({ firstMessage: text }); return; }
  c.messages.push({ role: 'user', text });
  ui.chat.streaming = true;
  render();
  let acc = '';
  try {
    const res = await fetch(`/api/chats/${c.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (res.status === 401) throw new AuthError();
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || 'The tutor could not respond.');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.t === 'delta') {
          acc += ev.text;
          const el = document.getElementById('streaming');
          if (el) { el.innerHTML = md(acc); const box = document.getElementById('messages'); if (box) box.scrollTop = box.scrollHeight; }
        } else if (ev.t === 'done') {
          acc = ev.text || acc;
        } else if (ev.t === 'error') {
          throw new Error(ev.error);
        }
      }
    }
    c.messages.push({ role: 'assistant', text: acc || '(no reply)' });
  } catch (err) {
    if (err instanceof AuthError) return renderLogin();
    c.messages.push({ role: 'error', text: err.message });
  }
  ui.chat.streaming = false;
  const entry = ui.chat.list.find((x) => x.id === c.id);
  if (entry && entry.title === 'New conversation') entry.title = c.messages[0].text.slice(0, 60);
  if (route().name === 'tutor') { render(); document.getElementById('chat-input')?.focus(); }
}

function questionContext(q, studentAnswer) {
  return newChat({ title: `About: ${q.topic}`, context: { question: q, studentAnswer } });
}

function describeAnswer(q, selected, numeric) {
  if (q.type === 'numericEntry') return numeric || '(blank)';
  return selected.length ? selected.map((i) => `${C.letter(i)}) ${q.choices[i]}`).join('; ') : '(blank)';
}

// ---------------------------------------------------------------- settings

const PROVIDERS = { claude: 'Claude Code', codex: 'ChatGPT Codex' };

function viewSettings() {
  const p = profile();
  const provider = PROVIDERS[p.provider] ? p.provider : 'claude';
  const st = agent.providers?.[provider];
  let theme = 'system';
  try { theme = localStorage.getItem('gre-theme') || 'system'; } catch {}
  return `<h1 class="title">Settings</h1>
    <section class="card stack"><h2 class="h3">Appearance</h2><p class="xs muted">Saved on this device.</p>
      <div class="segmented" role="group" aria-label="Theme">${['system', 'light', 'dark'].map((t) => `<button data-action="theme" data-t="${t}" aria-pressed="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></section>
    <a class="card row between" href="#/goal"><span><span class="h3" style="display:block">Goal</span><span class="small muted">Test ${new Date(p.testDate).toLocaleDateString()} · Target ${p.targetQuant + p.targetVerbal} · ${p.dailyMinutes} min/day</span></span>${icon('chevron', 18)}</a>
    <section class="card stack"><h2 class="h3">Agent</h2>
      <p class="xs muted">Which AI assistant on the host computer writes questions, scores essays and tutors. It uses that assistant's sign-in there.</p>
      <div class="segmented" role="group" aria-label="AI assistant">${Object.entries(PROVIDERS).map(([k, name]) => `<button data-action="provider" data-p="${k}" aria-pressed="${provider === k}">${name}</button>`).join('')}</div>
      <div class="row small"><span class="dot ${st?.ok ? 'ok' : st?.ok === false ? 'bad' : ''}"></span>${st?.ok ? `${esc(st.label)} ${esc(st.version)} on the host computer` : st?.ok === false ? esc(st.error) : 'Checking…'}</div>
      <label class="lbl" for="model">Model</label>
      <input class="field" id="model" data-input="model" value="${esc(provider === 'codex' ? p.codexModel ?? '' : p.model)}" placeholder="Default (whatever ${PROVIDERS[provider]} uses)">
      <p class="xs muted">Optional. Examples: ${provider === 'codex' ? 'gpt-5, gpt-5-codex' : 'sonnet, opus'}. Leave empty to use ${PROVIDERS[provider]}'s default.</p>
      <button class="btn small secondary" style="align-self:flex-start" data-action="model-save">Save model</button></section>
    <section class="card stack"><h2 class="h3">Data</h2><p class="small muted">Your progress is saved on the host computer in the app's data folder. ${S.attempts.length} answers, ${S.saved.length} agent questions, ${S.chats.length} conversations.</p>
      <button class="btn small secondary" style="align-self:flex-start;color:var(--wrong)" data-action="reset">Reset all progress</button></section>
    <p class="xs muted">GRE® is a registered trademark of ETS. This app is not endorsed or approved by ETS.</p>`;
}

// ---------------------------------------------------------------- actions

async function saveProfile(patch) {
  Object.assign(S.profile, patch);
  render();
  try { await api('/api/profile', { method: 'PUT', body: patch }); } catch (e) { toast(e.message); }
}

const actions = {
  nav: (d) => go(d.to),
  'onboard-next': () => { ui.onboardingStep = 1; render(); },
  'onboard-done': () => saveProfile({ onboarded: true }),
  'goal-save': () => { toast('Goal saved'); go('#/plan'); },
  score: (d) => { const v = Math.max(130, Math.min(170, S.profile[d.key] + Number(d.d))); saveProfile({ [d.key]: v }); },
  'test-in': (d) => saveProfile({ testDate: Date.now() + Number(d.days) * 86400000 }),
  minutes: (d) => saveProfile({ dailyMinutes: Number(d.m) }),

  daily: () => startSession('Daily set', C.makeSet(pool(), S.attempts, 10)),
  section: (d) => startSession(C.SECTIONS[d.s].short, C.makeSet(pool(), S.attempts, 10, { section: d.s })),
  type: (d) => startSession(C.TYPES[d.t].title, C.makeSet(pool(), S.attempts, Number(d.count) || 10, { type: d.t })),
  drill: (d) => startSession(d.topic, pool().filter((q) => q.topic === d.topic).sort(() => Math.random() - 0.5).slice(0, 10)),
  exam: (d) => startExam(d.s),

  pick: (d) => {
    const s = ui.session; const q = s.questions[s.index]; const i = Number(d.i);
    if (s.revealed) return;
    if (C.allowsMultiple(q)) s.selected = s.selected.includes(i) ? s.selected.filter((x) => x !== i) : [...s.selected, i];
    else s.selected = [i];
    render();
  },
  async check() {
    const s = ui.session; const q = s.questions[s.index];
    const correct = C.isCorrect(q, s.selected, s.numeric);
    s.results[s.index] = correct;
    s.revealed = true;
    render();
    try {
      const r = await api('/api/attempts', { method: 'POST', body: { question: q, correct, seconds: (Date.now() - s.startedAt) / 1000 } });
      S.attempts.push({ questionId: q.id, topic: q.topic, type: q.type, section: C.sectionOf(q), difficulty: q.difficulty, correct, seconds: 0, date: Date.now() });
      const m = r.mistakes[0];
      if (m) S.mistakes[q.id] = m;
      s.mistake = correct ? null : m;
      if (route().name === 'session') render();
    } catch (e) { toast(e.message); }
  },
  async reason(d) {
    const s = ui.session; if (!s.mistake) return;
    s.mistake.reason = d.r; S.mistakes[s.mistake.question.id].reason = d.r;
    render();
    api(`/api/mistakes/${s.mistake.question.id}`, { method: 'PUT', body: { reason: d.r } }).catch((e) => toast(e.message));
  },
  'session-next': () => {
    const s = ui.session;
    if (s.index + 1 >= s.questions.length) { s.finished = true; return render(); }
    Object.assign(s, { index: s.index + 1, selected: [], numeric: '', revealed: false, mistake: null, hint: null, startedAt: Date.now() });
    render(); window.scrollTo(0, 0);
  },
  'session-close': () => { ui.session = null; go('#/home'); },
  async hint() {
    const s = ui.session; const q = s.questions[s.index];
    s.hintLoading = true; render();
    try { s.hint = (await api('/api/hint', { method: 'POST', body: { question: q } })).hint; }
    catch (e) { toast(e.message); }
    s.hintLoading = false;
    if (route().name === 'session') render();
  },
  'ask-tutor': () => {
    const s = ui.session; const q = s.questions[s.index];
    questionContext(q, describeAnswer(q, s.selected, s.numeric));
  },
  'session-tutor-summary': () => {
    const s = ui.session;
    const missed = s.questions.filter((_, i) => !s.results[i]).map((q) => q.topic);
    newChat({ firstMessage: `I just finished a practice set ("${s.title}") and got ${s.results.filter(Boolean).length} of ${s.results.length} right.${missed.length ? ` I missed questions on: ${missed.join(', ')}.` : ''} What should I work on next?` });
  },

  'exam-pick': (d) => {
    const e = ui.exam; const q = e.questions[e.index]; const i = Number(d.i);
    const cur = e.sel[e.index] ?? [];
    e.sel[e.index] = C.allowsMultiple(q) ? (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]) : [i];
    render();
  },
  'exam-go': (d) => { const e = ui.exam; e.index = Number(d.i); e.review = false; if (!e.visited.includes(e.index)) e.visited.push(e.index); render(); },
  'exam-prev': () => { const e = ui.exam; if (e.review) { e.review = false; } else e.index = Math.max(0, e.index - 1); render(); },
  'exam-next': () => {
    const e = ui.exam;
    if (e.review || e.index === e.questions.length - 1) e.review = true;
    else { e.index += 1; if (!e.visited.includes(e.index)) e.visited.push(e.index); }
    render(); window.scrollTo(0, 0);
  },
  'exam-mark': () => { const e = ui.exam; e.marked = e.marked.includes(e.index) ? e.marked.filter((x) => x !== e.index) : [...e.marked, e.index]; render(); },
  'exam-review': () => { ui.exam.review = !ui.exam.review; render(); },
  'exam-timer': () => { ui.exam.showTimer = !ui.exam.showTimer; render(); },
  'exam-end': () => { ui.exam.confirm = true; render(); window.scrollTo(0, 0); },
  'exam-cancel-end': () => { ui.exam.confirm = false; render(); },
  'exam-finish': () => finishExam(),
  'exam-close': () => { ui.exam = null; go('#/practice'); },
  'exam-tutor': (d) => { const e = ui.exam; const i = Number(d.i); const q = e.questions[i]; questionContext(q, describeAnswer(q, e.sel[i] ?? [], e.num[i] ?? '')); },

  flip: () => { ui.vocab.revealed = !ui.vocab.revealed; render(); },
  vocab: (d) => {
    const v = ui.vocab; const w = v.queue[v.pos % v.queue.length]; const known = d.known === '1';
    S.vocab[w.word] = known ? Math.min(4, (S.vocab[w.word] ?? 0) + 1) : 0;
    if (!known) v.again += 1;
    v.pos += 1; v.revealed = false;
    render();
    api('/api/vocab', { method: 'POST', body: { word: w.word, known } }).catch((e) => toast(e.message));
  },
  'vocab-tutor': () => { const v = ui.vocab; const w = v.queue[v.pos % v.queue.length]; newChat({ firstMessage: `Quiz me on the GRE word "${w.word}". Give me a sentence-completion style question that tests it, and wait for my answer.` }); },

  'tutor-weak': () => newChat({ firstMessage: 'Look at my weakest topics and help me make a focused plan for the next 7 days.' }),
  'plan-day': (d) => { ui.planDay = Number(d.i); render(); },
  async 'plan-toggle'(d) {
    const set = new Set(S.planDone); set.has(d.id) ? set.delete(d.id) : set.add(d.id); S.planDone = [...set]; render();
    api('/api/plan/toggle', { method: 'POST', body: { id: d.id } }).catch((e) => toast(e.message));
  },
  'plan-open': (d) => {
    const dest = JSON.parse(d.dest);
    if (dest.kind === 'practice') return startSession(dest.type ? C.TYPES[dest.type].title : dest.section ? C.SECTIONS[dest.section].short : 'Mixed', C.makeSet(pool(), S.attempts, 10, dest));
    if (dest.kind === 'exam') return startExam(dest.section);
    if (dest.kind === 'lesson') return go(`#/lesson/${dest.id}`);
    if (dest.kind === 'tutor') return actions['tutor-weak']();
    go({ vocab: '#/vocab', essay: '#/writing', mistakes: '#/mistakes' }[dest.kind] ?? '#/home');
  },

  'lesson-step': (d) => {
    const l = C.LESSONS.find((x) => x.id === d.id); const cur = ui.lessonStep[d.id] ?? 0;
    const last = cur === l.steps.length - 1;
    ui.lessonStep[d.id] = Number(d.d) > 0 ? (last ? 0 : cur + 1) : Math.max(0, cur - 1);
    render(); window.scrollTo(0, 0);
  },
  'lesson-tutor': (d) => { const l = C.LESSONS.find((x) => x.id === d.id); newChat({ firstMessage: `I'm studying the strategy "${l.title}". Explain it with a fresh example, then give me one practice question to try it on.` }); },
  mfilter: (d) => { ui.mistakeFilter = d.r || null; render(); },
  'retry-due': () => startSession('Mistake review', dueMistakes().map((m) => m.question)),
  'retry-one': (d) => startSession('Retry', [S.mistakes[d.id].question]),

  'essay-prompt': () => { ui.writing.promptIndex = (ui.writing.promptIndex + 1) % C.ESSAY_PROMPTS.length; render(); },
  async 'essay-submit'() {
    const w = ui.writing; w.scoring = true; w.error = null; render();
    try { w.result = await api('/api/essays', { method: 'POST', body: { prompt: C.ESSAY_PROMPTS[w.promptIndex], text: w.text } }); S.essays.push({ id: w.result.id, date: w.result.date, prompt: w.result.prompt, score: w.result.feedback.score }); }
    catch (e) { w.error = e.message; }
    w.scoring = false;
    if (route().name === 'writing') render();
  },
  'essay-new': () => { ui.writing = null; render(); },
  'essay-tutor': () => {
    const w = ui.writing; const f = w.result.feedback;
    newChat({ title: 'Essay feedback', firstMessage: `Here's my GRE Issue essay on: "${C.ESSAY_PROMPTS[w.promptIndex]}"\n\n${w.text}\n\nIt was scored ${f.score}/6. Help me revise it to reach the next score level. Start with the single most important change.` });
  },

  'gen-type': (d) => { ui.gen.type = d.t; render(); },
  'gen-diff': (d) => { ui.gen.difficulty = d.d; render(); },
  'gen-count': (d) => { ui.gen.count = Math.max(1, Math.min(20, ui.gen.count + Number(d.d))); render(); },
  'gen-weak': (_, el) => { ui.gen.focusWeak = el.checked; },
  async 'gen-start'() {
    const g = ui.gen;
    try {
      const { id } = await api('/api/generate', { method: 'POST', body: { type: g.type, difficulty: g.difficulty, count: g.count, topics: g.focusWeak ? weakTopics(g.type) : [] } });
      g.job = { id, status: 'running', statusText: 'Starting…', accepted: [], reports: [], count: g.count, type: g.type, difficulty: g.difficulty };
      render(); pollJob();
    } catch (e) { toast(e.message); }
  },
  'gen-cancel': async () => { await api(`/api/jobs/${ui.gen.job.id}/cancel`, { method: 'POST' }).catch(() => {}); ui.gen.job.status = 'cancelled'; render(); },
  'gen-practice': () => startSession('Agent set', ui.gen.job.accepted),
  'gen-reset': () => { ui.gen.job = null; render(); },

  'chat-new': () => go('#/tutor'),
  'chat-suggest': (d) => sendChat(d.text),

  theme: (d) => {
    try { localStorage.setItem('gre-theme', d.t); } catch {}
    if (d.t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = d.t;
    render();
  },
  'model-save': () => {
    saveProfile({ [S.profile.provider === 'codex' ? 'codexModel' : 'model']: document.getElementById('model').value.trim() });
    toast('Model saved');
  },
  async provider(d) {
    await saveProfile({ provider: d.p });
    agent = { ...(agent.providers?.[d.p] ?? { ok: null }), providers: agent.providers };
    render();
    toast(`Using ${PROVIDERS[d.p]}`);
  },
  async reset() {
    if (!confirm('Delete all answers, mistakes, essays, conversations and generated questions?')) return;
    await api('/api/reset', { method: 'POST' });
    ui.chat = { current: null, streaming: false, list: [] };
    S = await api('/api/state'); toast('Progress reset'); render();
  },
};

const inputs = {
  numeric: (v) => {
    const s = ui.session; s.numeric = v;
    const btn = document.getElementById('check-btn');
    if (btn) btn.disabled = !C.hasAnswer(s.questions[s.index], s.selected, v);
  },
  'exam-numeric': (v) => { ui.exam.num[ui.exam.index] = v; },
  essay: (v) => {
    const w = ui.writing; w.text = v; w.started = true;
    const words = v.trim() ? v.trim().split(/\s+/).length : 0;
    document.getElementById('word-count').textContent = `${words} words`;
    document.getElementById('essay-submit').disabled = words < 30 || w.scoring;
  },
  testDate: (v) => { if (v) saveProfile({ testDate: new Date(v + 'T12:00:00').getTime() }); },
  model: () => {},
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName !== 'INPUT') e.preventDefault();
  Promise.resolve(fn(el.dataset, el, e)).catch((err) => (err instanceof AuthError ? renderLogin() : toast(err.message)));
});
app.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (el && el.dataset.input !== 'testDate') inputs[el.dataset.input]?.(el.value, el);
  if (e.target.id === 'chat-input') { e.target.style.height = 'auto'; e.target.style.height = Math.min(180, e.target.scrollHeight) + 'px'; }
});
app.addEventListener('change', (e) => {
  const el = e.target.closest('[data-input="testDate"]');
  if (el) inputs.testDate(el.value);
});
app.addEventListener('submit', (e) => {
  if (e.target.id !== 'composer') return;
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value; input.value = '';
  sendChat(text);
});
app.addEventListener('keydown', (e) => {
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    document.getElementById('composer').requestSubmit();
  }
  if (route().name === 'session' && e.key === 'Enter' && e.target.id === 'numeric') {
    document.getElementById('check-btn')?.click();
  }
});

load();
