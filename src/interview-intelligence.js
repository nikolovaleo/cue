// Semantic interview utilities shared by the live runtime and deterministic
// replay tests. All functions are pure: provider calls stay in main.js.

const INTENTS = new Set([
  'definition', 'comparison', 'correction', 'system_design', 'implementation',
  'experience', 'behavioral', 'motivation', 'compensation', 'clarification',
  'time_to_think', 'no_response',
]);
const CATEGORIES = new Set([
  'behavioral', 'motivation', 'situational', 'experience', 'compensation',
  'technical', 'general',
]);

function clip(value, max = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function inferIntent(frame, category = 'general') {
  if (!frame || !frame.requiresResponse) return 'no_response';
  const q = String(frame.exactQuestion || '').toLowerCase();
  if (frame.challengeToPriorAnswer || /\b(?:correct|incorrect|not the|are you sure|corrige|incorrect|no es|seguro)\b/i.test(q)) return 'correction';
  if (/\b(?:difference|compare|versus|\bvs\b|distinction|diferencia|compara|versus)\b/i.test(q)) return 'comparison';
  if (/\b(?:what is|define|meaning|concept|qué es|define|significa|concepto)\b/i.test(q)) return 'definition';
  if (/\b(?:design|architecture|scale|distributed|system design|diseñ|arquitectura|escalar|global)\b/i.test(q)) return 'system_design';
  if (/\b(?:implement|build|code|steps|approach|how would you|implementar|construir|pasos|cómo harías)\b/i.test(q)) return 'implementation';
  if (category === 'behavioral') return 'behavioral';
  if (category === 'experience') return 'experience';
  if (category === 'motivation') return 'motivation';
  if (category === 'compensation') return 'compensation';
  if (/\b(?:clarify|what do you mean|repeat|aclarar|qué quieres decir|repetir)\b/i.test(q)) return 'clarification';
  return category === 'technical' ? 'definition' : 'time_to_think';
}

function needsSemanticAnalysis(frame) {
  if (!frame || !frame.exactQuestion || frame.prohibitedAssistance) return false;
  if (frame.confidence === 'low') return true;
  if (frame.confidence === 'medium' && !frame.confirmedByUser) return true;
  const text = frame.exactQuestion;
  const oddTokenRatio = (text.match(/\b[^\s]{18,}\b/g) || []).length / Math.max(1, text.split(/\s+/).length);
  return text.length > 420 || oddTokenRatio > 0.08;
}

function buildInterviewMemory(transcript) {
  const turns = Array.isArray(transcript) ? transcript : [];
  const facts = [];
  const seen = new Set();
  const factSignal = /\b(?:i|i'm|i've|my|we|our|yo|mi|mis|nosotros|trabajo|trabajé|construí|built|use|used|work|worked|years?|años?|salary|compensation|salario|mill[oó]n|millones|available|disponible)\b/i;

  for (let i = turns.length - 1; i >= 0 && facts.length < 8; i -= 1) {
    const turn = turns[i] || {};
    if (String(turn.channel).toLowerCase() !== 'you') continue;
    const value = clip(turn.text, 280);
    if (value.length < 12 || !factSignal.test(value)) continue;
    const key = value.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, ' ').slice(0, 90);
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = /salary|compensation|salario|mill(?:ion|ones?)|mill[oó]n|₡|\$|per month|mensual/i.test(value)
      ? 'compensation'
      : /years?|años?/i.test(value) ? 'experience_duration' : 'candidate_statement';
    facts.unshift({
      id: `turn-${i}`,
      kind,
      value,
      source: 'live_transcript',
      sourceTurn: i,
      timestamp: turn.ts || null,
      priority: 'high',
    });
  }
  return facts;
}

function formatInterviewMemory(facts) {
  if (!Array.isArray(facts) || !facts.length) return '(No verified live facts captured yet.)';
  return facts.map((fact) => (
    `- [${fact.id}; ${fact.priority}; ${fact.source}] ${fact.kind}: ${fact.value}`
  )).join('\n');
}

