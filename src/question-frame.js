// Builds a compact, trustworthy view of the interview moment before an LLM is
// called.  Raw STT turns are intentionally not the unit of prompting: a single
// interviewer question is often split across several finalized fragments.

const QUESTION_STARTERS = /^(?:what|how|why|when|where|who|which|tell|describe|explain|compare|can|could|would|should|have|did|do|does|is|are|was|were|walk me|give me|cu[aá]l|cu[aá]les|c[oó]mo|por qu[eé]|cu[aá]ndo|d[oó]nde|qui[eé]n|qu[eé]|dime|cu[eé]ntame|describe|explica|compara|puedes|podr[ií]as|has|hiciste|har[ií]as|es|son)\b/i;
const QUESTION_PHRASES = /\b(?:tell me about|walk me through|give me an example|difference between|pros and cons|trade.?offs?|ways? to|how does|how would|what is|what are|why did|can you|could you|do you|have you|cu[aá]l es|cu[aá]les son|diferencia entre|h[aá]blame de|cu[eé]ntame de|dame un ejemplo|c[oó]mo funciona|c[oó]mo har[ií]as|por qu[eé]|puedes explicar|podr[ií]as explicar)\b/i;
const FOLLOW_UP_PATTERNS = /\b(?:follow.?up|more specifically|to clarify|can you clarify|can you expand|what do you mean|but you said|however|not quite|not exactly|fundamental difference|going back to|on that point|m[aá]s espec[ií]ficamente|para aclarar|puedes aclarar|puedes ampliar|a qu[eé] te refieres|pero dijiste|sin embargo|no exactamente|diferencia fundamental|volviendo a)\b/i;
const CHALLENGE_PATTERNS = /\b(?:that(?:'s| is) not|not the (?:main|fundamental|actual) difference|incorrect|are you sure|why would|but how|but why|I disagree|no es|esa no es|no exactamente|incorrect[oa]|est[aá]s seguro|pero c[oó]mo|pero por qu[eé]|diferencia fundamental)\b/i;
const PROHIBITED_ASSISTANCE_PATTERNS = [
  /\b(?:do not|don'?t|cannot|can'?t|must not|not allowed to)\s+(?:use|have)\s+(?:an?\s+)?(?:ai|artificial intelligence)(?:\s+assistant)?\b/i,
  /\b(?:ai|artificial intelligence)(?:\s+assistant)?\s+(?:is|are)\s+(?:not allowed|prohibited|forbidden)\b/i,
  /\b(?:using|use of)\s+(?:an?\s+)?(?:ai|artificial intelligence)(?:\s+assistant)?\s+(?:will|may)\s+(?:disqualify|reject|end)\b/i,
  /\b(?:no se permite|no puedes|no deben|est[aá] prohibido)\s+(?:usar|tener)?\s*(?:una?\s+)?(?:ia|inteligencia artificial)(?:\s+como asistente|\s+asistente)?\b/i,
  /\b(?:usar|el uso de)\s+(?:una?\s+)?(?:ia|inteligencia artificial)(?:\s+asistente)?\s+(?:te |los? )?(?:descalifica|rechaza|elimina)\b/i,
];

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTurns(transcript) {
  return (Array.isArray(transcript) ? transcript : [])
    .map((turn) => ({
      channel: String(turn && turn.channel || '').toLowerCase(),
      text: cleanText(turn && turn.text),
      ts: turn && turn.ts,
    }))
    .filter((turn) => (turn.channel === 'them' || turn.channel === 'you') && turn.text);
}

function isQuestionLike(value) {
  const text = cleanText(value);
  if (text.length < 6) return false;
  if (/\?\s*$/.test(text)) return true;
  return QUESTION_STARTERS.test(text) || QUESTION_PHRASES.test(text);
}

function getLatestSpeakerBlock(turns, channel, beforeIndex = turns.length) {
  let end = -1;
  for (let i = Math.min(beforeIndex, turns.length) - 1; i >= 0; i -= 1) {
    if (turns[i].channel === channel) { end = i; break; }
  }
  if (end < 0) return { text: '', start: -1, end: -1 };

  const parts = [];
  let start = end;
  for (let i = end; i >= 0 && parts.length < 8; i -= 1) {
    if (turns[i].channel !== channel) break;
    parts.unshift(turns[i].text);
    start = i;
    if (parts.join(' ').length > 900) break;
  }
  return { text: cleanText(parts.join(' ')).slice(-900), start, end };
}

function selectQuestionFromBlock(value) {
  const text = cleanText(value);
  if (!text) return '';

  // Prefer the last sentence that is visibly a question, while preserving a
  // short lead-in such as "and as a follow-up" when the block is small.
  const chunks = text.match(/[^?!.]+[?]|[^?!.]+[!.]?/g) || [text];
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    const chunk = cleanText(chunks[i]);
    if (isQuestionLike(chunk)) {
      if (text.length <= 360) return text;
      return chunk;
    }
  }
  return text;
}

function detectLanguage(value) {
  const text = ` ${cleanText(value).toLowerCase()} `;
  const spanishHits = (text.match(/\b(?:que|qué|cómo|cual|cuál|cuáles|por qué|dime|cuéntame|puedes|podrías|experiencia|entrevista|empresa|proyecto|datos|modelo|ventana|contexto|diferencia|trabajo|harías)\b/g) || []).length;
  const englishHits = (text.match(/\b(?:what|how|why|which|tell|explain|could|would|experience|interview|company|project|data|model|context|difference|work)\b/g) || []).length;
  if (spanishHits > englishHits) return 'es';
  if (englishHits > spanishHits) return 'en';
  return 'same-as-question';
}

function confidenceFor(value, explicit) {
  const text = cleanText(value);
  if (!text) return 'low';
  if (explicit && text.length >= 8) return /\?$/.test(text) ? 'high' : 'medium';
  if (/\?$/.test(text)) return 'high';
  if (isQuestionLike(text) && text.length >= 18) return 'medium';
  return 'low';
}

function extractSalaryFact(turns) {
  const salarySignal = /(?:salary|compensation|expect|target|range|million|mill[oó]n|millones|colones|d[oó]lares|usd|crc|₡|\$)/i;
  const numberSignal = /\d[\d.,]*/;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.channel === 'you' && salarySignal.test(turn.text) && numberSignal.test(turn.text)) {
      return turn.text.slice(0, 260);
    }
  }
  return '';
}

