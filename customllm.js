import http from 'node:http';
import { URL, pathToFileURL } from 'node:url';
import { env } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const MAX_BODY_SIZE = 1_000_000;

const checklistDefaults = [
  {
    id: 'item-1',
    question: 'Verify emergency exits remain unobstructed and clearly marked.',
    status: 'pending',
    recommendation: '',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'item-2',
    question: 'Confirm all fire extinguishers are inspected and tagged within the last 30 days.',
    status: 'pending',
    recommendation: '',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'item-3',
    question: 'Ensure incident response documentation is up to date and accessible to staff.',
    status: 'pending',
    recommendation: '',
    updatedAt: new Date().toISOString()
  }
];

let checklistItems = checklistDefaults.map((item) => ({ ...item }));
const checklistStreams = new Set();

const getChecklistSnapshot = () => ({
  updatedAt: new Date().toISOString(),
  items: checklistItems.map((item) => ({ ...item }))
});

const broadcastChecklistUpdate = () => {
  const serialized = JSON.stringify(getChecklistSnapshot());

  for (const stream of [...checklistStreams]) {
    if (stream.writableEnded) {
      checklistStreams.delete(stream);
      continue;
    }
    try {
      stream.write(`data: ${serialized}\n\n`);
    } catch (error) {
      console.warn('Checklist stream write failed:', error);
      checklistStreams.delete(stream);
    }
  }
};

const resetChecklist = () => {
  checklistItems = checklistDefaults.map((item) => ({
    ...item,
    status: 'pending',
    recommendation: '',
    updatedAt: new Date().toISOString()
  }));
  broadcastChecklistUpdate();
};

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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With, X-Agent-Auth, X-Api-Key, Last-Event-ID, ngrok-skip-browser-warning'
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

const defaultToolParameters = { type: 'object', properties: {}, additionalProperties: true };

const getRegisteredToolDefinitions = () =>
  Array.from(toolRegistry.values())
    .map((entry) => entry.definition)
    .filter(Boolean);

const registerTool = (name, handlerOrConfig, maybeConfig = {}) => {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Tool name must be a non-empty string');
  }

  const normalizedName = name.trim();

  const config =
    typeof handlerOrConfig === 'function'
      ? { handler: handlerOrConfig, ...maybeConfig }
      : handlerOrConfig ?? {};

  const { handler, description, parameters, strict } = config;

  if (typeof handler !== 'function') {
    throw new Error(`Handler for tool "${normalizedName}" must be a function`);
  }

  const definition = {
    type: 'function',
    function: {
      name: normalizedName,
      description:
        typeof description === 'string' && description.trim()
          ? description.trim()
          : `Tool "${normalizedName}"`,
      parameters:
        parameters && typeof parameters === 'object' ? parameters : defaultToolParameters
    }
  };

  if (strict !== undefined) {
    definition.function.strict = Boolean(strict);
  }

  toolRegistry.set(normalizedName, { handler, definition });
};

registerTool('ping', {
  description:
    'Health check utility. Returns status ok and the current timestamp to confirm tool execution.',
  handler: async () => ({ status: 'ok', timestamp: Date.now() })
});

registerTool('echo', {
  description:
    'Returns the provided arguments unchanged. Useful for debugging tool invocation payloads.',
  parameters: {
    type: 'object',
    properties: {
      payload: {
        description: 'Any JSON-serializable value to echo back.',
        anyOf: [
          { type: 'object' },
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
          { type: 'array', items: {} }
        ]
      }
    },
    additionalProperties: true
  },
  handler: async (args = {}) => args
});

const knownChecklistStatuses = new Set(['pending', 'complete', 'pass', 'fail', 'warning']);
const checklistStatusAliases = new Map([
  ['completed', 'complete'],
  ['done', 'complete'],
  ['finished', 'complete'],
  ['resolved', 'complete'],
  ['yes', 'complete'],
  ['y', 'complete'],
  ['affirmative', 'complete'],
  ['pass', 'pass'],
  ['passed', 'pass'],
  ['ok', 'complete'],
  ['okay', 'complete'],
  ['good', 'complete'],
  ['success', 'complete'],
  ['successful', 'complete'],
  ['no', 'pending'],
  ['not yet', 'pending'],
  ['notyet', 'pending'],
  ['incomplete', 'pending'],
  ['pending', 'pending'],
  ['todo', 'pending'],
  ['to-do', 'pending'],
  ['warning', 'warning'],
  ['caution', 'warning'],
  ['attention', 'warning'],
  ['failed', 'fail'],
  ['fail', 'fail'],
  ['issue', 'fail'],
  ['problem', 'fail']
]);

