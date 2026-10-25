// AI question generation with a four-step validation pipeline, run by the Claude Code agent.
//   1. Format   – local rules mirroring the official GRE question formats.
//   2. Solves   – the question WITHOUT its key is solved from scratch 3 times; all must match the key.
//   3. Code     – for Quant, the agent's JavaScript recomputation runs here in a sandboxed VM with a
//                 time limit and must match the key.
//   4. Review   – a separate strict "item reviewer" pass checks for one defensible answer, ambiguity,
//                 GRE style, difficulty, and a correct explanation.
// Drafts that fail anything are discarded and rewritten.
import vm from 'node:vm';
import crypto from 'node:crypto';
import { askJSON } from './agent.js';
import { QC_CHOICES, TYPES, letter, answerText, allowsMultiple, instruction, parseNumber } from '../public/content.js';

const jobs = new Map();

export function getJob(id) { return jobs.get(id); }
export function cancelJob(id) { const j = jobs.get(id); if (j && j.status === 'running') { j.cancelled = true; j.status = 'cancelled'; } }

export function startJob({ type, difficulty, count, topics, existing, model, onAccepted }) {
  const job = {
    id: crypto.randomUUID(), type, difficulty, count, status: 'running', statusText: 'Starting…',
    accepted: [], reports: [], error: null, cancelled: false, created: Date.now(),
  };
  jobs.set(job.id, job);
  run(job, { topics, existing, model, onAccepted }).catch((err) => {
    job.status = 'failed';
    job.error = err.message;
  });
  // forget old jobs after an hour
  for (const [id, j] of jobs) if (Date.now() - j.created > 3600000) jobs.delete(id);
  return job;
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);

async function run(job, { topics, existing, model, onAccepted }) {
  const seen = new Set(existing.map((q) => norm(q.stem + (q.quantityA ?? '') + (q.quantityB ?? ''))));
  const maxDrafts = job.count * 3;
  let used = 0;
  while (job.accepted.length < job.count && used < maxDrafts) {
    if (job.cancelled) return;
    const batch = Math.min(5, job.count - job.accepted.length);
    job.statusText = `Writing ${batch} draft${batch === 1 ? '' : 's'}…`;
    const drafts = await writeDrafts(job, batch, topics, [...seen].slice(0, 40), model);
    // Validate the batch in parallel (the agent bridge limits concurrent CLI processes).
    job.statusText = `Checking ${drafts.length} draft${drafts.length === 1 ? '' : 's'}…`;
    const numbered = drafts.map((d) => ({ d, n: ++used }));
    const reports = await Promise.all(numbered.map(({ d, n }) => validate(d, n, job, model)));
    for (const report of reports) {
      if (job.cancelled) return;
      const q = report.question;
      if (q && report.accepted) {
        const key = norm(q.stem + (q.quantityA ?? '') + (q.quantityB ?? ''));
        if (seen.has(key)) {
          report.accepted = false;
          report.checks.push({ name: 'Originality', passed: false, detail: 'Duplicates an existing question.' });
        } else if (job.accepted.length < job.count) {
          seen.add(key);
          job.accepted.push(q);
          onAccepted?.(q, report.checks);
        }
      }
      job.reports.push(summarize(report));
    }
  }
  job.statusText = `${job.accepted.length} of ${job.count} questions passed every check.`;
  job.status = 'finished';
}

function summarize(r) {
  const failed = r.checks.find((c) => !c.passed);
  return { draft: r.draft, accepted: r.accepted, checks: r.checks, failure: failed ? `${failed.name}: ${failed.detail}` : '' };
}

// ---------- drafting ----------

async function writeDrafts(job, count, topics, avoid, model) {
  const t = TYPES[job.type];
  const quant = t.section === 'quant';
  const system = 'You write original practice questions for the GRE General Test. Never copy or closely paraphrase published ETS questions. Questions must match the official format exactly, use standard American English, and have exactly one defensible answer key.';
  const prompt = `Write ${count} ${job.difficulty} GRE ${t.title} questions.
Official format: ${t.rules}
Focus topics: ${topics?.length ? topics.join(', ') : 'any topic commonly tested'}.
Difficulty guide: easy = one step, common concept; medium = two or three steps or a common trap; hard = multiple concepts or a subtle trap most test takers fall for.
Wrong choices must reflect realistic mistakes (sign errors, misread conditions, partial work, near-synonyms that miss the tone).
Do not reuse these stems: ${avoid.join(' | ') || 'none'}

Return exactly this JSON shape:
{"questions":[{
  "type":"${job.type}",
  "difficulty":"${job.difficulty}",
  "topic":"short label, e.g. Geometry or Vocabulary in context",
  "passage": null or "reading passage",
  "stem":"question text (use _____ for a blank; for Quantitative Comparison put the given information here, or empty string)",
  "quantityA": null or "Quantity A",
  "quantityB": null or "Quantity B",
  "choices":["..."],
  "correct":[zero-based indices of correct choices],
  "numericAnswer": null or number,
  "unit": null or "%" etc,
  "explanation":"2-4 sentences a student can follow, including why tempting wrong answers fail",
  "verification_js": ${quant ? '"JavaScript function BODY that recomputes the answer from scratch with arithmetic (never a hard-coded return). For Quantitative Comparison, test many allowed values and return \'A\',\'B\',\'C\' or \'D\'. For choice questions, evaluate each choice and return an array of correct letters. For numeric entry, return the number."' : 'null'}
}]}`;
  const json = await askJSON(prompt, { system, model, timeoutMs: 300000 });
  const items = Array.isArray(json.questions) ? json.questions : [];
  return items.map(parseDraft);
}

