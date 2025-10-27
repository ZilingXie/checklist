import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const AGORA_APP_ID = import.meta.env.VITE_AGORA_APP_ID;
const AGORA_CHANNEL = import.meta.env.VITE_AGORA_CHANNEL;
const AGORA_TOKEN = import.meta.env.VITE_AGORA_TEMP_TOKEN ?? '';
const AGORA_AGENT_NAME = import.meta.env.VITE_AGORA_AGENT_NAME ?? 'checklist-agent';
const AGORA_AGENT_RTC_UID = import.meta.env.VITE_AGORA_AGENT_RTC_UID ?? '0';
const AGORA_AGENT_REMOTE_UIDS = import.meta.env.VITE_AGORA_AGENT_REMOTE_UIDS ?? '*';
const AGORA_AGENT_ENABLE_STRING_UID =
  (import.meta.env.VITE_AGORA_AGENT_ENABLE_STRING_UID ?? 'false').toLowerCase() === 'true';
const AGORA_AGENT_IDLE_TIMEOUT = Number.parseInt(
  import.meta.env.VITE_AGORA_AGENT_IDLE_TIMEOUT ?? '',
  10
);
const AGORA_AGENT_ASR_LANGUAGE = import.meta.env.VITE_AGORA_AGENT_ASR_LANGUAGE ?? 'en-US';
const AGENT_CONTROLLER_URL =
  import.meta.env.VITE_AGENT_CONTROLLER_URL ??
  import.meta.env.VITE_AI_AGENT_SERVER_URL ??
  '';
const AGENT_JOIN_ENDPOINT = AGENT_CONTROLLER_URL
  ? `${AGENT_CONTROLLER_URL.replace(/\/$/, '')}/agent/join`
  : '';
const AGENT_CONTROLLER_AUTH_TOKEN =
  import.meta.env.VITE_AGENT_CONTROLLER_AUTH_TOKEN ??
  import.meta.env.VITE_AGENT_CONTROLLER_AUTH_SECRET ??
  '';

const AGORA_AGENT_LAST_JOIN_KEY = 'agora-agent-last-join';

const parseRemoteRtcUids = (value) => {
  if (!value) return ['*'];
  const parsed = value
    .split(',')
    .map((uid) => uid.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : ['*'];
};

const resolveIdleTimeout = () =>
  Number.isFinite(AGORA_AGENT_IDLE_TIMEOUT) ? AGORA_AGENT_IDLE_TIMEOUT : 120;

const extractAgentSessionDetails = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const agentPayload =
    typeof payload.agent === 'object' && payload.agent !== null ? payload.agent : undefined;
  const directAgentId =
    payload.agent_id ?? payload.agentId ?? payload.id ?? agentPayload?.agent_id ?? agentPayload?.id;
  if (!directAgentId) {
    return null;
  }

  const agentId = String(directAgentId);
  const resolvedProjectId =
    payload.project_id ??
    payload.projectId ??
    agentPayload?.project_id ??
    agentPayload?.projectId ??
    AGORA_APP_ID ??
    undefined;

  return {
    agentId,
    projectId: resolvedProjectId ? String(resolvedProjectId) : undefined,
    recordedAt: Date.now()
  };
};

const persistAgentSessionDetails = (details) => {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return;
  }

  const storage = window.sessionStorage;

  if (!details) {
    storage.removeItem(AGORA_AGENT_LAST_JOIN_KEY);
    return;
  }

  try {
    storage.setItem(AGORA_AGENT_LAST_JOIN_KEY, JSON.stringify(details));
  } catch (error) {
    console.warn('Unable to persist Agora agent session details', error);
  }
};

const buildAgentJoinRequest = () => {
  if (!AGORA_CHANNEL) {
    return null;
  }

  return {
    agentName: AGORA_AGENT_NAME,
    channel: AGORA_CHANNEL,
    token: AGORA_TOKEN ?? '',
    agentRtcUid: AGORA_AGENT_RTC_UID,
    remoteRtcUids: parseRemoteRtcUids(AGORA_AGENT_REMOTE_UIDS),
    enableStringUid: AGORA_AGENT_ENABLE_STRING_UID,
    idleTimeout: resolveIdleTimeout(),
    asr: {
      language: AGORA_AGENT_ASR_LANGUAGE
    }
  };
};

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

    if (!AGORA_CHANNEL) {
      console.warn('Missing Agora channel. Skipping agent join request.');
      return;
    }

    if (typeof fetch !== 'function') {
      console.warn('Fetch API unavailable. Skipping agent join request.');
      return;
    }

    const payload = buildAgentJoinRequest();
    if (!payload) {
      console.warn('Unable to build agent join request payload. Skipping agent join request.');
      return;
    }

    persistAgentSessionDetails(null);

    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      if (AGENT_CONTROLLER_AUTH_TOKEN) {
        headers.Authorization = `Bearer ${AGENT_CONTROLLER_AUTH_TOKEN}`;
      }

      const response = await fetch(AGENT_JOIN_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        keepalive: true
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Agent controller join request failed', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        return;
      }

      let parsedBody;
      try {
        const responseClone = response.clone();
        const contentType = responseClone.headers.get('Content-Type') ?? '';
        if (contentType.includes('application/json')) {
          parsedBody = await responseClone.json();
        } else {
          const rawText = await responseClone.text();
          if (rawText) {
            try {
              parsedBody = JSON.parse(rawText);
            } catch {
              console.warn('Agora agent join response returned non-JSON content.');
            }
          }
        }
      } catch (parseError) {
        console.warn('Unable to parse Agora agent join response', parseError);
      }

      const sessionDetails = extractAgentSessionDetails(parsedBody);
      if (sessionDetails) {
        const { agentId, projectId } = sessionDetails;
        if (projectId) {
          sessionDetails.leaveUrl = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${projectId}/agents/${agentId}/leave`;
        } else if (AGORA_APP_ID) {
          sessionDetails.projectId = AGORA_APP_ID;
          sessionDetails.leaveUrl = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${AGORA_APP_ID}/agents/${agentId}/leave`;
        }
        persistAgentSessionDetails(sessionDetails);
      } else {
        console.warn('Agora agent join response missing agent identifier. Leave request will be skipped.');
      }
    } catch (error) {
      console.error('Failed to invoke agent controller join request', error);
    }
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
