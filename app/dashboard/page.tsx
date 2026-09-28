'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { sb, CAT, ISSB_MSG } from '@/lib/supabase';

const LABEL: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', submitted: 'Completed', timed_out: 'Completed' };

export default function Dashboard() {
  const r = useRouter();
  const [role, setRole] = useState(''); const [st, setSt] = useState<any>(null); const [streak, setStreak] = useState(0);
  const [rows, setRows] = useState<any[]>([]); const [bank, setBank] = useState<any>(null); const [msg, setMsg] = useState(''); const [issb, setIssb] = useState(false);

  async function load() {
    const { data: { user } } = await sb.auth.getUser();
    const { data: p } = await sb.from('profiles').select('role').eq('id', user!.id).single();
    setRole(p?.role);
    setSt((await sb.rpc('today_status')).data); setStreak((await sb.rpc('current_streak')).data ?? 0);
    if (p?.role === 'admin') {
      setBank((await sb.rpc('bank_stats')).data);
      setRows((await sb.from('attempts').select('id,category,date_local,status,score,total,started_at').order('started_at', { ascending: false }).limit(30)).data ?? []);
    }
  }
  useEffect(() => { load(); }, []);

  async function open(c: string, s: any) {
    if (s.attempt_id) return r.push(`/test/${s.attempt_id}`);
    if (role !== 'candidate') return;
    if (!confirm(`Start ${CAT[c]}? The timer starts immediately, cannot be paused, and only one attempt is allowed today.`)) return;
    const { data, error } = await sb.rpc('start_attempt', { p_category: c });
    if (error) setMsg(/question bank too small/i.test(error.message) ? 'Questions for this section are still being prepared. Please try again in a few minutes.' : error.message); else r.push(`/test/${data}`);
  }
  async function remind() { const { error } = await sb.rpc('admin_send_reminder'); setMsg(error ? error.message : 'Reminder queued for delivery.'); }
  async function reset(id: string) {
    const reason = prompt('Reason for resetting this attempt (required):'); if (!reason) return;
    const { error } = await sb.rpc('admin_reset_attempt', { p_attempt: id, p_reason: reason }); setMsg(error ? error.message : 'Attempt reset.'); load();
  }
  if (!st) return <Shell><p className="muted">Loading...</p></Shell>;
  const admin = role === 'admin';
  return (
    <Shell>
      <h1>{admin ? 'Administrator Dashboard' : 'Daily Practice'}</h1>
      <p className="muted">{st.date} (Pakistan time) &nbsp;|&nbsp; Completed today: <b>{st.done_count}/4</b> &nbsp;|&nbsp; Current streak: <b>{streak} day{streak === 1 ? '' : 's'}</b></p>
      {msg && <div className="note">{msg}</div>}
      {!admin && <div className="note">Your administrator can see your scores, timing, answers and mistakes.</div>}
      <div className="grid">
        {Object.keys(CAT).map((c) => {
          const s = st.slots[c]; const done = s.status === 'submitted' || s.status === 'timed_out';
          return (
            <div className="card" key={c}>
              <h3>{CAT[c]}</h3>
              <span className={`pill ${done ? 'done' : ''}`}>{LABEL[s.status]}</span>
              {done && <p>Score: <b>{s.score}/{s.total}</b></p>}
              <p><button onClick={() => open(c, s)} disabled={admin && !s.attempt_id}>
                {admin ? 'View attempt' : s.status === 'not_started' ? 'Start test' : s.status === 'in_progress' ? 'Resume' : 'View result'}
              </button></p>
            </div>
          );
        })}
      </div>
      <p>
        <Link className="btn sec" href="/mistakes">{admin ? 'Candidate mistakes' : 'Review mistakes'}</Link>{' '}
        {!admin && <button className="sec" onClick={() => setIssb(true)}>ISSB Preparation</button>}
        {admin && <button onClick={remind}>Send reminder</button>}
      </p>
      {issb && <div className="note"><b>{ISSB_MSG}</b></div>}
      {admin && bank && (
        <div className="card">
          <h3>Question bank</h3>
          <p className="muted">Unseen = questions she has not met yet. The generator keeps this stocked automatically.</p>
          <table><thead><tr><th>Category</th><th>Published</th><th>Unseen</th></tr></thead><tbody>
            {Object.keys(CAT).map((c) => (<tr key={c}><td>{CAT[c]}</td><td>{bank.stock?.[c]?.published ?? 0}</td><td>{bank.stock?.[c]?.unseen ?? 0}</td></tr>))}
          </tbody></table>
          <p className="muted">Last generator run: {bank.last_run ? new Date(bank.last_run).toLocaleString() : 'never'}{bank.last_error ? ` | last error: ${bank.last_error}` : ''}</p>
        </div>
      )}
      {admin && (
        <div className="card">
          <h3>Recent attempts</h3>
          <table><thead><tr><th>Date</th><th>Category</th><th>Status</th><th>Score</th><th></th></tr></thead><tbody>
            {rows.map((a) => (
              <tr key={a.id}><td>{a.date_local}</td><td>{CAT[a.category]}</td><td>{a.status}</td>
                <td>{a.score ?? '-'}/{a.total}</td>
                <td><Link href={`/test/${a.id}`}>Open</Link>{a.status !== 'reset' && <> &nbsp;<a href="#" onClick={(e) => { e.preventDefault(); reset(a.id); }}>Reset</a></>}</td></tr>
            ))}
          </tbody></table>
        </div>
      )}
    </Shell>
  );
}
