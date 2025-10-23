import http from 'node:http';
import { URL } from 'node:url';
import { env } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const loadDotEnv = (fileName = '.env') => {
  try {
    const envPath = resolvePath(process.cwd(), fileName);
    if (!existsSync(envPath)) {
      return;
    }

    const fileContents = readFileSync(envPath, 'utf8');
    const lines = fileContents.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const delimiterIndex = line.indexOf('=');
      if (delimiterIndex === -1) continue;

      const key = line.slice(0, delimiterIndex).trim();
      if (!key) continue;

      let value = line.slice(delimiterIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in env)) {
        env[key] = value;
      }
    }
  } catch (error) {
    console.warn('Unable to load .env file', error);
  }
};

loadDotEnv();


const PORT = Number.parseInt(env.PORT ?? '3001', 10);
const HOST = env.HOST ?? '0.0.0.0';
const MAX_BODY_SIZE = 1_000_000;

const resolveEnv = (...keys) => {
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

const parseBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return fallback;
};

const parseInteger = (value, fallback) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const parseRemoteRtcUids = (input, fallback = ['*']) => {
  if (Array.isArray(input)) {
    const values = input.map((uid) => String(uid).trim()).filter(Boolean);
    return values.length > 0 ? values : fallback;
  }

  if (typeof input === 'string') {
    const values = input
      .split(',')
      .map((uid) => uid.trim())
      .filter(Boolean);
    return values.length > 0 ? values : fallback;
  }

  return fallback;
};

const allowedOrigins = (() => {
  const configured =
    resolveEnv('ALLOWED_ORIGINS', 'CORS_ALLOWED_ORIGINS') ?? '*';
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
})();

const resolveCorsOrigin = (requestOrigin) => {
  if (allowedOrigins.length === 0) return undefined;
  if (allowedOrigins.includes('*')) return '*';
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return allowedOrigins[0];
};

const commonCorsHeaders = (origin) => {
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Agent-Auth'
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
};

const respondJson = (res, statusCode, payload, origin, extraHeaders = {}) => {
  const headers = {
    ...commonCorsHeaders(origin),
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  };

  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
};

const resolveRequestAuthToken = () =>
  resolveEnv('AGENT_CONTROLLER_AUTH_TOKEN', 'VITE_AGENT_CONTROLLER_AUTH_TOKEN');

const extractAuthToken = (req) => {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.trim() !== '') {
    const [scheme, value] = authorization.split(/\s+/);
    if (value) {
      if (scheme && scheme.toLowerCase() === 'bearer') {
        return value.trim();
      }
      return value.trim();
    }
    return authorization.trim();
  }

  const headerToken =
    req.headers['x-agent-auth'] ??
    req.headers['x-api-key'] ??
    req.headers['x-access-token'];
  if (typeof headerToken === 'string' && headerToken.trim() !== '') {
    return headerToken.trim();
  }

  return undefined;
};

const ensureRequestAuthorized = (req, res, origin) => {
  const expectedToken = resolveRequestAuthToken();
  if (!expectedToken) {
    respondJson(
      res,
      500,
      { error: 'Agent controller authentication token is not configured on the server.' },
      origin
    );
    return false;
  }

  const providedToken = extractAuthToken(req);
  if (!providedToken) {
    respondJson(
      res,
      401,
      { error: 'Missing authorization token.' },
      origin,
      { 'WWW-Authenticate': 'Bearer' }
    );
    return false;
  }

  if (providedToken !== expectedToken) {
    respondJson(
      res,
      401,
      { error: 'Invalid authorization token.' },
      origin,
      { 'WWW-Authenticate': 'Bearer error=\"invalid_token\"' }
    );
    return false;
  }

  return true;
};

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    let buffer = '';

    req.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      if (buffer.length > MAX_BODY_SIZE) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!buffer) {
        resolve(undefined);
        return;
      }

      try {
        resolve(JSON.parse(buffer));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });

