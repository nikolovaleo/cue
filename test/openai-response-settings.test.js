const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { normalizeOpenAIResponseSettings, isNonReasoningModel } = require('../src/openai-response-settings');

test('shared browser and backend model detection recognizes non-reasoning families only', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/openai-response-settings.js'), 'utf8'), context);
  for (const detect of [isNonReasoningModel, context.window.OpenAIResponseSettings.isNonReasoningModel]) {
    for (const model of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4-turbo', 'gpt-3.5-turbo', 'chatgpt-4o-latest', 'ft:gpt-4o:org:name:id']) {
      assert.equal(detect(model), true, model);
    }
    for (const model of ['gpt-5', 'gpt-5.6-luna', 'gpt-6-astra', 'o3', 'o4-mini', 'custom-model']) {
      assert.equal(detect(model), false, model);
    }
  }
});

test('missing or malformed response settings preserve model defaults and streaming', () => {
  const defaults = { fast: { reasoningEffort: 'auto', stream: true }, smart: { reasoningEffort: 'auto', stream: true } };
  for (const input of [undefined, null, {}, { fast: { reasoningEffort: 'invalid', stream: 'false' }, smart: null }]) {
    assert.deepEqual(normalizeOpenAIResponseSettings(input), defaults);
  }
});

test('OpenAI response settings persist across reloads and partial settings updates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-response-test-'));
  const storePath = path.resolve(__dirname, '../src/store.js');
  const localRequire = createRequire(storePath);
  function loadStore() {
    const context = { module: { exports: {} }, require: name => name === 'electron'
      ? { app: { getPath: () => dir } } : localRequire(name) };
    vm.runInNewContext(fs.readFileSync(storePath, 'utf8'), context);
    return context.module.exports;
  }
  try {
    fs.writeFileSync(path.join(dir, 'cue-data.json'), JSON.stringify({ models: { openai: { fast: 'saved-model', smart: 'gpt-5.6-luna' } } }));
    const store = loadStore();
    assert.equal(store.getSettings().openaiResponse.fast.reasoningEffort, 'auto');
    store.setSettings({ openaiResponse: { fast: { reasoningEffort: 'none', stream: false }, smart: { reasoningEffort: 'high' } } });
    store.setSettings({ smart: true });
    const reloaded = loadStore().getSettings();
    assert.equal(reloaded.models.openai.fast, 'saved-model');
    assert.equal(reloaded.openaiResponse.fast.reasoningEffort, 'none');
    assert.equal(reloaded.openaiResponse.fast.stream, false);
    assert.equal(reloaded.openaiResponse.smart.reasoningEffort, 'high');
    assert.equal(reloaded.openaiResponse.smart.stream, true);
    store.setSettings({ openaiResponse: { smart: { reasoningEffort: 'minimal' } } });
    assert.equal(loadStore().getSettings().openaiResponse.smart.reasoningEffort, 'low');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
