const statusColor = {
  pending: 'bg-white/10 text-white/60 border-white/10',
  pass: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  fail: 'bg-rose-500/15 text-rose-300 border-rose-400/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  complete: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
};

const prettyStatus = {
  pending: 'Pending',
  pass: 'Pass',
  fail: 'Failed',
  warning: 'Warning',
  complete: 'Complete'
};

const ChecklistSidebar = ({ items }) => {
  return (
    <aside className="flex h-full w-full flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-lg">
      <header>
        <h3 className="text-lg font-semibold text-white">Checklist</h3>
        <p className="text-xs text-white/60">Statuses update as the AI evaluates each response.</p>
      </header>
      <ul className="flex flex-1 flex-col gap-4 overflow-y-auto pr-1 text-sm">
        {items.map((item) => (
          <li key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-white/90">{item.question}</p>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                  statusColor[item.status] ?? statusColor.pending
                }`}
              >
                {prettyStatus[item.status] ?? prettyStatus.pending}
              </span>
            </div>
            {item.recommendation ? (
              <p className="mt-3 rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs text-white/70">
                {item.recommendation}
              </p>
            ) : (
              <p className="mt-3 text-xs text-white/50">Awaiting review…</p>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
};

export default ChecklistSidebar;
