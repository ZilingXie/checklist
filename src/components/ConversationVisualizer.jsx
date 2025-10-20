const ConversationVisualizer = ({ tone }) => {
  const toneColor =
    tone === 'speaking'
      ? 'from-brand-500 to-brand-700'
      : tone === 'listening'
        ? 'from-cyan-400 to-cyan-600'
        : tone === 'connecting'
          ? 'from-amber-400 to-amber-600'
          : 'from-slate-700 to-slate-800';

  return (
    <div className="relative flex h-64 items-center justify-center rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-925 to-slate-900 p-8">
      <div
        className={`absolute h-40 w-40 animate-pulse-slow rounded-full bg-gradient-to-br ${toneColor} opacity-40 blur-xl`}
      />
      <div className="relative flex h-36 w-36 items-center justify-center rounded-full bg-white/10 backdrop-blur">
        <div className="h-24 w-24 rounded-full bg-white/20 backdrop-blur-sm" />
      </div>
    </div>
  );
};

export default ConversationVisualizer;