function parseDraft(d) {
  if (!d || !TYPES[d.type] || typeof d.stem !== 'string' || typeof d.explanation !== 'string') {
    return { question: null, js: null, error: 'Missing required fields.' };
  }
  const q = {
    id: 'ai-' + crypto.randomUUID().slice(0, 8),
    type: d.type,
    difficulty: ['easy', 'medium', 'hard'].includes(d.difficulty) ? d.difficulty : 'medium',
    topic: String(d.topic || TYPES[d.type].title).slice(0, 60),
    passage: typeof d.passage === 'string' && d.passage.trim() ? d.passage : undefined,
    stem: d.stem,
    quantityA: d.quantityA ?? undefined,
    quantityB: d.quantityB ?? undefined,
    choices: d.type === 'quantComparison' ? QC_CHOICES : (Array.isArray(d.choices) ? d.choices.map(String) : []),
    correct: (Array.isArray(d.correct) ? d.correct : []).map(Number).filter(Number.isInteger).sort((a, b) => a - b),
    numericAnswer: typeof d.numericAnswer === 'number' ? d.numericAnswer : undefined,
    unit: typeof d.unit === 'string' && d.unit ? d.unit : undefined,
    explanation: d.explanation,
    source: 'ai',
  };
  return { question: q, js: typeof d.verification_js === 'string' ? d.verification_js : null };
}

// ---------- validation ----------

async function validate(draft, n, job, model) {
  const report = { draft: n, question: draft.question, checks: [], accepted: false };
  const q = draft.question;
  if (!q) { report.checks.push({ name: 'Format', passed: false, detail: draft.error }); return report; }

  // 1. format
  const issues = formatIssues(q);
  if (q.type !== job.type) issues.unshift(`Wrong question type (${TYPES[q.type].title}).`);
  report.checks.push({
    name: 'Matches official GRE format', passed: !issues.length,
    detail: issues.length ? issues.join(' ') : `Choice count, answer count, blanks and layout follow the ${TYPES[q.type].title} format.`,
  });
  if (issues.length || job.cancelled) return report;

  // 2. three independent solves
  const key = keyOf(q);
  const solves = await Promise.all([solve(q, model), solve(q, model), solve(q, model)]);
  const agree = solves.filter((s) => s !== null && s === key).length;
  report.checks.push({
    name: 'Answer agrees across 3 independent solves', passed: agree === 3,
    detail: `Key ${key}; solvers answered ${solves.map((s) => s ?? 'no answer').join(', ')}.`,
  });
  if (agree !== 3 || job.cancelled) return report;

  // 3. code recomputation (quant)
  if (TYPES[q.type].section === 'quant') {
    const r = verifyCode(draft.js, q);
    report.checks.push({ name: 'Math recomputed with code', passed: r.passed, detail: r.detail });
    if (!r.passed) return report;
  }

  // 4. expert review
  report.checks.push(await review(q, job.difficulty, model));
  report.accepted = report.checks.every((c) => c.passed);
  return report;
}

export function formatIssues(q) {
  const out = [];
  const blanks = q.stem.split('_____').length - 1;
  const lowered = q.choices.map((c) => c.trim().toLowerCase());
  if (q.stem.length > 700) out.push('Stem is too long.');
  if (q.explanation.length < 20) out.push('Explanation is missing or too short.');
  if (lowered.includes('')) out.push('A choice is empty.');
  if (new Set(lowered).size !== lowered.length) out.push('Duplicate choices.');
  if (q.correct.some((i) => i < 0 || i >= q.choices.length)) out.push('Answer key points outside the choices.');
  switch (q.type) {
    case 'quantComparison':
      if (q.correct.length !== 1) out.push('Needs exactly one answer.');
      if (!q.quantityA || !q.quantityB) out.push('Both quantities are required.');
      break;
    case 'multipleChoiceSingle':
      if (q.choices.length !== 5) out.push('Needs exactly five choices.');
      if (q.correct.length !== 1) out.push('Needs exactly one answer.');
      break;
    case 'multipleChoiceMulti':
      if (q.choices.length < 3 || q.choices.length > 8) out.push('Needs 3–8 choices.');
      if (!q.correct.length) out.push('Needs at least one answer.');
      break;
    case 'numericEntry':
      if (typeof q.numericAnswer !== 'number') out.push('Missing the numeric answer.');
      if (q.choices.length) out.push('Numeric entry has no choices.');
      break;
    case 'textCompletion':
      if (blanks !== 1) out.push('Needs exactly one blank (_____).');
      if (q.choices.length !== 5) out.push('Needs exactly five choices.');
      if (q.correct.length !== 1) out.push('Needs exactly one answer.');
      break;
    case 'sentenceEquivalence':
      if (blanks !== 1) out.push('Needs exactly one blank (_____).');
      if (q.choices.length !== 6) out.push('Needs exactly six choices.');
      if (q.correct.length !== 2) out.push('Needs exactly two answers.');
      break;
    case 'readingComprehension': {
      const words = (q.passage ?? '').split(/\s+/).filter(Boolean).length;
      if (words < 60 || words > 400) out.push('Passage should be about 100–300 words.');
      const single = q.choices.length === 5 && q.correct.length === 1;
      const multi = q.choices.length === 3 && q.correct.length >= 1;
      if (!single && !multi) out.push('Needs five choices with one answer, or three select-all choices.');
      break;
    }
  }
  return out;
}

