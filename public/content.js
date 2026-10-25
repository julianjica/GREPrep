// Shared content and pure logic. Loaded by the browser AND imported by the server.

export const QC_CHOICES = [
  'Quantity A is greater.',
  'Quantity B is greater.',
  'The two quantities are equal.',
  'The relationship cannot be determined from the information given.',
];

export const SECTIONS = {
  quant: { id: 'quant', title: 'Quantitative Reasoning', short: 'Quant', examMinutes: 21, examCount: 12 },
  verbal: { id: 'verbal', title: 'Verbal Reasoning', short: 'Verbal', examMinutes: 18, examCount: 12 },
};

export const TYPES = {
  quantComparison: {
    title: 'Quantitative Comparison', section: 'quant',
    rules: `Two quantities (Quantity A and Quantity B), optionally with centered given information in "stem". Choices are exactly the four standard QC choices in order: ${QC_CHOICES.join(' | ')}. Exactly one correct.`,
  },
  multipleChoiceSingle: { title: 'Problem Solving', section: 'quant', rules: 'A math problem with exactly five answer choices, exactly one correct.' },
  multipleChoiceMulti: { title: 'Select All That Apply', section: 'quant', rules: "A math problem that says 'Indicate all such values' or similar, with 3 to 8 choices and one or more correct; credit only if exactly the correct set is chosen." },
  numericEntry: { title: 'Numeric Entry', section: 'quant', rules: 'A math problem with no choices; the answer is a single number typed by the test taker. State any rounding instruction in the stem.' },
  textCompletion: { title: 'Text Completion', section: 'verbal', rules: "A one- or two-sentence passage with exactly one blank shown as '_____' and exactly five choices, exactly one correct. Context clues must make exactly one choice defensible." },
  sentenceEquivalence: { title: 'Sentence Equivalence', section: 'verbal', rules: "A single sentence with one blank shown as '_____' and exactly six choices. Exactly two choices produce sentences alike in meaning; both must be selected." },
  readingComprehension: { title: 'Reading Comprehension', section: 'verbal', rules: "A passage of 100-300 words followed by a question. Either five choices with exactly one correct, or three choices labeled 'Select all that apply' with one or more correct." },
};

export const DIFFICULTY_WEIGHT = { easy: 1, medium: 1.5, hard: 2 };

export const REASONS = {
  unclassified: 'Not tagged', concept: 'Concept gap', careless: 'Careless', vocabulary: 'Vocabulary', time: 'Time pressure',
};

// ---------- Question helpers ----------

export const letter = (i) => 'ABCDEFGH'[i] ?? String(i + 1);

export function allowsMultiple(q) {
  return q.type === 'multipleChoiceMulti' || q.type === 'sentenceEquivalence' ||
    (q.type === 'readingComprehension' && q.choices.length === 3);
}

export function instruction(q) {
  if (q.type === 'quantComparison') return 'Compare Quantity A and Quantity B.';
  if (q.type === 'numericEntry') return 'Enter your answer as an integer, decimal, or fraction.';
  if (q.type === 'sentenceEquivalence') return 'Select the two answer choices that complete the sentence and produce sentences alike in meaning.';
  return allowsMultiple(q) ? 'Select all the answer choices that apply.' : 'Select one answer choice.';
}

