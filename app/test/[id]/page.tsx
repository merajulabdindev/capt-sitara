'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Shell from '@/components/Shell';
import Img from '@/components/Img';
import { sb, CAT } from '@/lib/supabase';

const L = 'ABCD';
export default function Test() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<any>(null); const [i, setI] = useState(0); const [left, setLeft] = useState(0);
  const [offset, setOffset] = useState(0); const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await sb.rpc('get_attempt', { p_attempt: id });
    if (data) { setA(data); setOffset(new Date(data.server_now).getTime() - Date.now()); }
  }
  useEffect(() => { load(); }, [id]);
  const live = a?.status === 'in_progress';

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      const l = Math.floor((new Date(a.deadline_at).getTime() - (Date.now() + offset)) / 1000);
      setLeft(l); if (l <= 0) { clearInterval(t); finish(); }
    }, 500);
    return () => clearInterval(t);
  }, [live, offset]);

  async function pick(q: any, key: string) {
    setA({ ...a, questions: a.questions.map((x: any) => (x.position === q.position ? { ...x, selected: key } : x)) });
    await sb.rpc('save_answer', { p_attempt: id, p_position: q.position, p_option: key });
  }
  async function finish() {
    if (busy) return; setBusy(true);
    const { data } = await sb.rpc('submit_attempt', { p_attempt: id }); if (data) setA(data);
  }
  if (!a) return <Shell><p className="muted">Loading...</p></Shell>;
  const qs = a.questions;

  if (!live) {
    return (
      <Shell>
        <h1>{CAT[a.category]}: Result</h1>
        <div className="card">
          <h2>{a.score}/{a.total} &nbsp;({Math.round((100 * a.score) / a.total)}%)</h2>
          <p className="muted">{a.date_local}{a.status === 'timed_out' ? ' | Time expired, saved answers were scored.' : ''}{a.status === 'reset' ? ' | Reset by administrator.' : ''}</p>
        </div>
        {qs.map((q: any) => (
          <div className="card" key={q.position}>
            <b>Q{q.position}.</b> {q.stem} <Img p={q.stem_image} />
            {q.options.map((o: any, k: number) => (
              <div key={o.key} className={`opt ${o.key === q.correct_option ? 'ok' : o.key === q.selected ? 'no' : ''}`} style={{ padding: '10px 16px', borderRadius: 8 }}>
                {L[k]}. {o.text} <Img p={o.image} />
                {o.key === q.selected && <b> (Your answer)</b>}{o.key === q.correct_option && <b> (Correct)</b>}
              </div>
            ))}
            {!q.selected && <p className="muted">Not answered.</p>}
            {!q.is_correct && (<>
              <div className="exp"><b>Exam method:</b> {q.exam_explanation}</div>
              <div className="exp"><b>In plain words:</b> {q.plain_explanation}</div>
            </>)}
          </div>
        ))}
        <Link className="btn" href="/dashboard">Back to dashboard</Link>
      </Shell>
    );
  }

  const q = qs[i]; const mm = String(Math.max(0, Math.floor(left / 60))).padStart(2, '0'); const ss = String(Math.max(0, left % 60)).padStart(2, '0');
  const unanswered = qs.filter((x: any) => !x.selected).length;
  return (
    <Shell>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><b>{CAT[a.category]}</b><br /><span className="muted">Question {i + 1} of {qs.length}</span></div>
        <div className="timer" style={{ color: left < 60 ? 'var(--bad)' : 'var(--navy)' }}>{mm}:{ss}</div>
      </div>
      <div className="card">
        <p style={{ fontSize: 18 }}>{q.stem}</p><Img p={q.stem_image} />
        {q.options.map((o: any, k: number) => (
          <button key={o.key} className={`opt ${q.selected === o.key ? 'sel' : ''}`} onClick={() => pick(q, o.key)}>{L[k]}. {o.text} <Img p={o.image} /></button>
        ))}
        <p><button className="sec" disabled={i === 0} onClick={() => setI(i - 1)}>Previous</button>{' '}
          <button className="sec" disabled={i === qs.length - 1} onClick={() => setI(i + 1)}>Next</button></p>
      </div>
      <div className="nav">{qs.map((x: any, n: number) => (
        <button key={n} className={n === i ? 'cur' : x.selected ? 'ans' : ''} onClick={() => setI(n)}>{n + 1}</button>))}</div>
      <button disabled={busy} onClick={() => { if (confirm(unanswered ? `${unanswered} question(s) unanswered. Submit anyway?` : 'Submit your test?')) finish(); }}>Submit test</button>
    </Shell>
  );
}
