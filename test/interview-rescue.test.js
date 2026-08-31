const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createQuestionFrame } = require('../src/question-frame');
const { buildInterviewContext, detectCategory } = require('../src/interview-context');
const { MODES } = require('../src/prompts');
const { replayInterview } = require('../src/interview-replay');
const { scoreRescueCard } = require('../src/interview-intelligence');

function turn(channel, text) { return { channel, text, ts: Date.now() }; }

test('replay: the latest hard follow-up wins over older transcript topics', () => {
  const transcript = [
    turn('them', 'Tell me about your current production data pipeline.'),
    turn('you', 'We ingest APIs into Delta tables and use them for a RAG system.'),
    turn('them', 'Now explain the difference between an embedding model and a reranker.'),
    turn('you', 'Both use similarity and nearest neighbors to rank documents.'),
    turn('them', 'That is not the fundamental difference.'),
    turn('them', 'Can you explain what each model actually scores?'),
  ];

  const frame = createQuestionFrame({ transcript });
  assert.match(frame.exactQuestion, /what each model actually scores/i);
  assert.doesNotMatch(frame.exactQuestion, /data pipeline/i);
  assert.equal(frame.isFollowUp, true);
  assert.equal(frame.challengeToPriorAnswer, true);
  assert.match(frame.candidateLastAnswer, /similarity and nearest neighbors/i);
  assert.equal(detectCategory(frame), 'technical');
});

test('replay: split interviewer STT fragments become one current question', () => {
  const transcript = [
    turn('them', 'There are different ways'),
    turn('them', 'to optimize the context window'),
    turn('them', 'in a multi-agent RAG system. How would you approach that?'),
  ];
  const frame = createQuestionFrame({ transcript });
  assert.match(frame.exactQuestion, /optimize the context window/i);
  assert.match(frame.exactQuestion, /how would you approach/i);
  assert.equal(frame.requiresResponse, true);
  assert.equal(frame.confidence, 'high');
});

test('replay: an unrelated new question does not drag the previous answer forward', () => {
  const frame = createQuestionFrame({ transcript: [
    turn('them', 'How does your production data pipeline work?'),
    turn('you', 'APIs land in Delta tables and feed a SQL agent.'),
    turn('them', 'What are your salary expectations?'),
  ] });
  assert.equal(frame.isFollowUp, false);
  assert.equal(frame.candidateLastAnswer, '');
  assert.equal(frame.previousQuestion, '');
  assert.equal(detectCategory(frame), 'compensation');
});

test('replay: recruiter explanations do not trigger a generated answer', () => {
  const frame = createQuestionFrame({ transcript: [
    turn('them', 'We offer private medical insurance, training, and flexible working hours.'),
  ] });
  assert.equal(frame.requiresResponse, false);
  assert.equal(frame.confidence, 'low');
});

test('replay: an explicit no-AI instruction pauses assistance', () => {
  const frame = createQuestionFrame({ transcript: [
    turn('them', 'Candidates are not allowed to use an AI assistant during this interview.'),
    turn('them', 'What is the difference between LangChain and LangGraph?'),
  ] });
  assert.equal(frame.prohibitedAssistance, true);
});

test('replay: the candidate live salary statement overrides stale profile data', () => {
  const transcript = [
    turn('them', 'What are your salary expectations?'),
    turn('you', 'My current target is 2.4 million colones per month.'),
    turn('them', 'Could you confirm your expected salary?'),
  ];
  const frame = createQuestionFrame({ transcript });
  assert.match(frame.liveFacts.salary, /2\.4 million colones/i);

  const context = buildInterviewContext({
    resumeText: '', jobDescription: '', starStories: '', whyCompany: '',
    whyLeaving: '', workStyle: '', salaryTarget: '2.7 million colones', questionsToAsk: '',
  }, 'say', transcript, frame);
  assert.match(context, /2\.4 million colones/i);
  assert.match(context, /overrides any conflicting saved profile value/i);
});

test('replay: Spanish questions request Spanish rescue cards', () => {
  const frame = createQuestionFrame({ transcript: [
    turn('them', '¿Cómo optimizarías la ventana de contexto para varios agentes?'),
  ] });
  assert.equal(frame.language, 'es');
});