const extractOverrides = (body) => {
  if (!body || typeof body !== 'object') {
    return {};
  }

  const overrides = {};
  const properties =
    body.properties && typeof body.properties === 'object'
      ? body.properties
      : undefined;

  const channel = body.channel ?? properties?.channel;
  if (typeof channel === 'string' && channel.trim() !== '') {
    overrides.channel = channel.trim();
  }

  const token = body.token ?? properties?.token;
  if (typeof token === 'string') {
    overrides.token = token;
  }

  const name = body.agentName ?? body.name;
  if (typeof name === 'string' && name.trim() !== '') {
    overrides.agentName = name.trim();
  }

  const agentRtcUid =
    body.agentRtcUid ??
    body.agent_rtc_uid ??
    properties?.agentRtcUid ??
    properties?.agent_rtc_uid;
  if (agentRtcUid !== undefined && agentRtcUid !== null) {
    overrides.agentRtcUid = agentRtcUid;
  }

  const remoteRtcUids =
    body.remoteRtcUids ??
    body.remote_rtc_uids ??
    properties?.remoteRtcUids ??
    properties?.remote_rtc_uids;
  if (remoteRtcUids !== undefined) {
    overrides.remoteRtcUids = remoteRtcUids;
  }

  const enableStringUid =
    body.enableStringUid ??
    body.enable_string_uid ??
    properties?.enableStringUid ??
    properties?.enable_string_uid;
  if (enableStringUid !== undefined) {
    overrides.enableStringUid = enableStringUid;
  }

  const idleTimeout =
    body.idleTimeout ??
    body.idle_timeout ??
    properties?.idleTimeout ??
    properties?.idle_timeout;
  if (idleTimeout !== undefined) {
    overrides.idleTimeout = idleTimeout;
  }

  const asr = body.asr ?? properties?.asr;
  if (asr && typeof asr === 'object') {
    overrides.asr = asr;
  }

  return overrides;
};

const buildAgentJoinPayload = (overrides = {}) => {
  const channel =
    overrides.channel ??
    resolveEnv('AGORA_CHANNEL', 'VITE_AGORA_CHANNEL');
  if (!channel) {
    throw new Error('MISSING_AGORA_CHANNEL');
  }

  const token =
    overrides.token ??
    resolveEnv('AGORA_TEMP_TOKEN', 'VITE_AGORA_TEMP_TOKEN') ??
    '';

  const defaultRtcUid =
    resolveEnv('AGORA_AGENT_RTC_UID', 'VITE_AGORA_AGENT_RTC_UID') ?? '0';
  const agentRtcUid =
    overrides.agentRtcUid !== undefined
      ? String(overrides.agentRtcUid)
      : String(defaultRtcUid);

  const defaultRemoteRtcUids = resolveEnv(
    'AGORA_AGENT_REMOTE_UIDS',
    'VITE_AGORA_AGENT_REMOTE_UIDS'
  );
  const remoteRtcUids = parseRemoteRtcUids(
    overrides.remoteRtcUids ?? defaultRemoteRtcUids
  );

  const enableStringUid = parseBoolean(
    overrides.enableStringUid ??
      resolveEnv(
        'AGORA_AGENT_ENABLE_STRING_UID',
        'VITE_AGORA_AGENT_ENABLE_STRING_UID'
      ),
    false
  );

  const idleTimeout = parseInteger(
    overrides.idleTimeout ??
      resolveEnv(
        'AGORA_AGENT_IDLE_TIMEOUT',
        'VITE_AGORA_AGENT_IDLE_TIMEOUT'
      ),
    120
  );

  const asrLanguage =
    (overrides.asr && overrides.asr.language) ??
    resolveEnv(
      'AGORA_AGENT_ASR_LANGUAGE',
      'VITE_AGORA_AGENT_ASR_LANGUAGE'
    ) ??
    'en-US';

  const properties = {
    channel,
    token,
    agent_rtc_uid: agentRtcUid,
    remote_rtc_uids: remoteRtcUids,
    enable_string_uid: enableStringUid,
    idle_timeout: idleTimeout,
    asr: {
      language: asrLanguage
    }
  };

  const defaultCustomLlmUrl = 'http://localhost:3100/chat/completions';
  const customLlmUrl = resolveEnv(
    'CUSTOM_LLM_PUBLIC_URL',
    'VITE_CUSTOM_LLM_PUBLIC_URL'
  );
  const configuredLlmUrl = resolveEnv(
    'AGORA_AGENT_LLM_URL',
    'VITE_AGORA_AGENT_LLM_URL'
  );
  const llmUrl = customLlmUrl ?? configuredLlmUrl ?? defaultCustomLlmUrl;
  const isCustomLlm = Boolean(customLlmUrl) || llmUrl === defaultCustomLlmUrl;

  if (llmUrl) {
    const llmApiKey = isCustomLlm
      ? resolveEnv('CUSTOM_LLM_CLIENT_API_KEY', 'VITE_CUSTOM_LLM_CLIENT_API_KEY')
      : resolveEnv('AGORA_AGENT_LLM_API_KEY', 'VITE_AGORA_AGENT_LLM_API_KEY');
    const systemMessage =
      resolveEnv(
        'AGORA_AGENT_SYSTEM_MESSAGE',
        'VITE_AGORA_AGENT_SYSTEM_MESSAGE'
      ) ?? 'You are a helpful chatbot.';
    const greetingMessage =
      resolveEnv(
        'AGORA_AGENT_GREETING_MESSAGE',
        'VITE_AGORA_AGENT_GREETING_MESSAGE'
      ) ?? 'Hello, how can I help you?';
    const failureMessage =
      resolveEnv(
        'AGORA_AGENT_FAILURE_MESSAGE',
        'VITE_AGORA_AGENT_FAILURE_MESSAGE'
      ) ?? "Sorry, I don't know how to answer this question.";
    const llmMaxHistory = parseInteger(
      resolveEnv(
        'AGORA_AGENT_LLM_MAX_HISTORY',
        'VITE_AGORA_AGENT_LLM_MAX_HISTORY'
      ),
      10
    );
    const llmModel =
      resolveEnv(
        'CUSTOM_LLM_MODEL',
        'VITE_CUSTOM_LLM_MODEL',
        'AGORA_AGENT_LLM_MODEL',
        'VITE_AGORA_AGENT_LLM_MODEL'
      ) ??
      'gpt-4o-mini';

    const llmConfig = {
      url: llmUrl,
      system_messages: [
        {
          role: 'system',
          content: systemMessage
        }
      ],
      greeting_message: greetingMessage,
      failure_message: failureMessage,
      max_history: llmMaxHistory,
      params: {
        model: llmModel,
        stream: true
      }
    };

    if (llmApiKey) {
      llmConfig.api_key = llmApiKey;
    }

    properties.llm = llmConfig;
  }

  const ttsKey = resolveEnv(
    'AGORA_AGENT_TTS_KEY',
    'VITE_AGORA_AGENT_TTS_KEY'
  );
  if (ttsKey) {
    const ttsVendor =
      resolveEnv(
        'AGORA_AGENT_TTS_VENDOR',
        'VITE_AGORA_AGENT_TTS_VENDOR'
      ) ?? 'microsoft';
    const ttsRegion =
      resolveEnv(
        'AGORA_AGENT_TTS_REGION',
        'VITE_AGORA_AGENT_TTS_REGION'
      ) ?? 'eastus';
    const ttsVoice =
      resolveEnv(
        'AGORA_AGENT_TTS_VOICE',
        'VITE_AGORA_AGENT_TTS_VOICE'
      ) ?? 'en-US-AndrewMultilingualNeural';

    properties.tts = {
      vendor: ttsVendor,
      params: {
        key: ttsKey,
        region: ttsRegion,
        voice_name: ttsVoice
      }
    };
  }

  const agentName =
    overrides.agentName ??
      resolveEnv('AGORA_AGENT_NAME', 'VITE_AGORA_AGENT_NAME') ??
      'checklist-agent';

  return {
    name: agentName,
    properties
  };
};

