const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { OPTIONAL_API_KEY_PLACEHOLDER } = require('../src/openai-compatible');

let capturedClientOptions = null;
let capturedCompletionRequest = null;
let capturedCompletionRequests = [];
let completionCreateImpl = null;
const originalModuleLoad = Module._load;

Module._load = function loadWithOpenAIStub(request, parent, isMain) {
  if (request === 'openai') {
    return class FakeOpenAI {
      constructor(clientOptions) {
        capturedClientOptions = clientOptions;
        this.chat = {
          completions: {
            create: async (completionRequest) => {
              capturedCompletionRequest = completionRequest;
              capturedCompletionRequests.push(completionRequest);
              if (completionCreateImpl) return completionCreateImpl(completionRequest, capturedCompletionRequests.length);
              return [{ choices: [{ delta: { content: 'ok' } }] }];
            }
          }
        };
      }
    };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

const { createLLM, formatProviderErrorMessage, isQuotaError, CURRENT_GEMINI_DEFAULT } = require('../src/llm');

test.after(() => {
  Module._load = originalModuleLoad;
});

function createCustomSettings(overrides = {}) {
  return {
    provider: 'custom',
    smart: false,
    baseUrl: 'http://127.0.0.1:18789/v1',
    apiKeys: { custom: 'gateway-token' },
    models: { custom: { fast: 'openclaw/default', smart: 'openclaw/default' } },
    ...overrides
  };
}

test.beforeEach(() => {
  capturedClientOptions = null;
  capturedCompletionRequest = null;
  capturedCompletionRequests = [];
  completionCreateImpl = null;
});

test('routes the Custom provider through the configured OpenAI-compatible endpoint', async () => {
  const receivedTokens = [];
  const llm = createLLM(createCustomSettings());

  assert.equal(llm.ready, true);
  assert.equal(llm.model, 'openclaw/default');

  const response = await llm.stream({
    system: 'Be concise.',
    turns: [{ role: 'user', text: 'Hello' }],
    onToken: (token) => receivedTokens.push(token)
  });

  assert.deepEqual(capturedClientOptions, {
    apiKey: 'gateway-token',
    baseURL: 'http://127.0.0.1:18789/v1'
  });
  assert.equal(capturedCompletionRequest.model, 'openclaw/default');
  assert.equal(response, 'ok');
  assert.deepEqual(receivedTokens, ['ok']);
});

test('allows an unauthenticated local Custom endpoint', async () => {
  const llm = createLLM(createCustomSettings({ apiKeys: { custom: '' } }));
  await llm.stream({ system: '', turns: [], onToken: () => {} });

  assert.equal(capturedClientOptions.apiKey, OPTIONAL_API_KEY_PLACEHOLDER);
});

test('does not apply the Custom Base URL to official OpenAI requests', async () => {
  const llm = createLLM({
    provider: 'openai',
    smart: false,
    baseUrl: 'http://127.0.0.1:18789/v1',
    apiKeys: { openai: 'official-openai-key' },
    models: { openai: { fast: 'gpt-4o-mini', smart: 'gpt-4o' } }
  });

  await llm.stream({ system: '', turns: [], onToken: () => {} });

  assert.deepEqual(capturedClientOptions, { apiKey: 'official-openai-key' });
});

test('official GPT-5 models use max_completion_tokens and developer instructions', async () => {
  const llm = createLLM({
    provider: 'openai',
    smart: false,
    apiKeys: { openai: 'official-openai-key' },
    models: { openai: { fast: 'gpt-5.6-luna', smart: 'gpt-5.4-mini' } }
  });

  await llm.stream({ system: 'Be concise.', turns: [{ role: 'user', text: 'Hello' }], onToken: () => {} });

  assert.equal(capturedCompletionRequest.max_completion_tokens, 700);
  assert.equal('max_tokens' in capturedCompletionRequest, false);
  assert.equal(capturedCompletionRequest.messages[0].role, 'developer');
  assert.equal(capturedCompletionRequest.stream, true);
  assert.equal('reasoning_effort' in capturedCompletionRequest, false);
});

function openAIResponseSettings(smart = false) {
  return {
    provider: 'openai', smart,
    apiKeys: { openai: 'test-key' },
    models: { openai: { fast: 'gpt-5.6-luna', smart: 'gpt-5.6-terra' } },
    openaiResponse: {
      fast: { reasoningEffort: 'none', stream: true },
      smart: { reasoningEffort: 'high', stream: false }
    }
  };
}

test('GPT-4o omits reasoning_effort even when None is saved in either mode', async () => {
  for (const smart of [false, true]) {
    for (const model of ['gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-08-06', 'gpt-4.1', 'ft:gpt-4o-mini-2024-07-18:org:custom:id']) {
      const settings = openAIResponseSettings(smart);
      const tier = smart ? 'smart' : 'fast';
      settings.models.openai[tier] = model;
      settings.openaiResponse[tier] = { reasoningEffort: 'none', stream: !smart };
      completionCreateImpl = async request => {
        assert.equal('reasoning_effort' in request, false, model);
        return request.stream ? [{ choices: [{ delta: { content: 'ok' } }] }]
          : { choices: [{ message: { content: 'ok' } }] };
      };
      assert.equal(await createLLM(settings).stream({ system: '', turns: [], onToken() {} }), 'ok');
      assert.equal(capturedCompletionRequest.stream, !smart);
    }
  }
});

test('stale higher effort settings are also omitted for GPT-4o', async () => {
  const settings = openAIResponseSettings();
  settings.models.openai.fast = 'gpt-4o';
  settings.openaiResponse.fast.reasoningEffort = 'high';
  await createLLM(settings).stream({ system: '', turns: [], onToken() {} });
  assert.equal('reasoning_effort' in capturedCompletionRequest, false);
});

test('Luna migrates unsupported saved efforts while preserving supported efforts in both modes', async () => {
  for (const smart of [false, true]) {
    for (const [saved, expected] of [['minimal', 'low'], ['max', 'xhigh'], ['none', 'none'], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh']]) {
      const settings = openAIResponseSettings(smart);
      const tier = smart ? 'smart' : 'fast';
      settings.models.openai[tier] = 'gpt-5.6-luna';
      settings.openaiResponse[tier] = { reasoningEffort: saved, stream: true };
      await createLLM(settings).stream({ system: '', turns: [], onToken() {} });
      assert.equal(capturedCompletionRequest.reasoning_effort, expected);
    }
  }
});

test('Fast OpenAI requests use the selected model and effort while emitting streamed chunks', async () => {
  const tokens = [];
  completionCreateImpl = async () => [
    { choices: [{ delta: { content: 'Hello' } }] },
    { choices: [{ delta: { content: ' world' } }] }
  ];
  const result = await createLLM(openAIResponseSettings()).stream({ system: '', turns: [], onToken: t => tokens.push(t) });
  assert.equal(capturedCompletionRequest.model, 'gpt-5.6-luna');
  assert.equal(capturedCompletionRequest.reasoning_effort, 'none');
  assert.equal(capturedCompletionRequest.stream, true);
  assert.deepEqual(tokens, ['Hello', ' world']);
  assert.equal(result, 'Hello world');
});

test('Smart OpenAI non-streaming responses emit the complete text, preserving screenshot input', async () => {
  const tokens = [];
  completionCreateImpl = async () => ({ choices: [{ message: { content: 'Complete answer' } }] });
  const result = await createLLM(openAIResponseSettings(true)).stream({
    system: 'Read the screen', turns: [{ role: 'user', text: 'Solve this' }],
    imageDataUrl: 'data:image/png;base64,abc', onToken: t => tokens.push(t)
  });
  assert.equal(capturedCompletionRequest.model, 'gpt-5.6-terra');
  assert.equal(capturedCompletionRequest.reasoning_effort, 'high');
  assert.equal(capturedCompletionRequest.stream, false);
  assert.equal(capturedCompletionRequest.max_completion_tokens, 1400);
  assert.equal(capturedCompletionRequest.messages[1].content[1].image_url.url, 'data:image/png;base64,abc');
  assert.deepEqual(tokens, ['Complete answer']);
  assert.equal(result, 'Complete answer');
});

test('token-limit compatibility retry preserves explicit OpenAI response options', async () => {
  completionCreateImpl = async (_request, attempt) => {
    if (attempt === 1) throw Object.assign(new Error('Unsupported parameter: max_completion_tokens'), { status: 400 });
    return { choices: [{ message: { content: 'ok' } }] };
  };
  await createLLM(openAIResponseSettings(true)).stream({ system: '', turns: [], onToken() {} });
  assert.equal(capturedCompletionRequests.length, 2);
  assert.equal(capturedCompletionRequest.reasoning_effort, 'high');
  assert.equal(capturedCompletionRequest.stream, false);
  assert.equal(capturedCompletionRequest.max_tokens, 1400);
});

test('unsupported reasoning effort reports a settings fix without silently retrying at another effort', async () => {
  completionCreateImpl = async () => {
    throw Object.assign(new Error('Unsupported value for reasoning_effort'), { status: 400, param: 'reasoning_effort' });
  };
  await assert.rejects(createLLM(openAIResponseSettings()).stream({ system: '', turns: [], onToken() {} }), /choose Model default/);
  assert.equal(capturedCompletionRequests.length, 1);
});

test('OpenAI options do not change Custom requests', async () => {
  await createLLM(createCustomSettings({ openaiResponse: openAIResponseSettings().openaiResponse, smart: true }))
    .stream({ system: '', turns: [], onToken() {} });
  assert.equal(capturedCompletionRequest.stream, true);
  assert.equal('reasoning_effort' in capturedCompletionRequest, false);
});

test('official OpenAI falls back to max_tokens when an older model rejects max_completion_tokens', async () => {
  completionCreateImpl = async (_request, attempt) => {
    if (attempt === 1) {
      const error = new Error("400 Unsupported parameter: 'max_completion_tokens'. Use 'max_tokens' instead.");
      error.status = 400;
      throw error;
    }
    return [{ choices: [{ delta: { content: 'ok' } }] }];
  };
  const llm = createLLM({
    provider: 'openai',
    smart: false,
    apiKeys: { openai: 'official-openai-key' },
    models: { openai: { fast: 'gpt-4o-mini', smart: 'gpt-4o' } }
  });

  assert.equal(await llm.stream({ system: '', turns: [], onToken: () => {} }), 'ok');
  assert.equal(capturedCompletionRequests.length, 2);
  assert.equal(capturedCompletionRequests[0].max_completion_tokens, 700);
  assert.equal(capturedCompletionRequests[1].max_tokens, 700);
  assert.equal('max_completion_tokens' in capturedCompletionRequests[1], false);
});

test('OpenAI-compatible endpoints fall forward when they require max_completion_tokens', async () => {
  completionCreateImpl = async (_request, attempt) => {
    if (attempt === 1) {
      const error = new Error("400 Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.");
      error.status = 400;
      throw error;
    }
    return [{ choices: [{ delta: { content: 'ok' } }] }];
  };
  const llm = createLLM(createCustomSettings());

  assert.equal(await llm.stream({ system: '', turns: [], onToken: () => {} }), 'ok');
  assert.equal(capturedCompletionRequests.length, 2);
  assert.equal(capturedCompletionRequests[0].max_tokens, 700);
  assert.equal(capturedCompletionRequests[1].max_completion_tokens, 700);
  assert.equal('max_tokens' in capturedCompletionRequests[1], false);
});

test('reports incomplete Custom endpoint settings without making a request', () => {
  const llm = createLLM(createCustomSettings({ baseUrl: '' }));

  assert.equal(llm.ready, false);
  assert.match(llm.configurationError, /Set a Base URL/);
  assert.equal(capturedClientOptions, null);
});

test('requires a model for the Custom provider', () => {
  const llm = createLLM(createCustomSettings({
    models: { custom: { fast: '', smart: '' } }
  }));

  assert.equal(llm.ready, false);
  assert.match(llm.configurationError, /Set a Fast or Smart model/);
});

// ---- MiniMax (PR #22) -----------------------------------------------------
// MiniMax is OpenAI-compatible and region-split, so these assert the regional
// gateway selection rather than any new transport.

function minimaxSettings(overrides) {
  return Object.assign({
    provider: 'minimax',
    smart: true,
    apiKeys: { minimax: 'test-key' },
    models: { minimax: { fast: 'MiniMax-M2.7', smart: 'MiniMax-M3' } }
  }, overrides || {});
}

test('selects the MiniMax model for the active tier and reports readiness', () => {
  const smart = createLLM(minimaxSettings({ smart: true }));
  assert.equal(smart.provider, 'minimax');
  assert.equal(smart.model, 'MiniMax-M3');
  assert.equal(smart.ready, true);

  const fast = createLLM(minimaxSettings({ smart: false }));
  assert.equal(fast.model, 'MiniMax-M2.7');
});

test('routes MiniMax to the global OpenAI-compatible endpoint by default', async () => {
  capturedClientOptions = null;
  const llm = createLLM(minimaxSettings({ minimaxRegion: 'global_en' }));
  await llm.stream({ system: 's', turns: [{ role: 'user', text: 'hi' }], onToken: () => {} });
  assert.equal(capturedClientOptions.baseURL, 'https://api.minimax.io/v1');
  assert.equal(capturedClientOptions.apiKey, 'test-key');
});

test('routes MiniMax to the China endpoint when that region is selected', async () => {
  capturedClientOptions = null;
  const llm = createLLM(minimaxSettings({ minimaxRegion: 'cn_zh' }));
  await llm.stream({ system: 's', turns: [{ role: 'user', text: 'hi' }], onToken: () => {} });
  assert.equal(capturedClientOptions.baseURL, 'https://api.minimaxi.com/v1');
});

test('falls back to the global endpoint for an unknown region', async () => {
  capturedClientOptions = null;
  const llm = createLLM(minimaxSettings({ minimaxRegion: 'unknown' }));
  await llm.stream({ system: 's', turns: [{ role: 'user', text: 'hi' }], onToken: () => {} });
  assert.equal(capturedClientOptions.baseURL, 'https://api.minimax.io/v1');
});

// ---- Gemini 404/429 error mapping ------------------------------------------
// Reproduces the exact bug-report clusters: "Error: got status: 404 Not Found.
// {"error":{"message":"exception parsing response","code":404,"status":"Not
// Found"}}" (dead/misspelled model) and 429 quota exhaustion, and asserts they
// come out as actionable in-app messages instead of the raw provider JSON.

function geminiApiError({ status, body }) {
  const err = new Error(`got status: ${status}. ${JSON.stringify(body)}`);
  err.name = 'ApiError';
  err.status = status; // matches @google/genai's ApiError shape
  return err;
}

test('formatProviderErrorMessage: maps a Gemini 404 to an actionable "model unavailable" message', () => {
  const error = geminiApiError({
    status: 404,
    body: { error: { message: 'exception parsing response', code: 404, status: 'Not Found' } }
  });
  const message = formatProviderErrorMessage(error, 'gemini', 'gemini-2.0-flash');
  assert.match(message, /Gemini/);
  assert.match(message, /model "gemini-2\.0-flash"/);
  assert.match(message, /unavailable \(404\)/);
  assert.match(message, /Settings/);
  assert.doesNotMatch(message, /exception parsing response/);
});

test('formatProviderErrorMessage: 404 message still works without a model id', () => {
  const error = geminiApiError({ status: 404, body: { error: { message: 'not found', code: 404 } } });
  const message = formatProviderErrorMessage(error, 'openai');
  assert.match(message, /OpenAI model is unavailable \(404\)/);
});

test('formatProviderErrorMessage: maps a Gemini 429 to a free-tier quota message', () => {
  const error = geminiApiError({
    status: 429,
    body: { error: { message: 'You exceeded your current quota', code: 429, status: 'RESOURCE_EXHAUSTED' } }
  });
  const message = formatProviderErrorMessage(error, 'gemini', 'gemini-2.5-flash');
  assert.match(message, /Gemini free-tier quota exhausted \(429/);
  assert.match(message, /billing/);
  assert.doesNotMatch(message, /RESOURCE_EXHAUSTED/);
});

test('formatProviderErrorMessage: surfaces retry-after when the 429 body carries a RetryInfo delay', () => {
  const error = geminiApiError({
    status: 429,
    body: {
      error: {
        message: 'Resource exhausted',
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '38s' }]
      }
    }
  });
  const message = formatProviderErrorMessage(error, 'gemini');
  assert.match(message, /Wait about 38s/);
});

test('formatProviderErrorMessage: 429 without a retry delay falls back to a generic wait hint', () => {
  const error = new Error('429 Too Many Requests');
  error.status = 429;
  const message = formatProviderErrorMessage(error, 'openai');
  assert.match(message, /Wait a moment/);
});

test('formatProviderErrorMessage: an OpenAI-style quota 429 (no numeric status) is still recognized', () => {
  // Matches the literal text one of the bug reports pasted in.
  const error = new Error('429 You exceeded your current quota, please check your plan and billing details.');
  const message = formatProviderErrorMessage(error, 'openai');
  assert.match(message, /OpenAI free-tier quota exhausted/);
});

test('formatProviderErrorMessage: an unrecognized error passes its raw message through unchanged', () => {
  const error = new Error('socket hang up');
  assert.equal(formatProviderErrorMessage(error, 'anthropic'), 'socket hang up');
});

test('isQuotaError: agrees with formatProviderErrorMessage on what counts as quota', () => {
  assert.equal(isQuotaError(geminiApiError({ status: 429, body: {} })), true);
  assert.equal(isQuotaError(geminiApiError({ status: 404, body: {} })), false);
  assert.equal(isQuotaError(new Error('insufficient_quota')), true);
});

// ---- Gemini model selection / self-healing migration -----------------------

function geminiSettings(overrides) {
  return Object.assign({
    provider: 'gemini',
    smart: false,
    apiKeys: { gemini: 'test-key' }
  }, overrides || {});
}

test('createLLM: falls back to CURRENT_GEMINI_DEFAULT when no model is configured', () => {
  const llm = createLLM(geminiSettings({ models: {} }));
  assert.equal(llm.model, CURRENT_GEMINI_DEFAULT);
  assert.equal(llm.ready, true);
});

test('createLLM: a fresh install (store.js DEFAULTS shape) resolves to the current default', () => {
  const llm = createLLM(geminiSettings({
    models: { gemini: { fast: 'gemini-2.5-flash', smart: 'gemini-2.5-flash' } }
  }));
  assert.equal(llm.model, CURRENT_GEMINI_DEFAULT);
});

test('createLLM: self-heals a settings file saved with the retired gemini-2.0-flash default', () => {
  const llm = createLLM(geminiSettings({
    models: { gemini: { fast: 'gemini-2.0-flash', smart: 'gemini-2.0-flash' } }
  }));
  assert.equal(llm.model, CURRENT_GEMINI_DEFAULT);
});

test('createLLM: self-heals a legacy gemini-1.5-* model saved before the 2.0-flash migration existed', () => {
  const llm = createLLM(geminiSettings({
    models: { gemini: { fast: 'gemini-1.5-flash', smart: 'gemini-1.5-pro' } },
    smart: true
  }));
  assert.equal(llm.model, CURRENT_GEMINI_DEFAULT);
});

test('createLLM: leaves a user-chosen current Gemini model alone', () => {
  const llm = createLLM(geminiSettings({
    models: { gemini: { fast: 'gemini-3.5-flash', smart: 'gemini-3.5-flash' } }
  }));
  assert.equal(llm.model, 'gemini-3.5-flash');
});
