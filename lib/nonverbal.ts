// Non-verbal "which figure comes next?" puzzles drawn by code. The answer is computed from the rule,
// so it is always correct (no AI involved). Two families:
//   A) a polygon whose turning / sides / shading / dots change by fixed rules
//   B) a filled cell moving around a 3x3 grid (plus optional alternating centre cell)

export type NVPuzzle = {
  topic: string; subtopic: string; difficulty: number; stem: string;
  stemSvg: string; optionSvgs: string[]; correctIndex: number;   // index into optionSvgs (0..3)
  exam: string; plain: string; group: string; sig: string;
};

const rnd = (n: number) => Math.floor(Math.random() * n);
const oneOf = <T,>(a: T[]): T => a[rnd(a.length)];
const shuffle = <T,>(a: T[]): T[] => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = rnd(i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const mod = (a: number, m: number) => ((a % m) + m) % m;

// ---------- drawing ----------
type Fig = { sides: number; angle: number; fill: boolean; dots: number };
const INK = '#1f2937', PAPER = '#ffffff';

function polyFig(f: Fig): string {
  const cx = 50, cy = 42, R = 30;
  const pts = Array.from({ length: f.sides }, (_, k) => {
    const t = ((f.angle + (k * 360) / f.sides) * Math.PI) / 180;
    return `${(cx + R * Math.sin(t)).toFixed(1)},${(cy - R * Math.cos(t)).toFixed(1)}`;
  }).join(' ');
  const t = (f.angle * Math.PI) / 180;
  const mx = cx + 0.5 * R * Math.sin(t), my = cy - 0.5 * R * Math.cos(t);
  const dots = Array.from({ length: f.dots }, (_, k) =>
    `<circle cx="${50 + (k - (f.dots - 1) / 2) * 13}" cy="88" r="4.5" fill="${INK}"/>`).join('');
  return `<polygon points="${pts}" fill="${f.fill ? INK : PAPER}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
         `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="5.5" fill="${f.fill ? PAPER : INK}"/>${dots}`;
}

const RING: [number, number][] = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0], [1, 0]]; // clockwise
type Cell = { p: number; c: boolean };
function gridFig(g: Cell): string {
  const S = 24, X = 14, Y = 14;
  let out = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const [pr, pc] = RING[g.p];
    const on = (r === pr && c === pc) || (r === 1 && c === 1 && g.c);
    out += `<rect x="${X + c * S}" y="${Y + r * S}" width="${S}" height="${S}" fill="${on ? INK : PAPER}" stroke="${INK}" stroke-width="2"/>`;
  }
  return out;
}

const frame = `<rect x="1.5" y="1.5" width="97" height="97" rx="8" fill="${PAPER}" stroke="#9ca3af" stroke-width="2"/>`;
const svgWrap = (w: number, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 100" width="${w}" height="100">${inner}</svg>`;
const panel = (x: number, body: string) => `<g transform="translate(${x},0)">${frame}${body}</g>`;
const question = `<text x="50" y="68" font-size="52" font-family="Arial,sans-serif" font-weight="700" text-anchor="middle" fill="#9ca3af">?</text>`;

function assemble<T>(seq: T[], correct: T, distractors: T[], draw: (x: T) => string) {
  const stemSvg = svgWrap(436, seq.map((f, i) => panel(i * 112, draw(f))).join('') + panel(3 * 112, question));
  const opts = shuffle([correct, ...distractors]);
  return { stemSvg, optionSvgs: opts.map((o) => svgWrap(100, panel(0, draw(o)))), correctIndex: opts.indexOf(correct) };
}

// ---------- family A: attribute series ----------
type Rules = {
  angle?: { a0: number; step: number }; sides?: { s0: number }; fill?: { f0: boolean }; dots?: { d0: number; k: number };
  cAngle: number; cSides: number; cFill: boolean; cDots: number;
};
const figAt = (r: Rules, i: number): Fig => ({
  angle: mod(r.angle ? r.angle.a0 + i * r.angle.step : r.cAngle, 360),
  sides: r.sides ? r.sides.s0 + i : r.cSides,
  fill: r.fill ? (i % 2 === 0 ? r.fill.f0 : !r.fill.f0) : r.cFill,
  dots: r.dots ? r.dots.d0 + i * r.dots.k : r.cDots,
});
const figSig = (f: Fig) => `${f.sides}|${f.angle}|${f.fill}|${f.dots}`;

function attributePuzzle(diff: number): NVPuzzle {
  const all = ['angle', 'sides', 'fill', 'dots'] as const;
  const count = diff <= 2 ? 1 : diff <= 4 ? 2 : 3;
  let active = shuffle([...all]).slice(0, count);
  if (diff === 1 && active[0] === 'fill') active = ['angle'];              // shading alone is too trivial
  if (diff >= 4 && !active.includes('angle')) active[0] = 'angle';        // hard ones always include turning
  const steps = diff <= 1 ? [90, -90] : diff === 2 ? [45, -45, 90, -90] : [45, -45, 90, -90, 135, -135];
  const dotChoice = oneOf([[0, 1], [1, 1], [2, 1], [3, 1], [0, 2]]);
  const r: Rules = {
    cAngle: oneOf([0, 45, 90, 180, 270]), cSides: oneOf([3, 4, 5, 6]), cFill: rnd(2) === 0, cDots: oneOf([0, 0, 2]),
  };
  if (active.includes('angle')) r.angle = { a0: oneOf([0, 45, 90, 135, 180, 225, 270, 315]), step: oneOf(steps) };
  if (active.includes('sides')) r.sides = { s0: oneOf([3, 4, 5]) };
  if (active.includes('fill')) r.fill = { f0: rnd(2) === 0 };
  if (active.includes('dots')) r.dots = { d0: dotChoice[0], k: dotChoice[1] };

  const seq = [0, 1, 2].map((i) => figAt(r, i));
  const right = figAt(r, 3);

  // wrong answers: change one feature of the right answer (features that follow a rule first)
  const bad: Fig[] = [];
  const push = (f: Fig) => { if (f.sides >= 3 && f.sides <= 8 && f.dots >= 0 && f.dots <= 6) bad.push({ ...f, angle: mod(f.angle, 360) }); };
  const variants = (a: string): Fig[] => {
    if (a === 'angle') { const s = r.angle?.step ?? 90; return [{ ...right, angle: right.angle + s }, { ...right, angle: right.angle - s }, { ...right, angle: right.angle + 90 }, { ...right, angle: right.angle + 180 }, seq[2]]; }
    if (a === 'sides') return [{ ...right, sides: right.sides + 1 }, { ...right, sides: right.sides - 1 }];
    if (a === 'fill') return [{ ...right, fill: !right.fill }];
    return [{ ...right, dots: right.dots + 1 }, { ...right, dots: right.dots - 1 }, { ...right, dots: right.dots + 2 }];
  };
  for (const a of active) shuffle(variants(a)).forEach(push);
  for (const a of shuffle(all.filter((x) => !active.includes(x)))) shuffle(variants(a)).forEach(push);
  // also mix two changes so options are not all single-feature tweaks
  if (count >= 2) push({ ...right, fill: !right.fill, angle: right.angle + 90 });
  const seen = new Set([figSig(right)]);
  const chosen: Fig[] = [];
  for (const b of bad) { const s = figSig(b); if (!seen.has(s)) { seen.add(s); chosen.push(b); } if (chosen.length === 3) break; }
  while (chosen.length < 3) { const b = { ...right, sides: 3 + rnd(6), dots: rnd(5), angle: oneOf([0, 45, 90, 135, 180, 225, 270, 315]) }; const s = figSig(b); if (!seen.has(s)) { seen.add(s); chosen.push(b); } }

  const built = assemble(seq, right, chosen, polyFig);
  const parts: string[] = [], plainBits: string[] = [];
  if (r.angle) { const d = Math.abs(r.angle.step), dir = r.angle.step > 0 ? 'clockwise' : 'anticlockwise';
    parts.push(`the small dot inside the shape turns ${d} degrees ${dir} each step`);
    plainBits.push(`turning: if the dot moves ${d === 90 ? 'a quarter turn' : d + ' degrees'} ${dir} each time, do that same move once more`); }
  if (r.sides) { parts.push(`the number of sides goes up by 1 each step (${seq.map((s) => s.sides).join(', ')}, then ${right.sides})`);
    plainBits.push(`sides: count the corners in each picture (${seq.map((s) => s.sides).join(', ')}); the next has ${right.sides}`); }
  if (r.fill) { parts.push('the shading flips between dark and white every step');
    plainBits.push(`shading: the pictures go ${seq.map((s) => (s.fill ? 'dark' : 'white')).join(', ')}, so the next is ${right.fill ? 'dark' : 'white'}`); }
  if (r.dots) { parts.push(`the dots at the bottom go up by ${r.dots.k} each step (${seq.map((s) => s.dots).join(', ')}, then ${right.dots})`);
    plainBits.push(`dots: ${seq.map((s) => s.dots).join(', ')} then ${right.dots}`); }
  const sig = 'A|' + JSON.stringify(r);
  return {
    topic: 'Figure Series', subtopic: 'Changing features', difficulty: diff, stem: 'Which figure comes next in the series?',
    ...built,
    exam: `Check one feature at a time: ${parts.join('; ')}. Trap: wrong options usually get most features right and one wrong, so check every feature before choosing.`,
    plain: `Each picture changes in a fixed way. Find what changes and continue it once more. ${plainBits.join('. ')}. Pick the picture that matches all of these together.`,
    group: 'nv-attributes', sig,
  };
}

// ---------- family B: moving cell ----------
function cellPuzzle(diff: number): NVPuzzle {
  const step = diff <= 1 ? 1 : diff === 2 ? oneOf([1, 2]) : oneOf([2, 3]);
  const dir = oneOf([1, -1]);
  const centre = diff >= 4;
  const p0 = rnd(8), c0 = rnd(2) === 0;
  const at = (i: number): Cell => ({ p: mod(p0 + dir * step * i, 8), c: centre ? (i % 2 === 0 ? c0 : !c0) : false });
  const seq = [0, 1, 2].map(at), right = at(3);
  const sg = (c: Cell) => `${c.p}|${c.c}`;
  const bad: Cell[] = [
    { ...right, p: mod(right.p + dir * step, 8) }, { ...right, p: mod(right.p - dir * step, 8) },
    seq[2], { ...right, p: mod(right.p + 1, 8) }, { ...right, p: mod(right.p - 1, 8) }, { ...right, p: mod(right.p + 2, 8) },
    { ...right, p: mod(right.p + 4, 8) },
  ];
  if (centre) bad.unshift({ ...right, c: !right.c });
  const seen = new Set([sg(right)]); const chosen: Cell[] = [];
  for (const b of centre ? bad : shuffle(bad)) { if (!seen.has(sg(b))) { seen.add(sg(b)); chosen.push(b); } if (chosen.length === 3) break; }
  const built = assemble(seq, right, chosen, gridFig);
  const where = dir > 0 ? 'clockwise' : 'anticlockwise';
  return {
    topic: 'Figure Series', subtopic: 'Moving shapes', difficulty: diff, stem: 'Which figure comes next in the series?',
    ...built,
    exam: `Follow the dark square around the outer ring of the grid: it moves ${step} ${step === 1 ? 'cell' : 'cells'} ${where} each step.${centre ? ' The centre square switches between dark and white every step.' : ''} Trap: check the direction and count of moves before looking at the options.`,
    plain: `Only the dark square moves. Count how many cells it jumps between the first two pictures (${step}), check the direction (${where}), and make the same jump one more time.${centre ? ' Also watch the centre square: it flips colour each time.' : ''}`,
    group: 'nv-moving-cell', sig: `B|${p0}|${dir}|${step}|${centre}|${c0}`,
  };
}

export function makeNonverbal(diff: number): NVPuzzle {
  return diff <= 4 && Math.random() < 0.35 ? cellPuzzle(diff) : attributePuzzle(diff);
}
