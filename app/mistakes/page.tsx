'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Shell from '@/components/Shell';
import Img from '@/components/Img';
import { sb, CAT } from '@/lib/supabase';

export default function Mistakes() {
  const [m, setM] = useState<any[] | null>(null); const [sim, setSim] = useState<Record<number, any>>({});
  async function load() { setM((await sb.rpc('get_mistakes')).data ?? []); }
  useEffect(() => { load(); }, []);
  async function similar(qid: number) {
    const { data } = await sb.rpc('similar_question', { p_question: qid });
    if (!data) return alert('No similar question is available yet.'); setSim({ ...sim, [qid]: { q: data } });
  }
  async function answer(qid: number, key: string) {
    const { data } = await sb.rpc('check_similar', { p_question: sim[qid].q.question_id, p_option: key }); setSim({ ...sim, [qid]: { ...sim[qid], res: data, key } });
  }
  async function reviewed(qid: number) { await sb.rpc('set_mistake_status', { p_question: qid, p_status: 'reviewed' }); load(); }
  if (!m) return <Shell><p className="muted">Loading...</p></Shell>;
  return (
    <Shell>
      <h1>Mistake Review</h1>
      {m.length === 0 && <div className="card">No mistakes recorded yet.</div>}
      {m.map((x) => {
        const s = sim[x.question_id];
        return (
          <div className="card" key={x.question_id}>
            <span className="pill">{CAT[x.category]} | {x.topic}</span> <span className="pill">Missed {x.wrong_count}x</span> <span className="pill">{x.review_status}</span>
            <p>{x.stem}</p><Img p={x.stem_image} />
            {['A', 'B', 'C', 'D'].map((k) => (
              <div key={k} className={`opt ${k === x.correct_option ? 'ok' : k === x.selected ? 'no' : ''}`} style={{ padding: '10px 16px', borderRadius: 8 }}>
                {k}. {x.options[k]}{k === x.selected && <b> (Your answer)</b>}{k === x.correct_option && <b> (Correct)</b>}
              </div>
            ))}
            {!x.selected && <p className="muted">You did not answer this question.</p>}
            <div className="exp"><b>Exam method:</b> {x.exam_explanation}</div>
            <div className="exp"><b>In plain words:</b> {x.plain_explanation}</div>
            <p><button className="sec" onClick={() => similar(x.question_id)}>Try a similar question</button>{' '}
              {x.review_status === 'new' && <button className="sec" onClick={() => reviewed(x.question_id)}>Mark as reviewed</button>}</p>
            {s && (<div className="card" style={{ background: '#fafbfd' }}>
              <p>{s.q.stem}</p>
              {['A', 'B', 'C', 'D'].map((k) => (
                <button key={k} disabled={!!s.res} className={`opt ${s.res ? (k === s.res.correct_option ? 'ok' : k === s.key ? 'no' : '') : ''}`} onClick={() => answer(x.question_id, k)}>{k}. {s.q.options[k]}</button>))}
              {s.res && (<><p><b>{s.res.correct ? 'Correct.' : 'Not correct.'}</b></p>
                <div className="exp"><b>Exam method:</b> {s.res.exam_explanation}</div>
                <div className="exp"><b>In plain words:</b> {s.res.plain_explanation}</div></>)}
            </div>)}
          </div>
        );
      })}
      <Link className="btn" href="/dashboard">Back to dashboard</Link>
    </Shell>
  );
}