test('say prompt is a grounded rescue card, not a generic paragraph', () => {
  const transcript = [
    turn('them', 'What is the fundamental difference between embeddings and reranking?'),
    turn('you', 'They both use nearest neighbors.'),
    turn('them', 'That is not the fundamental difference. Can you correct that?'),
  ];
  const frame = createQuestionFrame({ transcript });
  const system = MODES.say.buildSystem('=== Your Background ===\nPython and RAG experience.');
  const user = MODES.say.build({ transcript, questionFrame: frame });
  const prompt = `${system}\n${user}`;

  assert.match(prompt, /\*\*Say now:\*\*/);
  assert.match(prompt, /\*\*Anchors:\*\*/);
  assert.match(prompt, /fundamental distinction/i);
  assert.match(prompt, /never invent an employer, project, tool, metric, salary/i);
  assert.match(prompt, /That is not the fundamental difference/i);
  assert.match(prompt, /They both use nearest neighbors/i);
  assert.match(prompt, /100.180 words/i);
  assert.match(prompt, /45.90 seconds spoken/i);
  assert.doesNotMatch(prompt, /under 70 words/i);
});

test('answerThis treats a reviewed low-punctuation question as confirmed', () => {
  const frame = createQuestionFrame({
    transcript: [],
    explicitQuestion: 'difference between embedding model and reranker',
  });
  assert.equal(frame.requiresResponse, true);
  assert.equal(frame.confidence, 'medium');
  assert.equal(detectCategory(frame), 'technical');
});

test('Electron production path uses QuestionFrame and latest-request replacement', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');

  assert.match(main, /createQuestionFrame\(\{ transcript/);
  assert.match(main, /pendingFeatureRequest\s*=\s*request/);
  assert.match(main, /abortController\.abort\(\)/);
  assert.match(main, /llm:needs-confirmation/);
  assert.match(main, /questionFrame\.prohibitedAssistance/);
  assert.match(main, /buildSemanticAnalyzerPrompt/);
  assert.match(main, /buildVerifierPrompt/);
  assert.match(main, /createInterviewMetrics/);
  assert.match(main, /llm:replace/);
  assert.match(preload, /llm:queued/);
  assert.match(preload, /llm:needs-confirmation/);
  assert.match(preload, /submitAnswerFeedback/);
  assert.match(renderer, /className\s*=\s*'question-target'/);
  assert.match(renderer, /llm:verified/);
  assert.match(renderer, /Switching to the newest question/);
  assert.match(css, /\.question-target\s*\{/);
  assert.match(css, /\.answer-meta\s*\{/);
});

test('temporal replay avoids statements, supersedes stale work, grounds salary, and honors AI prohibition', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'interview-11pm-replay.json'), 'utf8'));
  const result = replayInterview(fixture.events, { responseLatencyMs: 2500 });
  const byId = Object.fromEntries(result.requests.map((request) => [request.id, request]));

  assert.equal(byId['benefits-statement'].decision, 'listen');
  assert.equal(byId['embedding-first'].supersededAt, 6800);
  assert.equal(byId['embedding-correction'].intent, 'correction');
  assert.match(byId['embedding-correction'].frame.candidateLastAnswer, /nearest neighbors/i);
  assert.match(byId['context-window'].frame.exactQuestion, /multi-agent RAG system/i);
  assert.match(byId['salary-confirmation'].memory.map((fact) => fact.value).join(' '), /2\.4 million colones/i);
  assert.equal(byId['ai-prohibited'].decision, 'paused');
  assert.equal(result.superseded, 1);
});

test('interview golden cards encode the hard technical distinctions', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'interview-11pm-replay.json'), 'utf8'));
  const cards = {
    'embedding-correction': '**Say now:** An embedding model independently encodes items for broad retrieval; a reranker jointly scores each query-document pair for finer ordering. **Anchors:** embedding retrieves candidates; reranker reorders the shortlist.',
    'context-window': '**Say now:** I would give each agent a bounded working context and retrieve only task-relevant state. **Anchors:** retrieve on demand; summarize durable state; enforce a token budget.',
  };
  for (const golden of fixture.goldens) {
    const score = scoreRescueCard(cards[golden.id], golden);
    assert.equal(score.relevance, 100, golden.id);
    assert.equal(score.factuality, 100, golden.id);
    assert.equal(score.speakability, 100, golden.id);
  }
});
