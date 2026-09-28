// Offline self-test (no keys, no network):  npm run selftest
import { makeNonverbal } from '../lib/nonverbal';
import { cleanCandidate, generateAndVerify, sigOf } from '../lib/gen';
import { parseJSON } from '../lib/ai';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL:', m); } };

// 1) non-verbal: 3000 puzzles
const sigs = new Set<string>(); let dupPuzzles = 0;
for (let i = 0; i < 3000; i++) {
  const d = 1 + (i % 5), p = makeNonverbal(d);
  ok(p.optionSvgs.length === 4, 'four options');
  ok(new Set(p.optionSvgs).size === 4, `options must be visually distinct (diff ${d})`);
  ok(p.correctIndex >= 0 && p.correctIndex < 4, 'correct index valid');
  ok(p.exam !== p.plain && p.exam.length > 30 && p.plain.length > 30, 'explanations differ');
  ok(/^<svg[\s\S]*<\/svg>$/.test(p.stemSvg) && p.optionSvgs.every((s) => s.startsWith('<svg')), 'svg shape');
  ok(!/NaN|undefined/.test(p.stemSvg + p.optionSvgs.join('')), 'no NaN in svg');
  if (sigs.has(p.sig)) dupPuzzles++; sigs.add(p.sig);
}
console.log(`nonverbal: 3000 checked, ${sigs.size} distinct rule-sets, ${dupPuzzles} repeats (DB drops repeats)`);

// 2) cleanCandidate rejects bad questions
const good = { topic: 'T', stem: 'What is 2 + 2 equal to?', options: { A: '3', B: '4', C: '5', D: '6' }, correct_option: 'B', exam_explanation: 'Add the numbers directly.', plain_explanation: 'Two apples plus two apples is four apples.' };
ok(!!cleanCandidate(good, 'verbal', 1), 'good passes');
ok(!cleanCandidate({ ...good, options: { A: '3', B: '3', C: '5', D: '6' } }, 'verbal', 1), 'duplicate options rejected');
ok(!cleanCandidate({ ...good, options: { A: '3', B: '4', C: '5', D: 'All of the above' } }, 'verbal', 1), '"all of the above" rejected');
ok(!cleanCandidate({ ...good, correct_option: 'E' }, 'verbal', 1), 'bad key rejected');
ok(!cleanCandidate({ ...good, plain_explanation: good.exam_explanation }, 'verbal', 1), 'same explanations rejected');
ok(!cleanCandidate({ ...good, stem: 'Look at the figure shown below and answer' }, 'verbal', 1), 'figure reference rejected');

// 3) parseJSON copes with fences/chatter
ok(parseJSON('```json\n[{"a":1}]\n```')[0].a === 1, 'fenced json');
ok(parseJSON('Sure! Here you go: {"x":2} hope it helps').x === 2, 'chatter json');

// 4) full generate+verify flow with a fake AI: 4 questions, checker disagrees on one and finds one ambiguous
(async () => {
  const mk = (n: number, ans: string) => ({ topic: 'Arith', stem: `What is ${n} + ${n} equal to exactly?`, options: { A: `${2 * n}`, B: `${2 * n + 1}`, C: `${2 * n + 2}`, D: `${2 * n + 3}` }, correct_option: ans,
    exam_explanation: `Double ${n} quickly.`, plain_explanation: `${n} plus ${n} means two groups of ${n}.`, similar_group: 'doubling' });
  const qs = [mk(3, 'A'), mk(4, 'A'), mk(5, 'C' /* wrong key */), mk(6, 'A')];
  let call = 0;
  const fake = async (prompt: string) => {
    call++;
    if (call === 1) return qs;
    const items = JSON.parse(prompt.slice(prompt.indexOf('[{"id"'), prompt.indexOf('Return a JSON array')).trim());
    return items.map((it: any) => {
      const n = Number(/What is (\d+)/.exec(it.stem)![1]);
      const right = Object.entries(it.options).find(([, v]) => v === `${2 * n}`)![0];
      return { id: it.id, answer: n === 6 ? 'MANY' : right };
    });
  };
  const r = await generateAndVerify(fake as any, 'verbal', 1, 4, []);
  ok(r.rows.length === 2, `expected 2 accepted, got ${r.rows.length}`);
  ok(r.rejected === 2, `expected 2 rejected, got ${r.rejected}`);
  ok(r.rows.every((x) => x.sig === sigOf(x.stem)), 'sig set');
  console.log(`generate+verify with fake AI: accepted ${r.rows.length}, rejected ${r.rejected}`);
  console.log(fail ? `\n${fail} FAILURES` : '\nALL SELF-TESTS PASSED');
  process.exit(fail ? 1 : 0);
})();
