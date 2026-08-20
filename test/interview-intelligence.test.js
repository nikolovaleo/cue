const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildInterviewMemory,
  extractJsonObject,
  inferIntent,
  normalizeSemanticResult,
  normalizeVerification,
  scoreRescueCard,
} = require('../src/interview-intelligence');
const { createInterviewMetrics } = require('../src/interview-metrics');

test('intent classification distinguishes comparison, correction, system design and no-response', () => {
  const frame = (exactQuestion, extra = {}) => ({ exactQuestion, requiresResponse: true, ...extra });
  assert.equal(inferIntent(frame('What is the difference between embeddings and rerankers?'), 'technical'), 'comparison');
  assert.equal(inferIntent(frame('That is incorrect. Can you correct the distinction?', { challengeToPriorAnswer: true }), 'technical'), 'correction');
  assert.equal(inferIntent(frame('Design a global bot detection system.'), 'technical'), 'system_design');
  assert.equal(inferIntent({ exactQuestion: 'We offer insurance.', requiresResponse: false }), 'no_response');
});

test('interview memory keeps only candidate statements and includes provenance', () => {
  const memory = buildInterviewMemory([
    { channel: 'them', text: 'Our budget is 2.7 million colones.', ts: 1 },
    { channel: 'you', text: 'My current target is 2.4 million colones per month.', ts: 2 },
    { channel: 'you', text: 'I built a RAG evaluation pipeline in Python.', ts: 3 },
  ]);
  assert.equal(memory.length, 2);
  const salary = memory.find((fact) => fact.kind === 'compensation');
  assert.equal(salary.source, 'live_transcript');
  assert.equal(salary.sourceTurn, 1);
  assert.ok(memory.every((fact) => !/2\.7 million/i.test(fact.value)));
});

test('semantic JSON parser tolerates fenced output and normalization rejects invalid enums', () => {
  const parsed = extractJsonObject('```json\n{"exactQuestion":"Compare A and B"}\n```');
  assert.equal(parsed.exactQuestion, 'Compare A and B');
  const fallback = {
    exactQuestion: 'compare a and b', language: 'en', confidence: 'medium',
    requiresResponse: true, isFollowUp: false, challengeToPriorAnswer: false,
  };
  const normalized = normalizeSemanticResult({
    exactQuestion: 'Compare A and B', language: 'xx', confidence: 'certain',
    requiresResponse: true, category: 'made_up', intent: 'comparison',
  }, fallback, 'technical');
  assert.equal(normalized.language, 'en');
  assert.equal(normalized.confidence, 'medium');
  assert.equal(normalized.category, 'technical');
  assert.equal(normalized.intent, 'comparison');
});

test('verification normalization clamps scores and bounds warnings', () => {
  const result = normalizeVerification({
    ok: false, relevance: 140, factuality: -5, speakability: 88.6,
    correctedCard: '**Say now:** Corrected.',
    warnings: ['one', 'two', 'three', 'four', 'five'],
  });
  assert.deepEqual(
    [result.relevance, result.factuality, result.speakability, result.warnings.length],
    [100, 0, 89, 4],
  );
});

test('offline grader catches the original embedding/reranker failure', () => {
  const fixture = {
    expectedConcepts: ['embedding', 'query-document pair', 'reranker'],
    forbiddenClaims: ['both are nearest-neighbor models'],
  };
  const bad = scoreRescueCard('Both are nearest-neighbor models that use similarity.', fixture);
  const good = scoreRescueCard(
    '**Say now:** An embedding model independently encodes text; a reranker jointly scores a query-document pair. **Anchors:** embedding retrieves candidates; reranker reorders them.',
    fixture,
  );
  assert.ok(good.relevance > bad.relevance);
  assert.ok(good.factuality > bad.factuality);
  assert.equal(good.speakability, 100);
});

test('response metrics and explicit usefulness feedback append to local JSONL', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-metrics-'));
  const file = path.join(tempDir, 'quality.jsonl');
  const metrics = createInterviewMetrics(file);
  assert.equal(metrics.recordResponse({ responseId: 'r-1', firstTokenMs: 420, totalMs: 1800 }), true);
  assert.equal(metrics.recordFeedback('r-1', false), true);
  const rows = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'response');
  assert.equal(rows[1].useful, false);
  fs.rmSync(tempDir, { recursive: true, force: true });
});
