export const MatrixView = ({ tasks }) => (
  <div className="relative w-full aspect-square bg-[var(--card-bg)] rounded-2xl border border-white/10 mt-4 overflow-hidden">
    <div className="absolute inset-0 flex items-center justify-center opacity-20">
      <div className="w-px h-full bg-white"></div>
      <div className="h-px w-full bg-white"></div>
    </div>
    {tasks.map(t => (
      <div key={t.id} className="absolute w-3 h-3 bg-[var(--accent)] rounded-full animate-pulse" 
           style={{ left: `${50 + (t.importance * 10)}%`, top: `${50 - (t.urgency * 10)}%` }} />
    ))}
  </div>
);