function detectProhibitedAssistance(turns) {
  const recentInterviewerText = turns
    .filter((turn) => turn.channel === 'them')
    .slice(-40)
    .map((turn) => turn.text)
    .join(' ');
  return PROHIBITED_ASSISTANCE_PATTERNS.some((pattern) => pattern.test(recentInterviewerText));
}

const TOPIC_STOP_WORDS = new Set([
  'what', 'which', 'how', 'why', 'when', 'where', 'would', 'could', 'should', 'about', 'that', 'this',
  'with', 'from', 'your', 'have', 'does', 'explain', 'tell', 'more', 'actual', 'really', 'between',
  'como', 'cómo', 'cual', 'cuál', 'cuales', 'cuáles', 'porque', 'por', 'para', 'sobre', 'esto', 'esta',
  'este', 'entre', 'puedes', 'podrias', 'podrías', 'explica', 'dime', 'cuentame', 'cuéntame',
]);

function topicTerms(value) {
  return cleanText(value).toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 5 && !TOPIC_STOP_WORDS.has(word));
}

function hasTopicOverlap(current, previous) {
  const currentTerms = new Set(topicTerms(current));
  const previousTerms = new Set(topicTerms(previous));
  const shared = [...currentTerms].filter((word) => previousTerms.has(word));
  return shared.length >= 2 || shared.some((word) => word.length >= 9);
}

function createQuestionFrame({ transcript, explicitQuestion = '' } = {}) {
  const turns = normalizeTurns(transcript);
  const latestThem = getLatestSpeakerBlock(turns, 'them');
  const explicit = cleanText(explicitQuestion);
  const exactQuestion = selectQuestionFromBlock(explicit || latestThem.text);
  const previousCandidate = latestThem.start >= 0
    ? getLatestSpeakerBlock(turns, 'you', latestThem.start)
    : getLatestSpeakerBlock(turns, 'you');
  const previousInterviewer = latestThem.start > 0
    ? getLatestSpeakerBlock(turns, 'them', previousCandidate.start >= 0 ? previousCandidate.start : latestThem.start)
    : { text: '' };
  const requiresResponse = explicit ? explicit.length >= 4 : isQuestionLike(exactQuestion);
  const hasPriorExchange = !!previousCandidate.text && !!previousInterviewer.text;
  const challengeToPriorAnswer = hasPriorExchange && CHALLENGE_PATTERNS.test(exactQuestion);
  const isFollowUp = hasPriorExchange && (
    FOLLOW_UP_PATTERNS.test(exactQuestion) ||
    challengeToPriorAnswer ||
    hasTopicOverlap(exactQuestion, previousInterviewer.text)
  );

  return {
    exactQuestion,
    confirmedByUser: !!explicit,
    language: detectLanguage(exactQuestion),
    confidence: confidenceFor(exactQuestion, !!explicit),
    requiresResponse,
    isFollowUp,
    challengeToPriorAnswer,
    candidateLastAnswer: isFollowUp ? previousCandidate.text.slice(-800) : '',
    previousQuestion: isFollowUp ? selectQuestionFromBlock(previousInterviewer.text).slice(-500) : '',
    prohibitedAssistance: detectProhibitedAssistance(turns),
    liveFacts: {
      salary: extractSalaryFact(turns),
    },
  };
}

module.exports = {
  createQuestionFrame,
  detectLanguage,
  isQuestionLike,
  selectQuestionFromBlock,
};
