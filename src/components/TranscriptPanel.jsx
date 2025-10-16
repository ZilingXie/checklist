const TranscriptPanel = ({ conversation }) => {
  return (
    <section className="flex flex-col gap-4 overflow-y-auto rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-lg">
      {conversation.length === 0 ? (
        <p className="text-sm text-white/60">Transcript will appear here once the conversation begins.</p>
      ) : (
        conversation.map((entry, index) => (
          <article
            key={`${entry.sender}-${index}`}
            className={`flex ${entry.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg ${
                entry.sender === 'user'
                  ? 'bg-brand-600 text-white/90 shadow-brand-900/40'
                  : 'bg-white/10 text-white/80 border border-white/10'
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
                {entry.sender === 'user' ? 'You' : 'AI'}
              </p>
              <p className="mt-1">{entry.text}</p>
            </div>
          </article>
        ))
      )}
    </section>
  );
};

export default TranscriptPanel;
