import http from 'node:http';
import { URL, pathToFileURL } from 'node:url';
import { env } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const MAX_BODY_SIZE = 1_000_000;

const loadDotEnvFile = (fileName) => {
  try {
    const envPath = resolvePath(process.cwd(), fileName);
    if (!existsSync(envPath)) {
      return;
    }

    const contents = readFileSync(envPath, 'utf8');
    for (const rawLine of contents.split(/\r?\n/)) {
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
    console.warn(`Unable to load env file "${fileName}":`, error);
  }
};

loadDotEnvFile('.env');
loadDotEnvFile('.env.local');

const PORT = Number.parseInt(env.CUSTOM_LLM_PORT ?? '3100', 10);
const HOST = env.CUSTOM_LLM_HOST ?? '0.0.0.0';

const parseInteger = (value, fallback) => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const allowedOrigins = (() => {
  const configured =
    env.CUSTOM_LLM_ALLOWED_ORIGINS ??
    env.ALLOWED_ORIGINS ??
    env.CORS_ALLOWED_ORIGINS ??
    '*';
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

const buildCorsHeaders = (origin) => {
  const headers = {
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With, X-Agent-Auth, X-Api-Key'
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
};

const respondJson = (res, statusCode, payload, origin, extraHeaders = {}) => {
  const headers = {
    ...buildCorsHeaders(origin),
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  };
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
};

const respondError = (res, statusCode, message, origin) => {
  respondJson(res, statusCode, { error: message }, origin);
};

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    let buffer = '';

    req.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
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

const toolRegistry = new Map();

const registerTool = (name, handler) => {
  if (!name || typeof name !== 'string') {
    throw new Error('Tool name must be a non-empty string');
  }
  if (typeof handler !== 'function') {
    throw new Error(`Handler for tool "${name}" must be a function`);
  }
  toolRegistry.set(name, handler);
};

registerTool('ping', async () => ({ status: 'ok', timestamp: Date.now() }));
registerTool('echo', async (args = {}) => args);

const maybeLoadExternalTools = async () => {
  const toolFile = resolvePath(process.cwd(), 'customllm.tools.js');
  if (!existsSync(toolFile)) {
    return;
  }

  try {
    const moduleUrl = pathToFileURL(toolFile).href;
    const toolsModule = await import(moduleUrl);
    const loader =
      typeof toolsModule?.default === 'function'
        ? toolsModule.default
        : typeof toolsModule?.register === 'function'
          ? toolsModule.register
          : undefined;

    if (loader) {
      await loader({ registerTool });
      console.log('Loaded custom tool handlers from customllm.tools.js');
    } else {
      console.warn(
        'customllm.tools.js was found but does not export a default or register function.'
      );
    }
  } catch (error) {
    console.error('Failed to load customllm.tools.js:', error);
  }
};

await maybeLoadExternalTools();

const defaultModel = env.CUSTOM_LLM_MODEL ?? env.AGORA_AGENT_LLM_MODEL ?? 'gpt-4o-mini';
const baseUrl =
  env.CUSTOM_LLM_BASE_URL ??
  env.AGORA_AGENT_LLM_URL ??
  'https://api.openai.com/v1/chat/completions';
const apiKey =
  env.CUSTOM_LLM_API_KEY ??
  env.AGORA_AGENT_LLM_API_KEY ??
  env.VITE_AGORA_AGENT_LLM_API_KEY ??
  env.YOUR_LLM_API_KEY ??
  env.OPENAI_API_KEY;

const requestTimeoutMs = parseInteger(env.CUSTOM_LLM_REQUEST_TIMEOUT_MS, 30_000);

const callChatApi = async (payload) => {
  if (!apiKey) {
    throw new Error(
      'CUSTOM_LLM_API_KEY (or AGORA_AGENT_LLM_API_KEY / OPENAI_API_KEY) is required for proxying requests.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Upstream LLM request failed with status ${response.status}: ${errorText}`
      );
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const sendSseChunk = (res, chunk) => {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
};

const sendSseDone = (res) => {
  res.write('data: [DONE]\n\n');
  res.end();
};

const createChunkBase = (model) => ({
  id: `customllm-${Date.now()}`,
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      delta: {},
      finish_reason: null
    }
  ]
});

const sendRoleChunk = (res, model, role) => {
  const chunk = createChunkBase(model);
  chunk.choices[0].delta.role = role;
  sendSseChunk(res, chunk);
};

const sendContentChunks = (res, model, content) => {
  if (content === undefined || content === null) {
    return;
  }

  const pieces = Array.isArray(content) ? content : [content];
  for (const piece of pieces) {
    if (!piece) continue;
    if (typeof piece === 'string') {
      const chunk = createChunkBase(model);
      chunk.choices[0].delta.content = piece;
      sendSseChunk(res, chunk);
    } else {
      const chunk = createChunkBase(model);
      chunk.choices[0].delta.content = [piece];
      sendSseChunk(res, chunk);
    }
  }
};

const sendToolCallChunk = (res, model, toolCalls) => {
  const chunk = createChunkBase(model);
  chunk.choices[0].delta.tool_calls = toolCalls;
  chunk.choices[0].finish_reason = 'tool_calls';
  sendSseChunk(res, chunk);
};

const sendStopChunk = (res, model) => {
  const chunk = createChunkBase(model);
  chunk.choices[0].finish_reason = 'stop';
  sendSseChunk(res, chunk);
};

const executeToolCall = async (call) => {
  if (!call?.function?.name) {
    return { error: 'Tool call is missing function name.' };
  }

  const handler = toolRegistry.get(call.function.name);
  if (!handler) {
    return { error: `No handler registered for tool "${call.function.name}".` };
  }

  let parsedArgs = {};
  if (call.function.arguments) {
    try {
      parsedArgs = JSON.parse(call.function.arguments);
    } catch (error) {
      return {
        error: `Failed to parse arguments for tool "${call.function.name}".`,
        details: String(error)
      };
    }
  }

  try {
    const result = await handler(parsedArgs);
    if (typeof result === 'string') {
      return { output: result };
    }
    if (Buffer.isBuffer(result)) {
      return { output: result.toString('base64'), encoding: 'base64' };
    }
    return result ?? { output: null };
  } catch (error) {
    return {
      error: `Tool "${call.function.name}" execution failed.`,
      details: error instanceof Error ? error.message : String(error)
    };
  }
};

const normalizeMessage = (message) => {
  if (!message || typeof message !== 'object') return undefined;
  const normalized = { role: message.role };

  if ('content' in message) {
    normalized.content = message.content;
  }

  if ('tool_calls' in message && message.tool_calls) {
    normalized.tool_calls = message.tool_calls;
  }

  if ('audio' in message && message.audio) {
    normalized.audio = message.audio;
  }

  if ('name' in message && message.name) {
    normalized.name = message.name;
  }

  if ('tool_call_id' in message && message.tool_call_id) {
    normalized.tool_call_id = message.tool_call_id;
  }

  return normalized;
};

const buildChatPayload = ({
  model,
  messages,
  tools,
  tool_choice,
  response_format,
  modalities,
  audio,
  parallel_tool_calls,
  stream_options,
  context
}) => {
  const payload = {
    model,
    messages,
    stream: false
  };

  if (Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
  }

  if (tool_choice) {
    payload.tool_choice = tool_choice;
  }

  if (response_format) {
    payload.response_format = response_format;
  }

  if (Array.isArray(modalities) && modalities.length > 0) {
    payload.modalities = modalities;
  }

  if (audio) {
    payload.audio = audio;
  }

  if (typeof parallel_tool_calls === 'boolean') {
    payload.parallel_tool_calls = parallel_tool_calls;
  }

  if (stream_options && Object.keys(stream_options).length > 0) {
    payload.stream_options = stream_options;
  }

  if (context && Object.keys(context).length > 0) {
    payload.context = context;
  }

  return payload;
};

const handleChatCompletion = async (req, res, origin) => {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'PAYLOAD_TOO_LARGE') {
        respondError(res, 413, 'Request payload too large.', origin);
        return;
      }
      if (error.message === 'INVALID_JSON') {
        respondError(res, 400, 'Request body must be valid JSON.', origin);
        return;
      }
    }
    console.error('Unable to read request body:', error);
    respondError(res, 500, 'Failed to read request body.', origin);
    return;
  }

  if (!body || typeof body !== 'object') {
    respondError(res, 400, 'Request body must be an object.', origin);
    return;
  }

  if (body.stream === false) {
    respondError(res, 400, 'Custom LLM endpoint requires stream=true.', origin);
    return;
  }

  const model = body.model ?? defaultModel;
  let messages = Array.isArray(body.messages)
    ? body.messages.map(normalizeMessage).filter(Boolean)
    : [];

  if (messages.length === 0) {
    respondError(res, 400, 'At least one message is required.', origin);
    return;
  }

  const responseHeaders = {
    ...buildCorsHeaders(origin),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  };
  res.writeHead(200, responseHeaders);

  try {
    let continueLoop = true;
    let loopGuard = 0;

    while (continueLoop) {
      if (loopGuard > 10) {
        throw new Error('Exceeded maximum number of tool call iterations.');
      }
      loopGuard += 1;

      const payload = buildChatPayload({
        model,
        messages,
        tools: body.tools,
        tool_choice: body.tool_choice,
        response_format: body.response_format,
        modalities: body.modalities,
        audio: body.audio,
        parallel_tool_calls: body.parallel_tool_calls,
        stream_options: body.stream_options,
        context: body.context
      });

      const upstreamResponse = await callChatApi(payload);
      const choice = upstreamResponse?.choices?.[0];
      const assistantMessage = choice?.message;

      if (!choice || !assistantMessage) {
        throw new Error('Upstream LLM returned an unexpected response.');
      }

      sendRoleChunk(res, model, 'assistant');

      if (assistantMessage.tool_calls?.length) {
        sendToolCallChunk(res, model, assistantMessage.tool_calls);

        messages.push({
          role: 'assistant',
          content: assistantMessage.content ?? null,
          tool_calls: assistantMessage.tool_calls
        });

        for (const call of assistantMessage.tool_calls) {
          const toolResult = await executeToolCall(call);
          const toolMessage = {
            role: 'tool',
            tool_call_id: call.id ?? call.function?.name ?? 'tool',
            content: JSON.stringify(toolResult)
          };

          messages.push(toolMessage);
        }

        continue;
      }

      sendContentChunks(res, model, assistantMessage.content ?? []);

      if (assistantMessage.audio) {
        const audioChunk = createChunkBase(model);
        audioChunk.choices[0].delta.audio = assistantMessage.audio;
        sendSseChunk(res, audioChunk);
      }

      sendStopChunk(res, model);
      sendSseDone(res);
      continueLoop = false;
    }
  } catch (error) {
    console.error('Custom LLM handler failed:', error);
    const chunk = createChunkBase(model);
    chunk.choices[0].delta = {
      role: 'assistant',
      content: 'An internal error occurred while generating a response.'
    };
    chunk.choices[0].finish_reason = 'stop';
    sendSseChunk(res, chunk);
    sendSseDone(res);
  }
};

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const method = req.method ?? 'UNKNOWN';
  const rawUrl = req.url ?? '/';
  const remoteAddress = req.socket?.remoteAddress ?? 'unknown';
  const headerOrigin = req.headers.origin ?? 'n/a';
  console.log(
    `[customllm.js] ${method} ${rawUrl} <- ${remoteAddress} (origin: ${headerOrigin})`
  );

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      `[customllm.js] ${method} ${rawUrl} -> ${res.statusCode} (${durationMs}ms)`
    );
  });

  const origin = resolveCorsOrigin(req.headers.origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, buildCorsHeaders(origin));
    res.end();
    return;
  }

  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (req.method === 'POST' && pathname === '/chat/completions') {
    await handleChatCompletion(req, res, origin);
    return;
  }

  respondError(res, 404, 'Not found.', origin);
});

server.listen(PORT, HOST, () => {
  console.log(`Custom LLM server listening on http://${HOST}:${PORT}/chat/completions`);
});
