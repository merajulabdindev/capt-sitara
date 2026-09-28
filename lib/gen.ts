// Text-question generation with a second, independent "solve it blind" pass.
// A question is stored only if the checker, seeing the options in a different order and NOT knowing
// the answer key, picks the same answer text.
import { createHash } from 'crypto';
import type { Ask } from './ai';
import { verifyProvider } from './ai';

export type Cat = 'verbal' | 'nonverbal' | 'education' | 'gk';
export type Row = {
  category: Cat; topic: string; subtopic: string | null; difficulty: number; stem: string;
  stem_image?: null; options: Record<'A' | 'B' | 'C' | 'D', string>; correct_option: 'A' | 'B' | 'C' | 'D';
  exam_explanation: string; plain_explanation: string; similar_group: string | null; origin: 'ai'; sig: string;
};

export const TOPICS: Record<Exclude<Cat, 'nonverbal'>, string[]> = {
  verbal: ['Number Series', 'Letter Series', 'Analogies (word pairs)', 'Odd One Out', 'Coding-Decoding',
    'Blood Relations', 'Direction Sense', 'Ranking and Order', 'Syllogisms (simple)', 'Synonyms and Antonyms',
    'Sentence Completion', 'Arithmetic Reasoning (short word problems)', 'Alphabet Position Puzzles', 'Clock and Calendar'],
  education: ['Percentages', 'Ratio and Proportion', 'Simple Algebra', 'Geometry basics', 'Average and Mixture',
    'Speed Time Distance', 'Profit and Loss', 'English Grammar (tenses, articles, prepositions)',
    'English Vocabulary', 'Physics (matter, motion, energy)', 'Chemistry (elements, acids, bases, reactions)',
    'Biology (human body, plants, cells)', 'Everyday Science', 'Computer Basics'],
  gk: ['Pakistan Studies and History', 'Geography of Pakistan', 'World Geography', 'Islamic Studies and History',
    'Pakistan Armed Forces and Defence (general knowledge)', 'World Organizations and Treaties', 'Famous Personalities',
    'Science Inventions and Discoveries', 'Constitution and Government of Pakistan', 'Capitals, Currencies and Countries',
    'Sports and Culture (well established facts)', 'Space and Environment basics'],
};

const DIFF: Record<number, string> = {
  1: 'very easy: one step, a bright student answers in about 10 seconds',
  2: 'easy: one or two steps, about 20 seconds',
  3: 'medium: typical military-selection-test level, about 30 seconds',
  4: 'hard: two or three steps or a subtle trap, about 45 seconds',
  5: 'very hard: the toughest questions in such tests, about 60 seconds',
};

const SYSTEM = `You write multiple-choice questions for a Pakistani armed forces selection test (ISSB / PAF / Navy / Army style) practice app.
Accuracy is the most important thing. A wrong answer key harms the student, so only write questions whose single correct answer you are certain about.
Rules for every question:
- Exactly 4 options, exactly one correct. The other three must be plausible but clearly wrong.
- Self-contained plain text. No pictures, no "see figure", no tables.
- Never use "all of the above", "none of the above", "both A and B" or similar options.
- Put the correct answer in a different position each time.
- Use only facts that are stable and well established (no news, no records that change, no disputed claims).
- exam_explanation: the fastest way to solve it in the real exam, plus the most common trap. 1 to 3 sentences.
- plain_explanation: the core idea in very simple words with a tiny example. It must be worded differently from exam_explanation.
- similar_group: a short lowercase label like "series-squares" shared by questions that test the same idea.`;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const sigOf = (stem: string) => createHash('md5').update(norm(stem)).digest('hex');

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
export function pick<T>(a: T[], n: number): T[] { return shuffle(a).slice(0, n); }

const BAD_OPTION = /\b(all of the above|none of the above|both a and b|a and b both|all of these|none of these)\b/i;

