const ConversationVisualizer = ({ tone, isConnected = false }) => {
  const toneColor = isConnected
    ? 'from-emerald-400 to-emerald-600'
    : tone === 'speaking'
      ? 'from-brand-500 to-brand-700'
      : tone === 'listening'
        ? 'from-cyan-400 to-cyan-600'
        : tone === 'connecting'
          ? 'from-slate-700 to-slate-800'
          : 'from-slate-700 to-slate-800';

  const isAgentSpeaking = isConnected && tone === 'speaking';
  const isAgentIdle = isConnected && !isAgentSpeaking;

  const glowAnimationClass = isAgentSpeaking
    ? 'animate-agent-speaking-core'
    : isAgentIdle
      ? 'animate-agent-idle-core'
      : 'animate-pulse-slow';

  const innerAnimationClass = isAgentSpeaking
    ? 'animate-agent-speaking-core'
    : isAgentIdle
      ? 'animate-agent-idle-core'
      : '';

  const ringAnimationClass = isAgentSpeaking
    ? 'animate-agent-speaking-ring'
    : isAgentIdle
      ? 'animate-agent-idle-ring'
      : '';

  return (
    <div className="relative flex h-64 items-center justify-center rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-925 to-slate-900 p-8">
      {ringAnimationClass ? (
        <div
          className={`absolute h-48 w-48 rounded-full border border-emerald-400/40 ${ringAnimationClass}`}
        />
      ) : null}
      <div
        className={`absolute h-40 w-40 rounded-full bg-gradient-to-br ${toneColor} opacity-40 blur-xl ${glowAnimationClass}`}
      />
      <div className="relative flex h-36 w-36 items-center justify-center rounded-full bg-white/10 backdrop-blur">
        <div
          className={`h-24 w-24 rounded-full backdrop-blur-sm ${
            isConnected ? 'bg-emerald-400/20' : 'bg-white/20'
          } ${innerAnimationClass}`}
        />
      </div>
    </div>
  );
};

export default ConversationVisualizer;
