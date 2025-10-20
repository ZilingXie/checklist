import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const AGORA_APP_ID = import.meta.env.VITE_AGORA_APP_ID;
const AGORA_CHANNEL = import.meta.env.VITE_AGORA_CHANNEL;
const AGORA_TOKEN = import.meta.env.VITE_AGORA_TEMP_TOKEN ?? '';
const AGORA_AGENT_AUTH = import.meta.env.VITE_AGORA_AGENT_AUTH;
const AGORA_AGENT_JOIN_URL =
  import.meta.env.VITE_AGORA_AGENT_JOIN_URL ||
  (AGORA_APP_ID
    ? `https://api.agora.io/api/conversational-ai-agent/v2/projects/${AGORA_APP_ID}/join`
    : undefined);
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
const AGORA_AGENT_LLM_URL =
  import.meta.env.VITE_AGORA_AGENT_LLM_URL ?? 'https://api.openai.com/v1/chat/completions';
const AGORA_AGENT_LLM_API_KEY = import.meta.env.VITE_AGORA_AGENT_LLM_API_KEY;
const AGORA_AGENT_LLM_MODEL = import.meta.env.VITE_AGORA_AGENT_LLM_MODEL ?? 'gpt-4o-mini';
const AGORA_AGENT_SYSTEM_MESSAGE =
  import.meta.env.VITE_AGORA_AGENT_SYSTEM_MESSAGE ?? 'You are a helpful chatbot.';
const AGORA_AGENT_GREETING_MESSAGE =
  import.meta.env.VITE_AGORA_AGENT_GREETING_MESSAGE ?? 'Hello, how can I help you?';
const AGORA_AGENT_FAILURE_MESSAGE =
  import.meta.env.VITE_AGORA_AGENT_FAILURE_MESSAGE ??
  "Sorry, I don't know how to answer this question.";
const AGORA_AGENT_LLM_MAX_HISTORY = Number.parseInt(
  import.meta.env.VITE_AGORA_AGENT_LLM_MAX_HISTORY ?? '',
  10
);
const AGORA_AGENT_TTS_VENDOR = import.meta.env.VITE_AGORA_AGENT_TTS_VENDOR ?? 'microsoft';
const AGORA_AGENT_TTS_KEY = import.meta.env.VITE_AGORA_AGENT_TTS_KEY;
const AGORA_AGENT_TTS_REGION = import.meta.env.VITE_AGORA_AGENT_TTS_REGION ?? 'eastus';
const AGORA_AGENT_TTS_VOICE =
  import.meta.env.VITE_AGORA_AGENT_TTS_VOICE ?? 'en-US-AndrewMultilingualNeural';

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

const resolveMaxHistory = () =>
  Number.isFinite(AGORA_AGENT_LLM_MAX_HISTORY) ? AGORA_AGENT_LLM_MAX_HISTORY : 10;

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

const buildAgentJoinPayload = () => {
  const properties = {
    channel: AGORA_CHANNEL,
    token: AGORA_TOKEN ?? '',
    agent_rtc_uid: AGORA_AGENT_RTC_UID,
    remote_rtc_uids: parseRemoteRtcUids(AGORA_AGENT_REMOTE_UIDS),
    enable_string_uid: AGORA_AGENT_ENABLE_STRING_UID,
    idle_timeout: resolveIdleTimeout(),
    asr: {
      language: AGORA_AGENT_ASR_LANGUAGE
    }
  };

  if (AGORA_AGENT_LLM_API_KEY) {
    properties.llm = {
      url: AGORA_AGENT_LLM_URL,
      api_key: AGORA_AGENT_LLM_API_KEY,
      system_messages: [
        {
          role: 'system',
          content: AGORA_AGENT_SYSTEM_MESSAGE
        }
      ],
      greeting_message: AGORA_AGENT_GREETING_MESSAGE,
      failure_message: AGORA_AGENT_FAILURE_MESSAGE,
      max_history: resolveMaxHistory(),
      params: {
        model: AGORA_AGENT_LLM_MODEL
      }
    };
  }

  if (AGORA_AGENT_TTS_KEY) {
    properties.tts = {
      vendor: AGORA_AGENT_TTS_VENDOR,
      params: {
        key: AGORA_AGENT_TTS_KEY,
        region: AGORA_AGENT_TTS_REGION,
        voice_name: AGORA_AGENT_TTS_VOICE
      }
    };
  }

  return {
    name: AGORA_AGENT_NAME,
    properties
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
    if (!AGORA_AGENT_JOIN_URL || !AGORA_AGENT_AUTH) {
      console.warn('Missing Agora agent join configuration. Skipping agent join request.');
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

    const payload = buildAgentJoinPayload();
    persistAgentSessionDetails(null);

    try {
      const response = await fetch(AGORA_AGENT_JOIN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${AGORA_AGENT_AUTH}`
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Agora agent join request failed', {
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
      console.error('Failed to invoke Agora agent join request', error);
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
