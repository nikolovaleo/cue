const test = require('node:test');
const assert = require('node:assert');
const { looksLikeHallucination, buildVocabPrompt } = require('../src/stt');
const { DeepgramStreamingSTT, OpenAIRealtimeSTT } = require('../src/stt-streaming');

test('looksLikeHallucination drops Whisper silence artifacts', () => {
  ['', '   ', 'Thank you for watching.', 'thanks for watching', 'Bye-bye!', '👍👍'].forEach((s) => {
    assert.equal(looksLikeHallucination(s), true, JSON.stringify(s));
  });
});

test('looksLikeHallucination keeps real speech', () => {
  ['Tell me about your experience with Kubernetes.', 'You know, I led the migration.'].forEach((s) => {
    assert.equal(looksLikeHallucination(s), false, JSON.stringify(s));
  });
});

test('buildVocabPrompt seeds base vocab and resume proper nouns, capped', () => {
  const p = buildVocabPrompt({ resumeText: 'Optum EKS Terraform', jobDescription: 'AWS SRE' });
  assert.ok(p.includes('Kubernetes'));
  assert.ok(p.includes('Optum'));
  assert.ok(p.length <= 850);
  assert.ok(buildVocabPrompt(undefined).length > 0);
  assert.ok(buildVocabPrompt({ resumeText: 'Xyzzy '.repeat(4000) }).length <= 850);
});

test('Deepgram accumulates is_final segments into one turn at speech_final', () => {
  const finals = [];
  const d = new DeepgramStreamingSTT('k', { onTranscript: (t) => finals.push(t) });
  d._handleMessage({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'Tell me about' }] } });
  d._handleMessage({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'your experience' }] } });
  d._handleMessage({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: 'with Kubernetes.' }] } });
  assert.deepEqual(finals, ['Tell me about your experience with Kubernetes.']);
});

test('Deepgram flushes pending segments on UtteranceEnd when speech_final never arrives', () => {
  const finals = [];
  const d = new DeepgramStreamingSTT('k', { onTranscript: (t) => finals.push(t) });
  d._handleMessage({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'hello there' }] } });
  d._handleMessage({ type: 'UtteranceEnd' });
  assert.deepEqual(finals, ['hello there']);
  d._handleMessage({ type: 'UtteranceEnd' });
  assert.deepEqual(finals, ['hello there'], 'no duplicate emit on a second UtteranceEnd');
});

test('Deepgram drops hallucinated finals', () => {
  const finals = [];
  const d = new DeepgramStreamingSTT('k', { onTranscript: (t) => finals.push(t) });
  d._handleMessage({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: 'Thank you.' }] } });
  assert.deepEqual(finals, []);
});

test('OpenAI Realtime accumulates transcript deltas for the live interim row', () => {
  const interims = [];
  const stt = new OpenAIRealtimeSTT('k', { onInterim: (text) => interims.push(text) });
  stt._handleEvent({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'turn-1', delta: 'Tell me' });
  stt._handleEvent({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'turn-1', delta: ' about yourself.' });
  assert.deepEqual(interims, ['Tell me', 'Tell me about yourself.']);
});

test('OpenAI Realtime commits buffered speech and emits its finalized turn', async () => {
  const sent = [];
  const finals = [];
  const stt = new OpenAIRealtimeSTT('k', { onTranscript: (text) => finals.push(text) });
  stt.ws = { readyState: 1, send: (data) => sent.push(JSON.parse(data)) };
  stt.connected = true;
  stt._sessionReady = true;

  stt.sendAudio(Buffer.alloc(3200));
  assert.equal(stt.commit(), true);
  const waiting = stt.waitForFinal({ timeoutMs: 100 });
  stt._handleEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'turn-1',
    transcript: 'Tell me about yourself.'
  });

  assert.equal(await waiting, true);
  assert.deepEqual(sent.map((event) => event.type), ['input_audio_buffer.append', 'input_audio_buffer.commit']);
  assert.deepEqual(finals, ['Tell me about yourself.']);
});
