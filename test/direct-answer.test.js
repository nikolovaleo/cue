const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { MODES } = require('../src/prompts');

test('original runner answers unpunctuated speech directly in one model call', async () => {
  const source = fs.readFileSync(require.resolve('../main.js'), 'utf8');
  const runner = source.slice(source.indexOf('async function runFeature('), source.indexOf('// -------- IPC --------'));
  for (const text of ['cnn versus dense networks', 'go deeper on that', 'and the tradeoff', '']) {
    const calls = [], events = [];
    const context = {
      MODES, state: { busy: false }, transcript: [{ channel: 'them', text }],
      store: { getSettings: () => ({ provider: 'openai' }) },
      createLLM: () => ({ ready: true, stream: async args => { calls.push(args); args.onToken('Answer'); return 'Answer'; } }),
      finalizeStreamingTranscript: async () => {}, detectCategory: () => 'general',
      buildInterviewContext: () => '', send: (name, data) => events.push({ name, data }),
      recordEvent: () => {}, setTimeout, clearTimeout, STREAM_INACTIVITY_MS: 1000
    };
    vm.runInNewContext(runner, context);
    await context.runFeature('say', '');
    assert.equal(calls.length, 1, text);
    assert.ok(calls[0].turns[0].text.includes(text));
    assert.ok(events.some(e => e.name === 'llm:token' && e.data.text === 'Answer'));
    assert.ok(events.some(e => e.name === 'llm:done'));
    assert.equal(context.state.busy, false);
    assert.doesNotMatch(calls[0].system, /QuestionFrame|requiresResponse|transcription confidence/i);
  }
});