const normalizeChecklistStatus = (value) => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return undefined;
  if (knownChecklistStatuses.has(normalized)) {
    return normalized === 'pass' ? 'complete' : normalized;
  }
  const alias = checklistStatusAliases.get(normalized);
  if (alias) {
    return alias === 'pass' ? 'complete' : alias;
  }
  if (normalized.startsWith('complete')) {
    return 'complete';
  }
  if (normalized.startsWith('fail')) {
    return 'fail';
  }
  if (normalized.includes('warn')) {
    return 'warning';
  }
  if (normalized.includes('pend')) {
    return 'pending';
  }
  return undefined;
};

const findChecklistItem = ({ itemId, itemNumber, itemName }) => {
  if (itemId) {
    const byId = checklistItems.find(
      (item) => item.id.toLowerCase() === String(itemId).trim().toLowerCase()
    );
    if (byId) return byId;
  }

  if (itemNumber !== undefined && itemNumber !== null) {
    const index = Number.parseInt(itemNumber, 10);
    if (Number.isFinite(index) && index >= 1 && index <= checklistItems.length) {
      return checklistItems[index - 1];
    }
  }

  if (itemName) {
    const normalizedName = String(itemName).trim().toLowerCase();
    const byName = checklistItems.find((item) =>
      item.question.toLowerCase().includes(normalizedName)
    );
    if (byName) return byName;
  }

  return undefined;
};

registerTool('update_checklist_item_status', {
  description:
    'Update the status and notes for a checklist entry. Use when the user confirms progress or completion for a specific item.',
  parameters: {
    type: 'object',
    properties: {
      item_id: {
        type: 'string',
        description: 'Optional unique identifier of the checklist item (e.g., "item-1").'
      },
      item_number: {
        type: 'integer',
        minimum: 1,
        description: 'Optional 1-based index of the checklist item (e.g., 1 for the first item).'
      },
      item_name: {
        type: 'string',
        description:
          'Optional free-form name or fragment of the checklist question to help locate the item.'
      },
      status: {
        type: 'string',
        enum: ['pending', 'complete', 'pass', 'fail', 'warning'],
        description:
          'New status for the item. "complete" indicates the task is done. "pending" reopens it.'
      },
      recommendation: {
        type: 'string',
        description:
          'Optional follow-up recommendation or summary to attach to the item for the human reviewer.'
      },
      note: {
        type: 'string',
        description: 'Optional short note explaining the status update.'
      }
    },
    required: ['status'],
    additionalProperties: false
  },
  handler: async (args = {}) => {
    const target =
      findChecklistItem({
        itemId: args.item_id,
        itemNumber: args.item_number,
        itemName: args.item_name
      }) ?? null;

    if (!target) {
      return {
        error:
          'Unable to locate checklist item. Provide an item_id or item_number matching the checklist.'
      };
    }

    const normalizedStatus = normalizeChecklistStatus(args.status);
    if (!normalizedStatus) {
      return {
        error:
          'Invalid status. Use one of: pending, complete, fail, warning. "pass" is treated as complete.'
      };
    }

    const previousStatus = target.status;
    target.status = normalizedStatus;
    target.updatedAt = new Date().toISOString();

    if (typeof args.recommendation === 'string') {
      target.recommendation = args.recommendation;
    } else if (typeof args.note === 'string' && !args.recommendation) {
      target.recommendation = args.note;
    }

    broadcastChecklistUpdate();

    return {
      success: true,
      item: { ...target },
      previousStatus,
      newStatus: target.status
    };
  }
});

registerTool('reset_checklist', {
  description:
    'Reset all checklist items back to a pending state. Use at the start of a new review session.',
  handler: async () => {
    resetChecklist();
    return { success: true, items: getChecklistSnapshot().items };
  }
});

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

const looksLikePlaceholderValue = (value) => {
  if (!value) return true;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes('your-secret-key') ||
    normalized.includes('your-openai-api-key') ||
    normalized.includes('your_api_key') ||
    normalized.includes('replace-with') ||
    normalized.includes('example-key')
  );
};

const resolveApiKey = () => {
  const candidates = [
    ['CUSTOM_LLM_API_KEY', env.CUSTOM_LLM_API_KEY],
    ['AGORA_AGENT_LLM_API_KEY', env.AGORA_AGENT_LLM_API_KEY],
    ['VITE_AGORA_AGENT_LLM_API_KEY', env.VITE_AGORA_AGENT_LLM_API_KEY],
    ['YOUR_LLM_API_KEY', env.YOUR_LLM_API_KEY],
    ['OPENAI_API_KEY', env.OPENAI_API_KEY]
  ];

  for (const [sourceName, value] of candidates) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (looksLikePlaceholderValue(trimmed)) {
      console.warn(`[customllm.js] Ignoring placeholder value provided for ${sourceName}.`);
      continue;
    }
    return trimmed;
  }

  return undefined;
};

const apiKey = resolveApiKey();

const requestTimeoutMs = parseInteger(env.CUSTOM_LLM_REQUEST_TIMEOUT_MS, 30_000);

