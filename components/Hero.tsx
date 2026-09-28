'use client';
import { useEffect, useState } from 'react';
const QUOTES = [
  'Bismillah. Begin, and let Allah put barakah in your effort.',
  'InshaAllah, every page you study today is a step toward the uniform.',
  'Tawakkul on Allah, and then work with all your heart.',
  'Small steps every day, inshaAllah, become big victories.',
  'Alhamdulillah for another day to grow stronger, Captain.',
  'Your future self is watching. Make her proud, inshaAllah.',
  'Ameen to every dua, and yes to every early morning.',
];
export default function Hero({ title, sub }: { title: string; sub?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % QUOTES.length), 6000); return () => clearInterval(t); }, []);
  return (
    <div className="hero">
      <div className="moon">🌙</div>
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
      <p className="quote" key={i}>{QUOTES[i]}</p>
      <svg viewBox="0 0 800 110" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 110V60l90-35 80 30 110-45 120 50 100-30 130 40 100-25 70 20v45z" fill="#10264f" opacity=".75" />
        <path d="M0 110V85l110-25 90 20 130-30 110 25 140-20 120 22 100-15v48z" fill="#0a1633" />
      </svg>
    </div>
  );
}