function keyOf(q) {
  if (q.type === 'numericEntry') return 'n:' + Math.round(q.numericAnswer * 1e6) / 1e6;
  return q.correct.map(letter).join('+');
}

function keyFromAnswer(answer, q) {
  if (q.type === 'numericEntry') {
    const v = typeof answer === 'number' ? answer : parseNumber(answer);
    return v === null || !Number.isFinite(v) ? null : 'n:' + Math.round(v * 1e6) / 1e6;
  }
  const raw = Array.isArray(answer) ? answer : [answer];
  const idx = raw.map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-H]$/.test(x))
    .map((x) => x.charCodeAt(0) - 65).sort((a, b) => a - b);
  return idx.length ? [...new Set(idx)].map(letter).join('+') : null;
}

export function plainText(q) {
  const lines = [`Question type: ${TYPES[q.type].title}`];
  if (q.passage) lines.push(`Passage:\n${q.passage}`);
  if (q.stem) lines.push(q.stem);
  if (q.quantityA) lines.push(`Quantity A: ${q.quantityA}`, `Quantity B: ${q.quantityB}`);
  q.choices.forEach((c, i) => lines.push(`(${letter(i)}) ${c}`));
  if (q.unit && q.type === 'numericEntry') lines.push(`Answer unit: ${q.unit}`);
  return lines.join('\n');
}

async function solve(q, model) {
  const format = q.type === 'numericEntry'
    ? '{"work":"brief work","answer": number}'
    : '{"work":"brief work","answer": ["letters of every correct choice"]}';
  try {
    const json = await askJSON(`${plainText(q)}\n\n${instruction(q)}\nReturn ${format}`, {
      system: 'You are a top GRE test taker. Solve the question carefully and independently.', model,
    });
    return keyFromAnswer(json.answer, q);
  } catch {
    return null;
  }
}

export function verifyCode(js, q) {
  if (!js || !js.trim()) return { passed: false, detail: 'No verification code was provided.' };
  const compact = js.replace(/\s/g, '');
  if (compact.length < 30 || /^return["'\d[]/.test(compact)) {
    return { passed: false, detail: 'Code returned a hard-coded value instead of computing the answer.' };
  }
  let output;
  try {
    output = vm.runInNewContext(`(function(){\n${js}\n})()`, { Math }, { timeout: 1000 });
  } catch (err) {
    return { passed: false, detail: `Verification code failed to run (${String(err.message).slice(0, 80)}).` };
  }
  const computed = keyFromAnswer(output, q);
  const key = keyOf(q);
  if (!computed) return { passed: false, detail: `Code output "${String(output).slice(0, 40)}" isn't a valid answer.` };
  return computed === key
    ? { passed: true, detail: `Code computed ${computed.replace('n:', '')}, matching the key.` }
    : { passed: false, detail: `Code computed ${computed.replace('n:', '')} but the key is ${key.replace('n:', '')}.` };
}

async function review(q, difficulty, model) {
  const name = 'Expert review: one defensible answer, GRE style';
  try {
    const j = await askJSON(`Review this ${TYPES[q.type].title} item intended to be ${difficulty}.

${plainText(q)}

Answer key: ${answerText(q)}
Explanation: ${q.explanation}

Check: (1) exactly one defensible answer key with no alternative readings, (2) no ambiguity or missing conditions, (3) wording, length and conventions match real GRE items, (4) difficulty matches the label, (5) the explanation is correct, (6) the content is original, not a recognizable published item.
Return {"single_defensible_answer":bool,"ambiguous":bool,"style_score":1-5,"difficulty_matches":bool,"explanation_correct":bool,"issues":["..."]}`, {
      system: 'You are a strict ETS-style item reviewer. You reject flawed items.', model,
    });
    const passed = j.single_defensible_answer === true && j.ambiguous === false && Number(j.style_score) >= 4 &&
      j.difficulty_matches === true && j.explanation_correct === true;
    return {
      name, passed,
      detail: passed ? `Style ${j.style_score}/5, difficulty confirmed, explanation checked.`
        : (j.issues?.[0] ?? `Style ${j.style_score}/5; single answer: ${j.single_defensible_answer}; ambiguous: ${j.ambiguous}.`),
    };
  } catch (err) {
    return { name, passed: false, detail: 'Review could not be completed.' };
  }
}

export { allowsMultiple };
