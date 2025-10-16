const statusStyles = {
  connected: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40',
  speaking: 'bg-brand-500/20 text-brand-200 border-brand-400/40',
  listening: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40',
  idle: 'bg-white/10 text-white/70 border-white/20'
};

const CallStatusBar = ({ statusLabel, tone = 'idle' }) => {
  const toneClass = statusStyles[tone] ?? statusStyles.idle;

  return (
    <header className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-lg">
      <div>
        <p className="text-sm font-medium text-white/60">AI Assistant</p>
        <h2 className="text-lg font-semibold text-white">{statusLabel}</h2>
      </div>
      <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase ${toneClass}`}>
        {tone === 'speaking'
          ? 'AI Speaking'
          : tone === 'listening'
            ? 'Listening'
            : tone === 'connected'
              ? 'Connected'
              : 'Idle'}
      </span>
    </header>
  );
};

export default CallStatusBar;