const forwardJoinRequest = async (payload) => {
  const authToken = resolveEnv(
    'AGORA_AGENT_AUTH',
    'VITE_AGORA_AGENT_AUTH'
  );
  if (!authToken) {
    throw new Error('MISSING_AGENT_AUTH');
  }

  const appId = resolveEnv('AGORA_APP_ID', 'VITE_AGORA_APP_ID');
  const overrideJoinUrl = resolveEnv(
    'AGORA_AGENT_JOIN_URL',
    'VITE_AGORA_AGENT_JOIN_URL'
  );
  const joinUrl =
    overrideJoinUrl ??
    (appId
      ? `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appId}/join`
      : undefined);

  if (!joinUrl) {
    throw new Error('MISSING_JOIN_URL');
  }

  const response = await fetch(joinUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${authToken}`
    },
    body: JSON.stringify(payload),
    keepalive: true
  });

  const rawBody = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: rawBody || '{}'
  };
};

const buildLeaveTarget = (input = {}) => {
  const leaveUrl = input.leaveUrl ?? input.url;
  const agentId = input.agentId ?? input.agent_id ?? input.id;
  const projectId =
    input.projectId ?? input.project_id ?? resolveEnv('AGORA_APP_ID', 'VITE_AGORA_APP_ID');

  if (leaveUrl) {
    return { agentId: agentId ? String(agentId) : undefined, url: leaveUrl };
  }

  if (!agentId) {
    throw new Error('MISSING_AGENT_ID');
  }

  if (!projectId) {
    throw new Error('MISSING_PROJECT_ID');
  }

  return {
    agentId: String(agentId),
    projectId: String(projectId),
    url: `https://api.agora.io/api/conversational-ai-agent/v2/projects/${projectId}/agents/${agentId}/leave`
  };
};

