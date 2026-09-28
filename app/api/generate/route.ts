// GET /api/generate  (Authorization: Bearer $CRON_SECRET)
// Tops up the question bank. Asks the database what is missing (bank_needs), generates that many
// questions, checks them, stores only the verified ones. Safe to call repeatedly; a lock stops overlap.
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { ask } from '@/lib/ai';
import { generateAndVerify, type Cat } from '@/lib/gen';
import { makeNonverbal } from '@/lib/nonverbal';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Need = { cat: Cat; diff: number; want: number; have: number; deficit: number };

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // Quota guard: if the last 8+ AI rounds in the past 30 minutes all produced nothing (without erroring),
  // the model is returning junk or the checker rejects everything. Pause instead of burning free quota.
  const recent = await sb.from('gen_log').select('made').eq('origin', 'ai').is('error', null)
    .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString());
  if ((recent.data?.length ?? 0) >= 8 && recent.data!.every((r: any) => r.made === 0))
    return Response.json({ paused: true, done: false, note: 'AI rounds produced nothing recently; pausing up to 30 minutes.' });

  const lock = await sb.rpc('gen_acquire', { p_seconds: 100 });
  if (lock.error) return Response.json({ error: lock.error.message }, { status: 500 });
  if (!lock.data) return Response.json({ busy: true, done: false });

  const started = Date.now();
  let made = 0, rejected = 0, remaining = 0, done = false, rateLimited = false, empty = 0;
  const errors: string[] = [];

  async function runNeed(n: Need) {
    let m = 0, rej = 0, err: string | null = null, origin = n.cat === 'nonverbal' ? 'code' : 'ai';
    try {
      let rows: any[] = [];
      if (n.cat === 'nonverbal') {
        for (let i = 0; i < Math.min(n.deficit, 12); i++) {
          const p = makeNonverbal(n.diff);
          const up = async (svg: string) => {
            const path = `nv/${randomUUID()}.svg`;
            const r = await sb.storage.from('question-images').upload(path, Buffer.from(svg), { contentType: 'image/svg+xml' });
            if (r.error) throw new Error('image upload: ' + r.error.message);
            return path;
          };
          const stemPath = await up(p.stemSvg);
          const optPaths = await Promise.all(p.optionSvgs.map(up));
          rows.push({
            category: 'nonverbal', topic: p.topic, subtopic: p.subtopic, difficulty: p.difficulty, stem: p.stem, stem_image: stemPath,
            options: { A: '', B: '', C: '', D: '' }, option_images: { A: optPaths[0], B: optPaths[1], C: optPaths[2], D: optPaths[3] },
            correct_option: 'ABCD'[p.correctIndex], exam_explanation: p.exam, plain_explanation: p.plain,
            similar_group: p.group, origin: 'code', sig: p.sig,
          });
        }
      } else {
        const recent = await sb.from('questions').select('stem').eq('category', n.cat).order('id', { ascending: false }).limit(12);
        const g = await generateAndVerify(ask, n.cat as Exclude<Cat, 'nonverbal'>, n.diff, Math.max(5, Math.min(n.deficit, 8)),
          (recent.data ?? []).map((r: any) => r.stem));
        rows = g.rows; rej = g.rejected;
      }
      if (rows.length) {
        const s = await sb.rpc('add_generated_questions', { p_rows: rows });
        if (s.error) throw new Error(s.error.message);
        m = s.data as number;
      }
    } catch (e: any) {
      err = String(e?.message ?? e).slice(0, 400);
    }
    await sb.rpc('gen_note', { p_category: n.cat, p_diff: n.diff, p_origin: origin, p_made: m, p_rejected: rej, p_error: err });
    return { m, rej, err };
  }

  try {
    for (let iter = 0; iter < 6; iter++) {
      const needs = await sb.rpc('bank_needs');
      if (needs.error) { errors.push(needs.error.message); break; }
      const list = (needs.data ?? []) as Need[];
      remaining = list.reduce((a, x) => a + x.deficit, 0);
      if (!list.length) { done = true; break; }
      if (Date.now() - started > 20_000) break;                 // not enough time left for another round
      // One category/difficulty at a time: the free AI tier allows only a few requests per minute.
      const r = await runNeed(list[0]);
      made += r.m; rejected += r.rej;
      empty = r.m === 0 ? empty + 1 : 0;
      if (!r.err && empty >= 2) break;                           // two empty rounds in a row: give the next run a fresh try
      if (r.err) {
        if (/\b429\b|RESOURCE_EXHAUSTED|rate/i.test(r.err)) { rateLimited = true; break; }   // just slow down, not a failure
        errors.push(r.err);
        break;                                                   // bad key, bad model name...: stop and report
      }
    }
  } finally {
    await sb.rpc('gen_release');
  }

  const failed = errors.length > 0 && made === 0;
  return Response.json({ made, rejected, remaining, done, rateLimited, errors: errors.slice(0, 3) }, { status: failed ? 500 : 200 });
}
