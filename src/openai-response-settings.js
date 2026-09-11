(function (root) {
const REASONING_EFFORTS = new Set(['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

// These families predate configurable reasoning. Even `none` is an invalid
// parameter for them. Include snapshots and fine-tuned model IDs.
function isNonReasoningModel(model) {
  return /^(?:ft:)?(?:gpt-(?:3\.5|4)(?:[o.:-]|$)|chatgpt-4o(?:-|$))/i.test(String(model || '').trim());
}

function reasoningEffortsForModel(model) {
  if (isNonReasoningModel(model)) return ['auto'];
  // Supported values reported by the OpenAI API for Luna.
  if (/^(?:ft:)?gpt-5\.6-luna(?:[-:]|$)/i.test(String(model || '').trim())) {
    return ['auto', 'none', 'low', 'medium', 'high', 'xhigh'];
  }
  return [...REASONING_EFFORTS];
}

function resolveReasoningEffort(model, effort) {
  const supported = reasoningEffortsForModel(model);
  if (supported.includes(effort)) return effort;
  // Preserve low deliberation for legacy Minimal settings; cap Maximum at
  // the highest supported level. Other invalid values use the model default.
  if (effort === 'minimal' && supported.includes('low')) return 'low';
  if (effort === 'max' && supported.includes('xhigh')) return 'xhigh';
  return 'auto';
}

// Missing settings preserve the behavior of existing installations. `auto`
// means omit reasoning_effort, letting the selected model choose its default.
function normalizeOpenAIResponseSettings(value, models) {
  const normalized = {};
  for (const tier of ['fast', 'smart']) {
    const options = value?.[tier];
    normalized[tier] = {
      reasoningEffort: REASONING_EFFORTS.has(options?.reasoningEffort) ? options.reasoningEffort : 'auto',
      stream: typeof options?.stream === 'boolean' ? options.stream : true
    };
    if (models) normalized[tier].reasoningEffort = resolveReasoningEffort(models[tier] || 'gpt-4o-mini', normalized[tier].reasoningEffort);
  }
  return normalized;
}

const api = { normalizeOpenAIResponseSettings, isNonReasoningModel, reasoningEffortsForModel, resolveReasoningEffort };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.OpenAIResponseSettings = api;
})(typeof window !== 'undefined' ? window : globalThis);