const forwardLeaveRequest = async (target) => {
  const authToken = resolveEnv(
    'AGORA_AGENT_AUTH',
    'VITE_AGORA_AGENT_AUTH'
  );
  if (!authToken) {
    throw new Error('MISSING_AGENT_AUTH');
  }

  const { url } = buildLeaveTarget(target);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authToken}`
    },
    keepalive: true
  });

  const rawBody = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: rawBody || '{}'
  };
};

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const method = req.method ?? 'UNKNOWN';
  const rawUrl = req.url ?? '/';
  const remoteAddress = req.socket?.remoteAddress ?? 'unknown';
  console.log(`[server.js] ${method} ${rawUrl} <- ${remoteAddress}`);

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      `[server.js] ${method} ${rawUrl} -> ${res.statusCode} (${durationMs}ms)`
    );
  });

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const origin = resolveCorsOrigin(req.headers.origin);

  const corsHeaders = commonCorsHeaders(origin);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    respondJson(res, 200, { status: 'ok' }, origin);
    return;
  }

  if (req.method === 'POST' && pathname === '/agent/join') {
    if (!ensureRequestAuthorized(req, res, origin)) {
      return;
    }

    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'PAYLOAD_TOO_LARGE') {
          respondJson(res, 413, { error: 'Request payload too large' }, origin);
          return;
        }
        if (error.message === 'INVALID_JSON') {
          respondJson(res, 400, { error: 'Invalid JSON payload' }, origin);
          return;
        }
      }
    }

    const overrides = extractOverrides(body);

    let joinPayload;
    try {
      joinPayload = buildAgentJoinPayload(overrides);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'MISSING_AGORA_CHANNEL') {
          respondJson(
            res,
            500,
            { error: 'Agora channel is not configured on the server.' },
            origin
          );
          return;
        }
        if (error.message === 'MISSING_AGENT_AUTH') {
          respondJson(
            res,
            500,
            { error: 'Agora agent authentication is not configured.' },
            origin
          );
          return;
        }
        if (error.message === 'MISSING_JOIN_URL') {
          respondJson(
            res,
            500,
            { error: 'Agora agent join URL could not be resolved.' },
            origin
          );
          return;
        }
      }
      respondJson(
        res,
        500,
        { error: 'Unable to build Agora join request payload.' },
        origin
      );
      return;
    }

    let agoraResponse;
    try {
      agoraResponse = await forwardJoinRequest(joinPayload);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'MISSING_AGENT_AUTH') {
          respondJson(
            res,
            500,
            { error: 'Agora agent authentication is not configured.' },
            origin
          );
          return;
        }
        if (error.message === 'MISSING_JOIN_URL') {
          respondJson(
            res,
            500,
            { error: 'Agora agent join URL could not be resolved.' },
            origin
          );
          return;
        }
      }

      console.error('Failed to forward Agora agent join request', error);
      respondJson(
        res,
        502,
        { error: 'Failed to reach Agora agent service.' },
        origin
      );
      return;
    }

    res.writeHead(agoraResponse.status, {
      ...commonCorsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(agoraResponse.body);
    return;
  }

  if (req.method === 'POST' && pathname === '/agent/leave') {
    if (!ensureRequestAuthorized(req, res, origin)) {
      return;
    }

    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'PAYLOAD_TOO_LARGE') {
          respondJson(res, 413, { error: 'Request payload too large' }, origin);
          return;
        }
        if (error.message === 'INVALID_JSON') {
          respondJson(res, 400, { error: 'Invalid JSON payload' }, origin);
          return;
        }
      }
    }

    if (!body || typeof body !== 'object') {
      respondJson(res, 400, { error: 'Leave request body is required.' }, origin);
      return;
    }

    try {
      const agoraResponse = await forwardLeaveRequest(body);
      res.writeHead(agoraResponse.status, {
        ...commonCorsHeaders(origin),
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(agoraResponse.body);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'MISSING_AGENT_AUTH') {
          respondJson(
            res,
            500,
            { error: 'Agora agent authentication is not configured.' },
            origin
          );
          return;
        }
        if (error.message === 'MISSING_AGENT_ID') {
          respondJson(res, 400, { error: 'Agent identifier is required to leave.' }, origin);
          return;
        }
        if (error.message === 'MISSING_PROJECT_ID') {
          respondJson(
            res,
            500,
            { error: 'Agora project identifier is not configured.' },
            origin
          );
          return;
        }
      }

      console.error('Failed to forward Agora agent leave request', error);
      respondJson(
        res,
        502,
        { error: 'Failed to reach Agora agent service.' },
        origin
      );
    }
    return;
  }

  respondJson(res, 404, { error: 'Not found' }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`Agent controller listening on http://${HOST}:${PORT}`);
});
