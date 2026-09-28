'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/supabase';
export default function Login() {
  const r = useRouter(); const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState('');
  async function go(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const { error } = await sb.auth.signInWithPassword({ email: `${u.trim().toLowerCase()}@captsitara.app`, password: p });
    if (error) setErr('Invalid username or password.'); else r.replace('/dashboard');
  }
  return (
    <main style={{ maxWidth: 440, paddingTop: 70 }}>
      <div className="card">
        <h1>Capt Sitara</h1>
        <p className="muted">Pakistan Army Initial-Test Daily Practice Platform. Please sign in.</p>
        <form onSubmit={go}>
          <label>Username</label><input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required />
          <label>Password</label><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required />
          {err && <p style={{ color: 'var(--bad)' }}>{err}</p>}
          <button type="submit" style={{ width: '100%' }}>Sign in</button>
        </form>
      </div>
    </main>
  );
}