export function parseNumber(raw) {
  const s = String(raw ?? '').replace(/[,%\s]/g, '');
  if (!s) return null;
  if (s.includes('/')) {
    const [n, d] = s.split('/').map(Number);
    return Number.isFinite(n) && Number.isFinite(d) && d !== 0 ? n / d : null;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function formatNumber(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
}

export function answerText(q) {
  if (q.type === 'numericEntry') return (q.answerDisplay ?? formatNumber(q.numericAnswer)) + (q.unit ?? '');
  return q.correct.map(letter).join(', ');
}

export function isCorrect(q, selected, numeric) {
  if (q.type === 'numericEntry') {
    const v = parseNumber(numeric);
    return v !== null && Math.abs(v - q.numericAnswer) < 1e-6;
  }
  const a = [...selected].sort((x, y) => x - y).join(',');
  const b = [...q.correct].sort((x, y) => x - y).join(',');
  return a === b;
}

export function hasAnswer(q, selected, numeric) {
  return q.type === 'numericEntry' ? String(numeric ?? '').trim() !== '' : selected.length > 0;
}

export const sectionOf = (q) => TYPES[q.type].section;

// ---------- Scores, picking, stats ----------

export function scaledScore(results) {
  // results: [{correct: bool, difficulty}]
  if (!results.length) return 130;
  const possible = results.reduce((s, r) => s + DIFFICULTY_WEIGHT[r.difficulty], 0);
  const earned = results.reduce((s, r) => s + (r.correct ? DIFFICULTY_WEIGHT[r.difficulty] : 0), 0);
  const accuracy = earned / possible;
  const meanWeight = possible / results.length;
  const difficultyFactor = 0.85 + 0.15 * (meanWeight - 1);
  return Math.max(130, Math.min(170, Math.round(130 + 40 * Math.pow(accuracy, 1.2) * difficultyFactor)));
}

export function estimateScore(attempts, section, minimum = 10) {
  const recent = attempts.filter((a) => a.section === section).sort((a, b) => b.date - a.date).slice(0, 60);
  if (recent.length < minimum) return null;
  return scaledScore(recent);
}

export function topicAccuracy(attempts) {
  const totals = {};
  for (const a of attempts) {
    const t = (totals[a.topic] ??= [0, 0]);
    t[0] += a.correct ? 1 : 0;
    t[1] += 1;
  }
  return Object.fromEntries(Object.entries(totals).map(([k, [c, n]]) => [k, { accuracy: c / n, total: n }]));
}

export function makeSet(pool, attempts, count, { section, type } = {}) {
  let c = pool;
  if (section) c = c.filter((q) => sectionOf(q) === section);
  if (type) c = c.filter((q) => q.type === type);
  const acc = topicAccuracy(attempts);
  const lastSeen = {};
  for (const a of attempts) lastSeen[a.questionId] = Math.max(lastSeen[a.questionId] ?? 0, a.date);
  const scored = c.map((q) => {
    let p = Math.random() * 0.3 + (1 - (acc[q.topic]?.accuracy ?? 0.5));
    if (lastSeen[q.id]) p -= Math.max(0, 1.5 - ((Date.now() - lastSeen[q.id]) / 86400000) * 0.2);
    else p += 0.5;
    return [p, q];
  });
  return scored.sort((a, b) => b[0] - a[0]).slice(0, count).map(([, q]) => q);
}

const DAY = 86400000;
export const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const daysUntil = (t) => Math.max(0, Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY));

export function streak(attempts) {
  const days = new Set(attempts.map((a) => startOfDay(a.date)));
  let day = startOfDay(Date.now());
  if (!days.has(day)) day -= DAY;
  let n = 0;
  while (days.has(day)) { n++; day = startOfDay(day - DAY / 2); }
  return n;
}

export const answeredToday = (attempts) => attempts.filter((a) => startOfDay(a.date) === startOfDay(Date.now())).length;
export const dailyGoal = (minutes) => Math.max(5, Math.floor(minutes / 1.5));

// ---------- Study plan ----------

export function planPhase(dateMs, testDateMs, totalDays) {
  const left = Math.max(0, Math.round((startOfDay(testDateMs) - startOfDay(dateMs)) / DAY));
  if (left <= 5) return 3;
  const f = left / Math.max(totalDays, 1);
  return f > 0.66 ? 0 : f > 0.25 ? 1 : 2;
}

export const PHASES = [
  ['Foundations', 'Strategy lessons, core concepts, and a daily vocab habit.'],
  ['Targeted practice', 'Drills aimed at your weakest topics and question types.'],
  ['Test simulation', 'Timed sections under real conditions, with full review.'],
  ['Taper & review', 'Mistake notebook, light practice, and rest before test day.'],
];

export function planTasks(dateMs, testDateMs, totalDays, minutes) {
  const d = new Date(dateMs);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const wd = d.getDay() + 1; // 1 = Sunday
  const phase = planPhase(dateMs, testDateMs, totalDays);
  const list = [['Warm-up: vocab cards', 'Vocab', 8, { kind: 'vocab' }]];
  if (phase === 0) {
    const lesson = LESSONS[wd % LESSONS.length];
    list.push([`Lesson: ${lesson.title}`, 'Strategy', lesson.minutes, { kind: 'lesson', id: lesson.id }]);
    list.push(wd % 2 === 0 ? ['Mixed Quant set', 'Practice', 15, { kind: 'practice', section: 'quant' }]
      : ['Verbal set: Text Completion', 'Practice', 15, { kind: 'practice', type: 'textCompletion' }]);
  } else if (phase === 1) {
    const types = ['quantComparison', 'sentenceEquivalence', 'numericEntry', 'readingComprehension', 'multipleChoiceMulti', 'textCompletion', 'multipleChoiceSingle'];
    const t = types[wd % types.length];
    list.push([`Drill: ${TYPES[t].title}`, 'Practice', 20, { kind: 'practice', type: t }]);
    if (wd === 4) list.push(['Issue essay, timed', 'Writing', 30, { kind: 'essay' }]);
  } else if (phase === 2) {
    const s = wd % 2 === 0 ? 'quant' : 'verbal';
    list.push([`Timed ${SECTIONS[s].short} section`, 'Test sim', SECTIONS[s].examMinutes, { kind: 'exam', section: s }]);
    if (wd === 7) list.push(['Issue essay, timed', 'Writing', 30, { kind: 'essay' }]);
  } else {
    list.push(['Light mixed practice', 'Practice', 10, { kind: 'practice' }]);
  }
  list.push(['Ask the tutor about your weakest topic', 'Tutor', 10, { kind: 'tutor' }]);
  list.push(['Retry due mistakes', 'Mistake notebook', 8, { kind: 'mistakes' }]);
  const kept = [];
  let used = 0;
  for (const item of list) {
    if (kept.length < 2 || used + item[2] <= minutes + 5) { kept.push(item); used += item[2]; }
  }
  return kept.map(([title, cat, mins, dest], i) => ({ id: `${key}|${i}`, title, detail: `${cat} · ${mins} min`, dest }));
}

// ---------- Starter question bank (original; every key independently verified) ----------

const qc = (id, difficulty, topic, stem, quantityA, quantityB, answer, explanation) =>
  ({ id, type: 'quantComparison', difficulty, topic, stem, quantityA, quantityB, choices: QC_CHOICES, correct: [answer], explanation, source: 'bank' });
const mc = (id, type, difficulty, topic, stem, choices, correct, explanation, passage) =>
  ({ id, type, difficulty, topic, stem, choices, correct, explanation, passage, source: 'bank' });
const num = (id, difficulty, topic, stem, numericAnswer, explanation, extra = {}) =>
  ({ id, type: 'numericEntry', difficulty, topic, stem, choices: [], correct: [], numericAnswer, explanation, source: 'bank', ...extra });

const URBAN = 'For decades, ecologists assumed that urban environments were simply impoverished versions of natural habitats, supporting fewer species and simpler interactions. Recent studies complicate this view. In several cities, researchers have documented populations of insects and birds that have developed distinct traits—greater tolerance for heat, altered breeding schedules, songs pitched higher so they can be heard above traffic—within only a few dozen generations. Such findings suggest that cities are not merely degraded ecosystems but novel ones, exerting selective pressures that have no exact analogue in the wild. Critics caution, however, that many reported adaptations may reflect plasticity—an individual organism\'s capacity to adjust its behavior or physiology—rather than genetic change. Distinguishing the two requires multigenerational studies that remain rare, so the extent of genuine urban evolution is still uncertain.';

export const BANK = [
  qc('q01', 'medium', 'Algebra', 'x > 0', '(x + 3)²', 'x² + 9', 0, 'Expand Quantity A: (x + 3)² = x² + 6x + 9, which is Quantity B plus 6x. Because x > 0, 6x is positive, so Quantity A is always greater.'),
  qc('q02', 'medium', 'Number Properties', 'n is a positive odd integer.', 'The remainder when n² is divided by 4', '1', 2, 'Write n = 2k + 1. Then n² = 4k² + 4k + 1 = 4(k² + k) + 1, so the remainder is always 1. The quantities are equal.'),
  qc('q03', 'easy', 'Algebra', '', 'x²', 'x', 3, 'Plug in numbers. x = 2 gives 4 vs 2 (A greater); x = 1 gives 1 vs 1 (equal). Two different outcomes, so the relationship cannot be determined.'),
  qc('q04', 'easy', 'Arithmetic', '', '3/7', '0.43', 1, '3/7 ≈ 0.4286, which is less than 0.43. Quantity B is greater.'),
  qc('q05', 'easy', 'Geometry', 'A circle has radius 3.', 'The circumference of the circle', '18', 0, 'Circumference = 2π(3) = 6π ≈ 18.85, which is greater than 18.'),
  qc('q06', 'medium', 'Algebra', 'x and y are integers, x + y = 10, and x > y.', 'x', '5', 0, 'If x were 5, y would also be 5, contradicting x > y. If x < 5, then y > 5 > x. So x ≥ 6, and Quantity A is greater.'),
  qc('q07', 'medium', 'Geometry', 'Two sides of a triangle have lengths 5 and 8.', 'The length of the third side', '13', 1, 'By the triangle inequality, the third side must be less than 5 + 8 = 13. Quantity B is greater.'),
  qc('q08', 'hard', 'Algebra', 'a and b are positive, and a/b = 3/4.', '(a + 1)/(b + 1)', 'a/b', 0, '(a + 1)/(b + 1) − a/b = (b − a)/(b(b + 1)). Since a/b < 1, b > a, so the difference is positive. Adding the same positive amount to the top and bottom of a fraction less than 1 moves it toward 1.'),
  num('q09', 'medium', 'Percents', "A jacket's price is reduced by 20%. The reduced price is then increased by 25%. The final price is what percent of the original price?", 100, 'Start at 100. A 20% cut gives 80. A 25% increase on 80 adds 20, giving 100. The final price is 100% of the original.', { unit: '%' }),
  mc('q10', 'multipleChoiceSingle', 'easy', 'Algebra', 'If 3x − 7 = 11, what is the value of x²?', ['9', '18', '36', '49', '81'], [2], '3x = 18, so x = 6 and x² = 36.'),
  mc('q11', 'multipleChoiceMulti', 'easy', 'Number Properties', 'Which of the following are prime factors of 210? Indicate all such numbers.', ['2', '3', '4', '5', '7', '9'], [0, 1, 3, 4], '210 = 2 × 3 × 5 × 7. The numbers 4 and 9 are not prime.'),
  mc('q12', 'multipleChoiceSingle', 'medium', 'Statistics', 'The average of five numbers is 12. When one number is removed, the average of the remaining four numbers is 10. What number was removed?', ['10', '14', '18', '20', '22'], [3], 'The five numbers sum to 5 × 12 = 60. The remaining four sum to 4 × 10 = 40. The removed number is 60 − 40 = 20.'),
  num('q13', 'medium', 'Geometry', 'A circle is inscribed in a square with side length 6. What is the area of the region inside the square but outside the circle? Round your answer to the nearest tenth.', 7.7, 'Square area = 36. The circle\'s radius is 3, so its area is 9π ≈ 28.27. The difference is about 7.73, which rounds to 7.7.'),
  mc('q14', 'multipleChoiceSingle', 'medium', 'Counting', 'How many integers from 1 to 100, inclusive, are divisible by 3 or by 5?', ['40', '45', '47', '53', '60'], [2], 'Multiples of 3: 33. Multiples of 5: 20. Multiples of both (15): 6. By inclusion–exclusion, 33 + 20 − 6 = 47.'),
  mc('q15', 'multipleChoiceSingle', 'easy', 'Rates', 'A train travels 240 miles in 3 hours and 12 minutes. What is its average speed, in miles per hour?', ['70', '72', '75', '78', '80'], [2], '3 hours 12 minutes = 3.2 hours. 240 ÷ 3.2 = 75 miles per hour.'),
  mc('q16', 'multipleChoiceMulti', 'medium', 'Inequalities', 'Which of the following could be the value of x if |x − 2| < 3? Indicate all such values.', ['−2', '−1', '0', '4', '5', '6'], [2, 3], '|x − 2| < 3 means −3 < x − 2 < 3, so −1 < x < 5. Only 0 and 4 are strictly inside that range; −1 and 5 are excluded.'),
  num('q17', 'medium', 'Probability', 'A fair coin is tossed 3 times. What is the probability of getting exactly 2 heads? Give your answer as a fraction.', 0.375, 'There are 2³ = 8 equally likely outcomes. Exactly two heads: HHT, HTH, THH, which is 3 outcomes. Probability = 3/8.', { answerDisplay: '3/8' }),
  mc('q18', 'multipleChoiceSingle', 'hard', 'Number Properties', 'What is the sum of all the positive divisors of 36?', ['81', '85', '91', '96', '100'], [2], 'The divisors are 1, 2, 3, 4, 6, 9, 12, 18, 36. Their sum is 91.'),
  num('q19', 'hard', 'Exponents', 'If 2^(x + 3) = 32^(x − 1), what is the value of x?', 2, '32 = 2⁵, so 32^(x − 1) = 2^(5x − 5). Set exponents equal: x + 3 = 5x − 5, so 4x = 8 and x = 2.'),
  qc('q20', 'hard', 'Statistics', 'Set S = {4, 8, 12, 16, 20}. Set T is formed by adding 5 to each number in S.', 'The standard deviation of S', 'The standard deviation of T', 2, 'Adding the same constant to every value shifts the data but does not change how spread out it is. The standard deviations are equal.'),

  mc('v01', 'textCompletion', 'hard', 'Vocabulary in context', "Although the professor's lectures were often _____, filled with dense jargon and long digressions, her published work was remarkably lucid.", ['abstruse', 'cogent', 'succinct', 'pellucid', 'trenchant'], [0], '"Although" signals a contrast with "remarkably lucid," and the lectures are "filled with dense jargon," so the blank means hard to understand: abstruse. Pellucid and succinct point the wrong way; cogent and trenchant describe clear, forceful arguments.'),
  mc('v02', 'textCompletion', 'medium', 'Vocabulary in context', "The senator's speech was so _____ that even her allies struggled to recall a single memorable line.", ['insipid', 'incendiary', 'eloquent', 'controversial', 'impassioned'], [0], 'A speech no one can remember a line from is dull: insipid. Incendiary, controversial and impassioned speeches tend to be memorable, and eloquent is positive.'),
  mc('v03', 'textCompletion', 'medium', 'Vocabulary in context', 'Far from being _____, the new policy was the product of months of careful deliberation.', ['precipitate', 'deliberate', 'methodical', 'prudent', 'contentious'], [0], '"Far from" sets up the opposite of "careful deliberation," so the blank means hasty: precipitate. Deliberate, methodical and prudent mean the opposite of what is needed; contentious is off-topic.'),
  mc('v04', 'textCompletion', 'easy', 'Vocabulary in context', 'Despite his reputation for _____, the executive quietly donated most of his fortune to charity.', ['parsimony', 'generosity', 'candor', 'diffidence', 'levity'], [0], '"Despite" signals that the reputation contrasts with giving money away, so the blank means stinginess: parsimony.'),
  mc('v05', 'sentenceEquivalence', 'medium', 'Vocabulary in context', 'The scientist remained _____ about the results, refusing to draw any conclusions until the experiment had been replicated.', ['circumspect', 'cautious', 'ebullient', 'dogmatic', 'cavalier', 'sanguine'], [0, 1], 'Refusing to conclude until results are replicated shows care: circumspect and cautious produce sentences alike in meaning. Ebullient and sanguine suggest enthusiasm; dogmatic and cavalier contradict the behavior.'),
  mc('v06', 'sentenceEquivalence', 'easy', 'Vocabulary in context', 'Her prose is notably _____: she never uses ten words where three will do.', ['terse', 'concise', 'florid', 'verbose', 'ornate', 'obscure'], [0, 1], 'Using few words means brief: terse and concise. Florid, verbose and ornate are opposites; obscure is about clarity, not length.'),
  mc('v07', 'sentenceEquivalence', 'hard', 'Vocabulary in context', "The historian's account, though entertaining, was largely _____, built on anecdotes of doubtful origin.", ['apocryphal', 'spurious', 'meticulous', 'authoritative', 'tedious', 'voluminous'], [0, 1], 'Anecdotes of doubtful origin make an account of questionable authenticity: apocryphal and spurious. Meticulous and authoritative are opposites; tedious contradicts "entertaining"; voluminous is about length.'),
  mc('v08', 'sentenceEquivalence', 'medium', 'Vocabulary in context', "The committee's decision, initially dismissed as _____, eventually proved remarkably prescient.", ['rash', 'imprudent', 'wise', 'judicious', 'popular', 'lengthy'], [0, 1], '"Initially dismissed" and "eventually proved prescient" set up a contrast, so the decision first seemed unwise: rash and imprudent.'),
  mc('v09', 'readingComprehension', 'medium', 'Reading: main idea', 'The primary purpose of the passage is to', ['argue that cities have little ecological value', 'present a revised view of urban ecosystems and note a limitation of the evidence for it', 'explain why plasticity is more common than genetic adaptation', 'describe the methods used in multigenerational studies', 'refute the claim that urban species have changed'], [1], 'The passage introduces a newer view (cities as novel ecosystems), then raises a caution about the evidence (plasticity vs. genetic change). It never claims plasticity is more common, never describes study methods, and does not deny that species have changed.', URBAN),
  mc('v10', 'readingComprehension', 'medium', 'Reading: detail', 'According to the passage, which of the following might reflect plasticity rather than genetic change? Select all that apply.', ['Birds singing at a higher pitch near busy roads', 'Insects tolerating higher temperatures', 'A city supporting fewer species than a forest'], [0, 1], 'Critics say "many reported adaptations may reflect plasticity." The higher-pitched songs and heat tolerance are both listed as reported adaptations. Having fewer species is not a trait of an organism, so plasticity does not apply.', URBAN),
  mc('v11', 'readingComprehension', 'easy', 'Reading: vocabulary', 'In the context of the passage, "novel" most nearly means', ['fictional', 'new and unlike earlier kinds', 'literary', 'short-lived', 'unreliable'], [1], 'Cities are called "not merely degraded ecosystems but novel ones" with pressures that have "no exact analogue in the wild," so novel means new and unlike anything before.', URBAN),
  mc('v12', 'textCompletion', 'hard', 'Vocabulary in context', "Critics who expected the young novelist's second book to be as _____ as her first were surprised by its restraint: gone were the sprawling subplots and extravagant metaphors.", ['baroque', 'austere', 'laconic', 'derivative', 'tentative'], [0], '"Restraint" contrasts with the first book\'s "sprawling subplots and extravagant metaphors," so the first book was elaborately ornate: baroque. Austere and laconic describe the restrained second book instead.'),
];

// ---------- Vocabulary ----------

const w = (word, pos, def, example, syn) => ({ word, pos, def, example, syn });
export const VOCAB = [
  w('Laconic', 'adjective', 'Using very few words.', 'Her laconic reply — "No." — ended the debate.', 'terse, curt, pithy'),
  w('Obdurate', 'adjective', "Stubbornly refusing to change one's opinion or course of action.", 'The board remained obdurate despite the protests.', 'intransigent, inflexible'),
  w('Ephemeral', 'adjective', 'Lasting for a very short time.', 'Fame on social media is often ephemeral.', 'fleeting, transient'),
  w('Prevaricate', 'verb', 'To speak or act evasively to avoid the truth.', 'Pressed for details, the witness began to prevaricate.', 'equivocate, hedge'),
  w('Abstruse', 'adjective', 'Difficult to understand; obscure.', 'The lecture drifted into abstruse theory.', 'recondite, arcane'),
  w('Pellucid', 'adjective', 'Translucently clear; easy to understand.', 'Her pellucid explanation made the proof obvious.', 'lucid, limpid'),
  w('Parsimony', 'noun', 'Extreme unwillingness to spend money.', 'His parsimony extended to refusing to heat the office.', 'stinginess, frugality'),
  w('Circumspect', 'adjective', 'Wary and unwilling to take risks.', 'Investors grew circumspect after the crash.', 'cautious, prudent'),
  w('Sanguine', 'adjective', 'Optimistic, especially in a difficult situation.', "She remained sanguine about the team's chances.", 'hopeful, buoyant'),
  w('Cavalier', 'adjective', 'Showing a lack of proper concern; offhand.', 'His cavalier attitude toward deadlines worried his editor.', 'careless, indifferent'),
  w('Apocryphal', 'adjective', 'Of doubtful authenticity, though widely repeated.', "The story about the founder's dorm-room epiphany is apocryphal.", 'spurious, unverified'),
  w('Prescient', 'adjective', 'Having knowledge of events before they happen.', 'Her prescient warning came two years before the collapse.', 'farsighted, prophetic'),
  w('Insipid', 'adjective', 'Lacking flavor, interest, or vigor.', 'The sequel was an insipid retread of the original.', 'bland, vapid'),
  w('Precipitate', 'adjective', 'Done suddenly and without careful thought.', 'The precipitate decision cost the company millions.', 'hasty, rash'),
  w('Baroque', 'adjective', 'Highly ornate and extravagant in style.', 'His baroque sentences ran half a page.', 'elaborate, florid'),
  w('Austere', 'adjective', 'Severe or strict; plain and without decoration.', "The monastery's austere rooms held only a bed and a desk.", 'stark, spartan'),
  w('Equivocal', 'adjective', 'Open to more than one interpretation; ambiguous.', "The study's equivocal results satisfied no one.", 'ambiguous, inconclusive'),
  w('Garrulous', 'adjective', 'Excessively talkative, especially about trivial matters.', 'The garrulous driver narrated every landmark.', 'loquacious, voluble'),
  w('Lionize', 'verb', 'To treat as a celebrity.', 'The press lionized the young inventor.', 'celebrate, glorify'),
  w('Mitigate', 'verb', 'To make less severe or painful.', 'Planting trees can mitigate urban heat.', 'alleviate, temper'),
  w('Pedantic', 'adjective', 'Overly concerned with minor details or rules.', 'His pedantic corrections derailed the meeting.', 'fussy, punctilious'),
  w('Quixotic', 'adjective', 'Idealistic in an unrealistic, impractical way.', 'The quixotic campaign aimed to end all traffic in a year.', 'impractical, visionary'),
  w('Recalcitrant', 'adjective', 'Uncooperative toward authority.', 'The recalcitrant student refused to rewrite the essay.', 'defiant, unruly'),
  w('Tractable', 'adjective', 'Easy to control or influence.', 'The problem became tractable once we split it in two.', 'manageable, docile'),
  w('Venerate', 'verb', 'To regard with great respect.', 'The village venerated its oldest residents.', 'revere, honor'),
  w('Zealous', 'adjective', 'Having great energy or enthusiasm for a cause.', 'A zealous volunteer, she knocked on every door.', 'fervent, ardent'),
  w('Enervate', 'verb', 'To cause someone to feel drained of energy.', 'The humid afternoon enervated the hikers.', 'weaken, exhaust'),
  w('Vacillate', 'verb', 'To waver between different opinions or actions.', 'He vacillated for weeks between the two offers.', 'waver, dither'),
  w('Dogmatic', 'adjective', 'Inclined to lay down principles as undeniably true.', 'Her dogmatic tone left no room for discussion.', 'doctrinaire, opinionated'),
  w('Ubiquitous', 'adjective', 'Present, appearing, or found everywhere.', 'Smartphones have become ubiquitous.', 'omnipresent, pervasive'),
];

// ---------- Strategy lessons ----------

export const LESSONS = [
  { id: 'qc-plug', title: 'Plug in strategic numbers', section: 'quant', minutes: 6, practiceType: 'quantComparison', steps: [
    { heading: 'The idea', body: "On Quantitative Comparison you don't need to prove a general rule. You only need to know whether one relationship always holds.", bullets: ['Try a normal number first, like 2.', 'Then try the numbers where relationships flip: 1, 0, −1, a fraction like ½, and a big number like 100.', 'Only use values the given information allows.'] },
    { heading: 'Worked example', body: 'Compare Quantity A: x² with Quantity B: x, with no constraint on x.', bullets: ['x = 2: A is 4, B is 2, so A is greater.', 'x = 1: both are 1, so they are equal.', 'x = ½: A is ¼, B is ½, so B is greater.'], callout: 'Two different outcomes means the answer is D. Stop as soon as you see a flip.' },
    { heading: 'Takeaways', body: 'Use plugging in when variables have few constraints.', bullets: ['Two different outcomes → D.', 'Every case agreeing suggests A, B or C; confirm with algebra if time allows.', 'D is never possible when both quantities are plain numbers.'] },
  ] },
  { id: 'tc-predict', title: 'Predict before you look', section: 'verbal', minutes: 5, practiceType: 'textCompletion', steps: [
    { heading: 'Cover the choices', body: 'Read the sentence and fill the blank with your own word before looking at the options. This stops attractive wrong answers from steering you.', bullets: ['Find the clue: the part of the sentence that tells you what the blank must mean.', 'Find the signal word that says whether the blank agrees or contrasts with the clue.'] },
    { heading: 'Signal words', body: 'Small words decide the direction of the blank.', bullets: ['Contrast: although, despite, but, yet, far from, however.', 'Same direction: because, and, indeed, in fact, so.', 'A colon or semicolon often means the second half explains the first.'], callout: '"Despite his reputation for _____, he gave his fortune away" → the blank means stingy.' },
    { heading: 'Match and check', body: 'Pick the choice closest to your prediction, then reread the full sentence with it in place. If two choices both seem to fit, look again for the clue you missed.', bullets: [] },
  ] },
  { id: 'se-pairs', title: 'Find the matching pair', section: 'verbal', minutes: 5, practiceType: 'sentenceEquivalence', steps: [
    { heading: 'Two answers, one meaning', body: 'Sentence Equivalence has six choices and you must pick the two that give sentences alike in meaning. You get no partial credit.', bullets: ['Predict the meaning of the blank first.', 'Look for two choices that match your prediction and each other.'] },
    { heading: 'Beware of lonely synonyms', body: 'Test makers often include a synonym pair that does not fit the sentence. A pair is only right if both words fit the context.', bullets: [], callout: 'Fit first, then pair. Never pick a pair just because the words mean the same thing.' },
    { heading: 'If no pair jumps out', body: "Eliminate words that clearly don't fit, then look for the two closest in meaning among what remains.", bullets: [] },
  ] },
  { id: 'rc-map', title: 'Map the passage', section: 'verbal', minutes: 7, practiceType: 'readingComprehension', steps: [
    { heading: 'Read for structure', body: "You don't need to memorize details. Track what each part of the passage is doing.", bullets: ['What view is presented?', 'Who disagrees, and why?', "What is the author's own position, if any?"] },
    { heading: 'Primary purpose questions', body: 'The right answer covers the whole passage, not one paragraph. Its verb should match the author\'s tone: "argue" and "refute" are strong; "describe" and "present" are neutral.', bullets: [] },
    { heading: 'Detail questions', body: "Go back to the text and find the exact line. The right answer is usually a paraphrase; wrong answers often reuse the passage's words with a twist.", bullets: [], callout: "If you can't point to the line that supports it, don't pick it." },
  ] },
  { id: 'pacing', title: 'Pacing and guessing', section: null, minutes: 4, practiceType: null, steps: [
    { heading: 'There is no penalty for guessing', body: 'Wrong answers count the same as blank ones. Never leave a question unanswered.', bullets: ['Quant: 12 questions in 21 minutes, about 1:45 each.', 'Verbal: 12 questions in 18 minutes, about 1:30 each.'] },
    { heading: 'Mark and move', body: 'If a question is taking more than twice the average time, pick your best guess, mark it, and move on. Use the Review screen to come back if time remains.', bullets: [] },
    { heading: 'Section scoring is adaptive', body: 'Your performance on the first section of each measure sets the difficulty of the second. Accuracy early matters more than speed.', bullets: [], callout: "Easy questions are worth as much as hard ones. Don't rush them." },
  ] },
];

// ---------- Essay prompts (original, in the style of the Analyze an Issue task) ----------

export const ESSAY_INSTRUCTIONS = 'Write a response in which you discuss the extent to which you agree or disagree with the statement and explain your reasoning. Consider ways in which the statement might or might not hold true, and explain how these considerations shape your position.';
export const ESSAY_PROMPTS = [
  'Governments should put more money into basic scientific research than into applied research with immediate practical uses.',
  'The best way to understand a society is to study the things its people choose to celebrate.',
  'Students learn more from failing at a difficult task than from succeeding at an easy one.',
  'Leaders are most effective when they are willing to change their positions in response to new information.',
  'Cities should prioritize public spaces over private development, even when this slows economic growth.',
];