// Local sanity checks before spending a verification call.
export function cleanCandidate(c: any, cat: Cat, diff: number): Row | null {
  try {
    const o = c?.options;
    if (!o || typeof c.stem !== 'string') return null;
    const opts = { A: String(o.A ?? '').trim(), B: String(o.B ?? '').trim(), C: String(o.C ?? '').trim(), D: String(o.D ?? '').trim() };
    const vals = Object.values(opts);
    if (vals.some((v) => !v || v.length > 200) || new Set(vals.map(norm)).size !== 4) return null;
    if (vals.some((v) => BAD_OPTION.test(v))) return null;
    const ans = String(c.correct_option ?? '').trim().toUpperCase();
    if (!['A', 'B', 'C', 'D'].includes(ans)) return null;
    const stem = c.stem.trim();
    if (stem.length < 10 || stem.length > 600 || /\b(figure|diagram|image|picture|shown below)\b/i.test(stem)) return null;
    const ex = String(c.exam_explanation ?? '').trim(), pl = String(c.plain_explanation ?? '').trim();
    if (ex.length < 15 || pl.length < 15 || norm(ex) === norm(pl)) return null;
    return {
      category: cat, topic: String(c.topic || 'General').slice(0, 80), subtopic: c.subtopic ? String(c.subtopic).slice(0, 80) : null,
      difficulty: diff, stem, options: opts as Row['options'], correct_option: ans as Row['correct_option'],
      exam_explanation: ex, plain_explanation: pl,
      similar_group: c.similar_group ? String(c.similar_group).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60) : null,
      origin: 'ai', sig: sigOf(stem),
    };
  } catch { return null; }
}

export async function generateAndVerify(
  ask: Ask, cat: Exclude<Cat, 'nonverbal'>, diff: number, n: number, recentStems: string[],
): Promise<{ rows: Row[]; rejected: number }> {
  const topics = pick(TOPICS[cat], 3);
  const avoid = recentStems.length ? `\nDo not repeat or closely imitate these existing questions:\n${recentStems.slice(0, 12).map((s) => '- ' + s.slice(0, 120)).join('\n')}` : '';
  const prompt = `Write ${n} different multiple-choice questions for the category "${cat}", difficulty ${diff} of 5 (${DIFF[diff]}).
Spread them across these topics: ${topics.join('; ')}.${avoid}
Return a JSON array. Each item: {"topic": string, "subtopic": string, "stem": string, "options": {"A": string, "B": string, "C": string, "D": string}, "correct_option": "A"|"B"|"C"|"D", "exam_explanation": string, "plain_explanation": string, "similar_group": string}`;

  const raw = await ask(prompt, { system: SYSTEM, think: false });
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.questions) ? raw.questions : [];
  const cands = list.map((c) => cleanCandidate(c, cat, diff)).filter((x): x is Row => !!x);
  // drop duplicates inside the batch
  const seen = new Set<string>(); const uniq = cands.filter((c) => (seen.has(c.sig) ? false : (seen.add(c.sig), true)));
  let rejected = list.length - uniq.length;
  if (!uniq.length) return { rows: [], rejected };

  // Blind check: reshuffle options, hide the key, ask a fresh call to solve each one.
  const shuffled = uniq.map((q, i) => {
    const order = shuffle(['A', 'B', 'C', 'D'] as const);
    const opts: Record<string, string> = {};
    order.forEach((orig, k) => { opts['ABCD'[k]] = q.options[orig]; });
    return { i, stem: q.stem, options: opts, correctText: q.options[q.correct_option] };
  });
  const vprompt = `Solve each question yourself, carefully, step by step in your head. Do not assume any answer key.
For each one return the letter of the single correct option, or "NONE" if no option is correct, or "MANY" if more than one option could be considered correct or the question is ambiguous.
Questions:
${JSON.stringify(shuffled.map(({ i, stem, options }) => ({ id: i, stem, options })))}
Return a JSON array: [{"id": number, "answer": "A"|"B"|"C"|"D"|"NONE"|"MANY"}]`;
  const vr = await ask(vprompt, {
    system: 'You are a strict examiner who checks multiple-choice questions for errors. Be careful with arithmetic, spelling, and facts.',
    think: true, provider: verifyProvider(),
  });
  const answers = new Map<number, string>();
  for (const a of Array.isArray(vr) ? vr : []) answers.set(Number(a?.id), String(a?.answer ?? '').trim().toUpperCase());

  const rows: Row[] = [];
  for (const s of shuffled) {
    const picked = answers.get(s.i);
    const ok = picked && ['A', 'B', 'C', 'D'].includes(picked) && norm(s.options[picked]) === norm(s.correctText);
    if (ok) rows.push(uniq[s.i]); else rejected++;
  }
  return { rows, rejected };
}
