import { resolveAgentControllerEndpoint } from './agentController.js';

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

const fallbackProjectId =
  AGORA_APP_ID !== undefined && AGORA_APP_ID !== null && AGORA_APP_ID !== ''
    ? String(AGORA_APP_ID)
    : undefined;

export const AGENT_JOIN_ENDPOINT = resolveAgentControllerEndpoint(AGENT_CONTROLLER_URL, 'join');
export const AGENT_LEAVE_ENDPOINT = resolveAgentControllerEndpoint(AGENT_CONTROLLER_URL, 'leave');
export const AGENT_CONTROLLER_AUTH_TOKEN =
  import.meta.env.VITE_AGENT_CONTROLLER_AUTH_TOKEN ??
  import.meta.env.VITE_AGENT_CONTROLLER_AUTH_SECRET ??
  '';

export const AGORA_AGENT_LAST_JOIN_KEY = 'agora-agent-last-join';

export const parseRemoteRtcUids = (value = AGORA_AGENT_REMOTE_UIDS) => {
  if (!value) return ['*'];
  const parsed = value
    .split(',')
    .map((uid) => uid.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : ['*'];
};

export const resolveIdleTimeout = () =>
  Number.isFinite(AGORA_AGENT_IDLE_TIMEOUT) ? AGORA_AGENT_IDLE_TIMEOUT : 120;

export const resolveAgentIdentifiers = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const agentPayload =
    typeof payload.agent === 'object' && payload.agent !== null ? payload.agent : undefined;

  const rawAgentId =
    payload.agent_id ??
    payload.agentId ??
    payload.id ??
    agentPayload?.agent_id ??
    agentPayload?.agentId ??
    agentPayload?.id;

  if (!rawAgentId) {
    return null;
  }

  const agentId = String(rawAgentId);

  const rawProjectId =
    payload.project_id ??
    payload.projectId ??
    agentPayload?.project_id ??
    agentPayload?.projectId ??
    undefined;

  const projectIdCandidate =
    rawProjectId !== undefined && rawProjectId !== null && rawProjectId !== ''
      ? String(rawProjectId)
      : undefined;

  const projectId = projectIdCandidate ?? fallbackProjectId;

  const leaveUrlFromPayload =
    payload.leave_url ??
    payload.leaveUrl ??
    agentPayload?.leave_url ??
    agentPayload?.leaveUrl ??
    undefined;

  const leaveUrl =
    leaveUrlFromPayload && String(leaveUrlFromPayload).trim() !== ''
      ? String(leaveUrlFromPayload)
      : projectId
        ? `https://api.agora.io/api/conversational-ai-agent/v2/projects/${projectId}/agents/${agentId}/leave`
        : undefined;

  return {
    agentId,
    projectId,
    leaveUrl
  };
};

export const buildAgentJoinRequest = () => {
  if (!AGORA_CHANNEL) {
    return null;
  }

  return {
    agentName: AGORA_AGENT_NAME,
    channel: AGORA_CHANNEL,
    token: AGORA_TOKEN ?? '',
    agentRtcUid: AGORA_AGENT_RTC_UID,
    remoteRtcUids: parseRemoteRtcUids(),
    enableStringUid: AGORA_AGENT_ENABLE_STRING_UID,
    idleTimeout: resolveIdleTimeout(),
    asr: {
      language: AGORA_AGENT_ASR_LANGUAGE
    }
  };
};

export const persistAgentSessionDetails = (details) => {
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

export const clearAgentSessionDetails = () => {
  persistAgentSessionDetails(null);
};

export const extractAgentSessionDetails = (payload) => {
  const identifiers = resolveAgentIdentifiers(payload);
  if (!identifiers) {
    return null;
  }

  const sessionDetails = {
    agentId: identifiers.agentId,
    recordedAt: Date.now()
  };

  if (identifiers.projectId) {
    sessionDetails.projectId = identifiers.projectId;
  }

  if (identifiers.leaveUrl) {
    sessionDetails.leaveUrl = identifiers.leaveUrl;
  }

  return sessionDetails;
};

export const storeAgentSessionDetailsFromResponse = (payload) => {
  const sessionDetails = extractAgentSessionDetails(payload);
  if (sessionDetails) {
    persistAgentSessionDetails(sessionDetails);
  } else {
    persistAgentSessionDetails(null);
  }
  return sessionDetails;
};

export const requestAgentJoin = async (payloadOverride) => {
  if (!AGENT_JOIN_ENDPOINT || !AGORA_CHANNEL) {
    return { ok: false, reason: 'missing_configuration' };
  }

  if (typeof fetch !== 'function') {
    return { ok: false, reason: 'fetch_unavailable' };
  }

  const payload = payloadOverride ?? buildAgentJoinRequest();
  if (!payload) {
    return { ok: false, reason: 'missing_payload' };
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  if (AGENT_CONTROLLER_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${AGENT_CONTROLLER_AUTH_TOKEN}`;
  }

  try {
    const response = await fetch(AGENT_JOIN_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      keepalive: true
    });

    const responseText = await response.text().catch(() => '');
    let parsedBody;
    if (responseText) {
      try {
        parsedBody = JSON.parse(responseText);
      } catch {
        parsedBody = undefined;
      }
    }

    const sessionDetails = response.ok
      ? storeAgentSessionDetailsFromResponse(parsedBody)
      : null;

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: responseText,
      parsedBody,
      sessionDetails
    };
  } catch (error) {
    return { ok: false, error };
  }
};

export const requestAgentLeave = async ({ agentId, projectId, leaveUrl } = {}) => {
  if (!AGENT_LEAVE_ENDPOINT || !agentId) {
    return { ok: false, reason: 'missing_configuration' };
  }

  if (typeof fetch !== 'function') {
    return { ok: false, reason: 'fetch_unavailable' };
  }

  const payload = {
    agentId,
    projectId,
    leaveUrl
  };

  const filteredPayload = Object.fromEntries(
    Object.entries(payload).filter(
      ([, value]) => value !== undefined && value !== null && value !== ''
    )
  );

  const headers = {
    'Content-Type': 'application/json'
  };

  if (AGENT_CONTROLLER_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${AGENT_CONTROLLER_AUTH_TOKEN}`;
  }

  try {
    const response = await fetch(AGENT_LEAVE_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(filteredPayload),
      keepalive: true
    });

    const bodyText = await response.text().catch(() => '');
    let parsedBody;
    if (bodyText) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        parsedBody = undefined;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: bodyText,
      parsedBody
    };
  } catch (error) {
    return { ok: false, error };
  }
};