console.log(
  `[customllm.js] Upstream base URL: ${baseUrl} (default model: ${defaultModel})`
);

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

  const toolEntry = toolRegistry.get(call.function.name);
  const handler = toolEntry?.handler;
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

const mergeToolDefinitions = (providedTools, registeredTools) => {
  const merged = [];
  const seenNames = new Set();

  if (Array.isArray(providedTools)) {
    for (const tool of providedTools) {
      if (!tool || typeof tool !== 'object') continue;
      const toolName = tool?.function?.name;
      if (typeof toolName === 'string' && toolName.trim()) {
        seenNames.add(toolName.trim());
      }
      merged.push(tool);
    }
  }

  for (const tool of registeredTools ?? []) {
    if (!tool || typeof tool !== 'object') continue;
    const toolName = tool?.function?.name;
    if (typeof toolName === 'string' && toolName.trim()) {
      if (seenNames.has(toolName.trim())) {
        continue;
      }
    }
    merged.push(tool);
  }

  return merged;
};

const defaultChecklistInstruction =
  'You manage a shared compliance checklist. When the user confirms progress on an item, call the function `update_checklist_item_status` with either the item number (1-based) or id (e.g., "item-1") and set `status` to "complete" (or another appropriate value). Summarize any changes back to the user after the function call.';

const ensureChecklistToolInstruction = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  if (!toolRegistry.has('update_checklist_item_status')) {
    return messages;
  }

  const instruction =
    typeof env.CUSTOM_LLM_CHECKLIST_PROMPT === 'string' &&
    env.CUSTOM_LLM_CHECKLIST_PROMPT.trim()
      ? env.CUSTOM_LLM_CHECKLIST_PROMPT.trim()
      : defaultChecklistInstruction;

  if (!instruction) {
    return messages;
  }

  const alreadyIncludesInstruction = messages.some((message) => {
    if (!message || message.role !== 'system') return false;
    const content = message.content;
    if (typeof content === 'string') {
      return content.includes('update_checklist_item_status');
    }
    if (Array.isArray(content)) {
      return content.some(
        (part) =>
          typeof part?.text === 'string' && part.text.includes('update_checklist_item_status')
      );
    }
    return false;
  });

  if (alreadyIncludesInstruction) {
    return messages;
  }

  const firstSystemIndex = messages.findIndex((message) => message?.role === 'system');
  if (firstSystemIndex !== -1) {
    const systemMessage = messages[firstSystemIndex];
    if (typeof systemMessage.content === 'string') {
      systemMessage.content = `${systemMessage.content}\n\n${instruction}`;
      return messages;
    }
    if (Array.isArray(systemMessage.content)) {
      systemMessage.content = [
        ...systemMessage.content,
        { type: 'text', text: instruction }
      ];
      return messages;
    }
  }

  return [{ role: 'system', content: instruction }, ...messages];
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
  context,
  stream
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

  if (stream === true) {
    payload.stream = true;
  }

  if (stream === true && stream_options && Object.keys(stream_options).length > 0) {
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

  const registeredToolDefinitions = getRegisteredToolDefinitions();
  const combinedTools = mergeToolDefinitions(body.tools, registeredToolDefinitions);
  const resolvedToolChoice =
    body.tool_choice === undefined && combinedTools.length > 0 ? 'auto' : body.tool_choice;

  messages = ensureChecklistToolInstruction(messages);

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
        tools: combinedTools,
        tool_choice: resolvedToolChoice,
        response_format: body.response_format,
        modalities: body.modalities,
        audio: body.audio,
        parallel_tool_calls: body.parallel_tool_calls,
        stream_options: body.stream_options,
        context: body.context,
        stream: false
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

  if (req.method === 'GET' && pathname === '/checklist') {
    respondJson(
      res,
      200,
      getChecklistSnapshot(),
      origin,
      { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
    );
    return;
  }

  if (req.method === 'GET' && pathname === '/checklist/stream') {
    const headers = {
      ...buildCorsHeaders(origin),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    };
    res.writeHead(200, headers);
    res.write(`data: ${JSON.stringify(getChecklistSnapshot())}\n\n`);

    checklistStreams.add(res);

    const keepAlive = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(keepAlive);
        checklistStreams.delete(res);
        return;
      }
      try {
        res.write(': keep-alive\n\n');
      } catch (error) {
        console.warn('Checklist stream keep-alive failed:', error);
        clearInterval(keepAlive);
        checklistStreams.delete(res);
      }
    }, 30_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      checklistStreams.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/checklist/reset') {
    resetChecklist();
    respondJson(res, 200, { success: true, items: getChecklistSnapshot().items }, origin);
    return;
  }

  if (req.method === 'POST' && pathname === '/chat/completions') {
    await handleChatCompletion(req, res, origin);
    return;
  }

  respondError(res, 404, 'Not found.', origin);
});

server.listen(PORT, HOST, () => {
  console.log(`Custom LLM server listening on http://${HOST}:${PORT}/chat/completions`);
});