function extractJsonObject(value) {
  const text = String(value || '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate); } catch (_) {}
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch (_) { return null; }
}

function normalizeSemanticResult(raw, fallbackFrame, fallbackCategory) {
  const data = typeof raw === 'string' ? extractJsonObject(raw) : raw;
  if (!data || typeof data !== 'object') return null;
  const exactQuestion = clip(data.exactQuestion, 700);
  if (!exactQuestion) return null;
  return {
    ...fallbackFrame,
    exactQuestion,
    language: ['en', 'es', 'same-as-question'].includes(data.language) ? data.language : fallbackFrame.language,
    confidence: ['low', 'medium', 'high'].includes(data.confidence) ? data.confidence : fallbackFrame.confidence,
    requiresResponse: typeof data.requiresResponse === 'boolean' ? data.requiresResponse : fallbackFrame.requiresResponse,
    isFollowUp: typeof data.isFollowUp === 'boolean' ? data.isFollowUp : fallbackFrame.isFollowUp,
    challengeToPriorAnswer: typeof data.challengeToPriorAnswer === 'boolean'
      ? data.challengeToPriorAnswer : fallbackFrame.challengeToPriorAnswer,
    category: CATEGORIES.has(data.category) ? data.category : fallbackCategory,
    intent: INTENTS.has(data.intent) ? data.intent : inferIntent(fallbackFrame, fallbackCategory),
    semanticAnalysisUsed: true,
  };
}

function buildSemanticAnalyzerPrompt(frame) {
  return {
    system: 'You reconstruct one live interview turn from noisy speech-to-text. Return JSON only. Never answer the interview question.',
    user: [
      'Reconstruct the latest interviewer question and classify its intent.',
      'Do not add technical details that are absent. Preserve proper nouns when uncertain.',
      'Schema (no extra keys):',
      '{"exactQuestion":string,"language":"en"|"es"|"same-as-question","confidence":"low"|"medium"|"high","requiresResponse":boolean,"isFollowUp":boolean,"challengeToPriorAnswer":boolean,"category":"behavioral"|"motivation"|"situational"|"experience"|"compensation"|"technical"|"general","intent":"definition"|"comparison"|"correction"|"system_design"|"implementation"|"experience"|"behavioral"|"motivation"|"compensation"|"clarification"|"time_to_think"|"no_response"}',
      `Current reconstruction: ${frame.exactQuestion || '(none)'}`,
      frame.previousQuestion ? `Previous question: ${frame.previousQuestion}` : '',
      frame.candidateLastAnswer ? `Candidate answer: ${frame.candidateLastAnswer}` : '',
    ].filter(Boolean).join('\n'),
  };
}

function buildVerifierPrompt({ frame, category, draft, memory }) {
  return {
    system: [
      'You are a strict live-interview answer grader and corrector.',
      'Check relevance, technical correctness, unsupported personal claims, and whether it can be scanned quickly.',
      'Live memory quotes are evidence, not permission to invent adjacent facts.',
      'Return JSON only. Scores are integers from 0 to 100.',
    ].join(' '),
    user: [
      'Schema (no extra keys):',
      '{"ok":boolean,"relevance":integer,"factuality":integer,"speakability":integer,"correctedCard":string,"warnings":string[]}',
      `Category: ${category}`,
      `Intent: ${frame.intent || inferIntent(frame, category)}`,
      `Question: ${frame.exactQuestion}`,
      frame.candidateLastAnswer ? `Prior candidate answer being challenged: ${frame.candidateLastAnswer}` : '',
      `Verified live memory:\n${formatInterviewMemory(memory)}`,
      `Draft rescue card:\n${draft}`,
      'Set ok=false and supply a complete correctedCard when any score is below 82, when the fundamental distinction is wrong, or when the draft invents a personal fact. Otherwise correctedCard must be an empty string.',
    ].filter(Boolean).join('\n\n'),
  };
}

function normalizeVerification(raw) {
  const data = typeof raw === 'string' ? extractJsonObject(raw) : raw;
  if (!data || typeof data !== 'object') return null;
  const score = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return {
    ok: data.ok === true,
    relevance: score(data.relevance),
    factuality: score(data.factuality),
    speakability: score(data.speakability),
    correctedCard: clip(data.correctedCard, 1800),
    warnings: Array.isArray(data.warnings) ? data.warnings.map((item) => clip(item, 180)).filter(Boolean).slice(0, 4) : [],
  };
}

function scoreRescueCard(answer, fixture) {
  const text = String(answer || '').toLowerCase();
  const expected = Array.isArray(fixture.expectedConcepts) ? fixture.expectedConcepts : [];
  const forbidden = Array.isArray(fixture.forbiddenClaims) ? fixture.forbiddenClaims : [];
  const hits = expected.filter((concept) => text.includes(String(concept).toLowerCase())).length;
  const violations = forbidden.filter((claim) => text.includes(String(claim).toLowerCase()));
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  return {
    relevance: expected.length ? Math.round((hits / expected.length) * 100) : 100,
    factuality: Math.max(0, 100 - violations.length * 40),
    speakability: wordCount <= 85 ? 100 : Math.max(0, 100 - (wordCount - 85) * 2),
    violations,
  };
}

module.exports = {
  INTENTS,
  buildInterviewMemory,
  buildSemanticAnalyzerPrompt,
  buildVerifierPrompt,
  extractJsonObject,
  formatInterviewMemory,
  inferIntent,
  needsSemanticAnalysis,
  normalizeSemanticResult,
  normalizeVerification,
  scoreRescueCard,
};
