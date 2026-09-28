'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sb } from '@/lib/supabase';
export default function Shell({ children }: { children: React.ReactNode }) {
  const r = useRouter(); const [ok, setOk] = useState(false);
  useEffect(() => { sb.auth.getSession().then(({ data }) => (data.session ? setOk(true) : r.replace('/'))); }, [r]);
  if (!ok) return null;
  return (<>
    <header>
      <Link href="/dashboard" style={{ color: '#fff', textDecoration: 'none' }}><b>Capt Sitara</b> &nbsp;|&nbsp; Pakistan Army Initial-Test Practice</Link>
      <button className="sec" onClick={async () => { await sb.auth.signOut(); r.replace('/'); }}>Sign out</button>
    </header>
    <main>{children}</main>
  </>);
}
