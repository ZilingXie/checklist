import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  AGENT_JOIN_ENDPOINT,
  buildAgentJoinRequest,
  clearAgentSessionDetails,
  persistAgentSessionDetails,
  requestAgentJoin,
  resolveAgentIdentifiers
} from '../utils/agentSession.js';

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

  const sendAgentJoinRequest = async () => {
    if (!AGENT_JOIN_ENDPOINT) {
      console.warn('Missing agent controller endpoint. Skipping agent join request.');
      return;
    }

    const payload = buildAgentJoinRequest();
    if (!payload) {
      console.warn('Unable to build agent join request payload. Skipping agent join request.');
      return;
    }

    clearAgentSessionDetails();

    const attemptJoin = async ({ allowConflictRetry = true } = {}) => {
      const result = await requestAgentJoin(payload);

      if (!result.ok) {
        if (result.status === 409) {
          const identifiers = resolveAgentIdentifiers(result.parsedBody);

          if (identifiers?.agentId) {
            persistAgentSessionDetails({
              agentId: identifiers.agentId,
              projectId: identifiers.projectId,
              leaveUrl: identifiers.leaveUrl,
              recordedAt: Date.now()
            });
            return true;
          } else {
            console.warn(
              'Agent controller join conflict response did not include an agent identifier.'
            );
          }

          if (allowConflictRetry) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            return attemptJoin({ allowConflictRetry: false });
          }
        }

        if (result.error) {
          console.error('Failed to invoke agent controller join request', result.error);
        } else if (result.reason === 'missing_configuration') {
          console.error('Agent controller join failed: configuration is missing.');
        } else if (result.reason === 'missing_payload') {
          console.error('Agent controller join failed: payload could not be constructed.');
        } else if (result.reason === 'fetch_unavailable') {
          console.error('Agent controller join failed: Fetch API unavailable in this environment.');
        } else {
          console.error('Agent controller join request failed', {
            status: result.status,
            statusText: result.statusText,
            body: result.body
          });
        }
        return false;
      }

      if (result.parsedBody === undefined && result.body) {
        console.warn('Agora agent join response returned non-JSON content.');
      }

      if (!result.sessionDetails) {
        console.warn('Agora agent join response missing agent identifier. Leave request will be skipped.');
      }

      return true;
    };

    await attemptJoin();
  };

  const handleJoinCallClick = () => {
    void sendAgentJoinRequest();
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-925 via-slate-900 to-brand-700">
      <div className="absolute inset-0 opacity-40">
        <div className="absolute -left-24 top-12 h-72 w-72 rounded-full bg-brand-500 blur-3xl" />
        <div className="absolute -right-10 bottom-10 h-80 w-80 rounded-full bg-emerald-400 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 text-center">
        <span className="mb-6 rounded-full bg-white/10 px-4 py-1 text-sm font-medium uppercase tracking-[0.3em] text-white/80">
          Agora Health Check
        </span>
        <h1 className="text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
          Agora Best-Practice Assessment
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-white/80 sm:text-xl">
          Run a guided health check to confirm your Agora implementation follows best practices and
          delivers a reliable real-time experience for your customers.
        </p>
        <div className="mt-10 flex gap-4">
          <Link
            to="/call"
            className="rounded-full bg-white px-8 py-3 text-base font-semibold text-slate-925 shadow-lg shadow-brand-700/40 transition hover:translate-y-0.5 hover:bg-brand-500 hover:text-white"
            onClick={handleJoinCallClick}
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
            <dt className="text-lg font-semibold text-white">Guided Best-Practice Review</dt>
            <dd className="mt-2 text-sm text-white/70">
              An Agora-focused assistant walks through critical usage patterns to confirm your
              deployment meets recommended standards.
            </dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <dt className="text-lg font-semibold text-white">Real-Time Compliance Pulse</dt>
            <dd className="mt-2 text-sm text-white/70">
              Instantly see pass, warning, and remediation cues as we benchmark your setup against
              Agora health criteria.
            </dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <dt className="text-lg font-semibold text-white">Voice-Driven Assessment</dt>
            <dd className="mt-2 text-sm text-white/70">
              Describe your environment in natural language while the assistant transcribes and
              cross-checks configurations.
            </dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <dt className="text-lg font-semibold text-white">Instant Optimization Report</dt>
            <dd className="mt-2 text-sm text-white/70">
              Export a health-check summary capturing prioritized fixes and next steps tailored to
              your Agora workloads.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
};

export default LandingPage;
