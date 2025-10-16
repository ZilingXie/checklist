import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const LandingPage = () => {
  const overviewRef = useRef(null);
  const highlightTimeoutRef = useRef(null);
  const [isOverviewHighlighted, setIsOverviewHighlighted] = useState(false);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const handleLearnMore = (event) => {
    event.preventDefault();

    if (!overviewRef.current) return;

    overviewRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });

    setIsOverviewHighlighted(true);
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setIsOverviewHighlighted(false);
    }, 1600);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-925 via-slate-900 to-brand-700">
      <div className="absolute inset-0 opacity-40">
        <div className="absolute -left-24 top-12 h-72 w-72 rounded-full bg-brand-500 blur-3xl" />
        <div className="absolute -right-10 bottom-10 h-80 w-80 rounded-full bg-emerald-400 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 text-center">
        <span className="mb-6 rounded-full bg-white/10 px-4 py-1 text-sm font-medium uppercase tracking-[0.3em] text-white/80">
          Smart Compliance
        </span>
        <h1 className="text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
          AI-Powered Checklist Review
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-white/80 sm:text-xl">
          Experience the future of compliance. Conduct your checklist reviews through a natural,
          voice-driven conversation with an AI assistant that evaluates and updates in real time.
        </p>
        <div className="mt-10 flex gap-4">
          <Link
            to="/call"
            className="rounded-full bg-white px-8 py-3 text-base font-semibold text-slate-925 shadow-lg shadow-brand-700/40 transition hover:translate-y-0.5 hover:bg-brand-500 hover:text-white"
          >
            Join Call
          </Link>
          <a
            href="#overview"
            onClick={handleLearnMore}
            className="rounded-full border border-white/40 px-8 py-3 text-base font-semibold text-white/80 transition hover:bg-white/10"
          >
            Learn More
          </a>
        </div>
      </main>

      <section
        id="overview"
        ref={overviewRef}
        className={`relative mx-auto mb-16 mt-16 max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-10 backdrop-blur-xl transition-all duration-500 lg:mb-24 ${
          isOverviewHighlighted ? 'ring-4 ring-white/20 shadow-2xl shadow-brand-700/40 animate-pulse' : ''
        }`}
      >
        <h2 className="text-2xl font-semibold text-white">What to Expect</h2>
        <dl className="mt-6 grid gap-6 text-left sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <dt className="text-lg font-semibold text-white">Conversational AI Guidance</dt>
            <dd className="mt-2 text-sm text-white/70">
              The assistant walks through each checklist item, captures responses, and evaluates them
              instantly.
            </dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <dt className="text-lg font-semibold text-white">Real-Time Insights</dt>
            <dd className="mt-2 text-sm text-white/70">
              Watch the checklist update live with pass, fail, and warning indicators plus tailored
              recommendations.
            </dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <dt className="text-lg font-semibold text-white">Voice-First Workflow</dt>
            <dd className="mt-2 text-sm text-white/70">
              Speak naturally while the app transcribes, analyzes, and responds using the Web Speech
              API.
            </dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <dt className="text-lg font-semibold text-white">Export Ready</dt>
            <dd className="mt-2 text-sm text-white/70">
              Download a completed checklist the moment your review wraps up, with every insight in
              place.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
};

export default LandingPage;
