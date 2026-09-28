const S = [
  { e: '🌄', t: 'Result day', d: 'You open the result. Alhamdulillah. Every early morning paid off, inshaAllah.', g: 'linear-gradient(135deg,#1b5a7a,#e8a94a)' },
  { e: '🎖️', t: 'First dawn at Kakul', d: 'Boots polished, heart steady, dua on your lips. Bismillah.', g: 'linear-gradient(135deg,#14284b,#2b6cb0)' },
  { e: '🇵🇰', t: 'The salute', d: 'Your family stands proud as you wear the uniform. Ameen.', g: 'linear-gradient(135deg,#0b5d3b,#1f9d63)' },
  { e: '🤲', t: 'Tonight\u2019s dua', d: 'Rest well. Tomorrow we do it again, inshaAllah.', g: 'linear-gradient(135deg,#4a2a7a,#8a5cc2)' },
];
export default function Scenes() {
  return (
    <>
      <h3>Your future, inshaAllah</h3>
      <div className="scenes">
        {S.map((s, i) => (
          <div className="scene" key={s.t} style={{ background: s.g, animationDelay: `${i * 0.15}s` }}>
            <span className="e">{s.e}</span><b>{s.t}</b><small>{s.d}</small>
          </div>
        ))}
      </div>
    </>
  );
}
