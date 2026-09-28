'use client';
import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';
export default function Img({ p }: { p?: string | null }) {
  const [u, setU] = useState('');
  useEffect(() => { if (p) sb.storage.from('question-images').createSignedUrl(p, 3600).then((r) => setU(r.data?.signedUrl ?? '')); }, [p]);
  return u ? <img src={u} alt="" className="qimg" /> : null;
}
