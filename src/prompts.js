// prompts.js — Feature definitions with interview-category-aware system prompts.
// ctx = { transcript, userText }
// System prompt receives the interview context block prepended by main.js,
// then optionally the user's AI rules appended at the end.

const { appendAiRules } = require('./profile-context');
const { formatInterviewMemory } = require('./interview-intelligence');

function formatTranscript(turns, limit) {
  const recent = limit ? turns.slice(-limit) : turns;
  return recent.map((t) => (t.channel === 'them' ? 'Them: ' : 'You: ') + t.text).join('\n');
}

function buildSystem(base, contextBlock) {
  if (!contextBlock) return base;
  return contextBlock + '\n\n' + base;
}

function formatQuestionFrame(frame) {
  if (!frame || !frame.exactQuestion) return '(No reliable current question was extracted.)';
  const liveFacts = frame.liveFacts || {};
  return [
    `Exact interviewer question: ${frame.exactQuestion}`,
    `Answer language: ${frame.language || 'same-as-question'}`,
    `Transcription confidence: ${frame.confidence || 'low'}`,
    `Follow-up: ${frame.isFollowUp ? 'yes' : 'no'}`,
    `Interviewer is challenging the prior answer: ${frame.challengeToPriorAnswer ? 'yes' : 'no'}`,
    `Answer intent: ${frame.intent || 'unknown'}`,
    frame.previousQuestion ? `Previous interviewer question: ${frame.previousQuestion}` : '',
    frame.candidateLastAnswer ? `Candidate's immediately prior answer: ${frame.candidateLastAnswer}` : '',
    liveFacts.salary ? `Verified live salary statement: ${liveFacts.salary}` : '',
  ].filter(Boolean).join('\n');
}

// Apply AI rules to a system prompt if the mode wants them. LeetCode returns
// the prompt unchanged — code answers should stay strict regardless of how the
// user wants the AI to chat.
function applyRules(prompt, aiRules, mode) {
  if (mode === 'leetcode') return prompt;
  return appendAiRules(prompt, aiRules);
}

const BASE_RULES =
  'Answer in the language of the exact interviewer question. Preserve standard English technical terms when that is natural. ' +
  'Treat the live interview as the most current source of truth, ahead of saved profile fields. ' +
  'Never invent an employer, project, tool, metric, salary, responsibility, or result. ';

const LIVE_ANSWER_DEPTH =
  '\n\nDepth and length:\n' +
  '• Do not default to a short summary. Give the candidate enough substance to answer confidently without needing an immediate follow-up expansion.\n' +
  '• For substantive interview questions, aim for 100–180 words, roughly 45–90 seconds spoken.\n' +
  '• Behavioral, experience, and situational answers may use 120–200 words when needed for a complete story or decision process.\n' +
  '• Technical answers should explain what it is, how or why it works, one concrete example, and an important trade-off or limitation.\n' +
  '• Motivation and general interview answers should develop 2–3 specific supporting points instead of stopping after the headline.\n' +
  '• Only truly simple logistical or compensation questions should be shorter, and even those should be 2–4 useful sentences.\n' +
  '• Do not pad, repeat yourself, or invent facts; every sentence must add useful detail.';

const RESCUE_CARD_RULES =
  'Produce a live rescue card that is easy to scan while speaking.\n' +
  'Write the candidate-facing wording in first person so it can be said out loud without rewriting.\n' +
  'Use exactly this shape:\n' +
  '**Say now:** a complete spoken answer, beginning with one strong sentence the candidate can start immediately so streaming is useful from the first line.\n' +
  '**Anchors:** 3–5 short bullets containing the essential points from the full answer as glanceable reminders.\n' +
  'Add **Bridge:** only for time_to_think or clarification intent. It must buy a few seconds without evading the question.\n' +
  'Add **If challenged:** one corrective sentence only when challengeToPriorAnswer is yes.\n' +
  'For technical questions, explain the fundamental distinction, how or why it works, one concrete example, and the trade-off or limitation. Do not merely echo the candidate\'s prior claim when it is wrong.\n' +
  'No preamble or generic self-promotion.' + LIVE_ANSWER_DEPTH;

const MODES = {

  // ── Assist: one-shot "do the smart thing" ─────────────────────────────────
  assist: {
    needsScreen: true,
    userBubble: null,
    small: false,
    resumeMode: 'assist',
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are cue, a discreet real-time copilot overlaid on the user\'s screen during an interview or coding session. ' +
        BASE_RULES +
        'Look at the screenshot and the current question frame, decide what the user needs RIGHT NOW, and deliver it directly with no preamble.\n\n' +
        'Use verified STAR material for behavioral questions, explicit profile reasons for motivation, live facts for compensation, and the fundamental distinction plus trade-off for technical questions.\n\n' +
        RESCUE_CARD_RULES,
        contextBlock
      ), aiRules, 'assist');
    },
    build(ctx) {
      const t = formatTranscript(ctx.transcript, 8);
      return 'CURRENT QUESTION FRAME:\n' + formatQuestionFrame(ctx.questionFrame) +
        '\n\nVERIFIED LIVE MEMORY (quoted candidate statements with provenance):\n' + formatInterviewMemory(ctx.interviewMemory) +
        '\n\nRecent supporting conversation:\n' + (t || '(none)') +
        '\n\nCreate the rescue card for what I need right now.';
    }
  },

  // ── Say: what to say next ──────────────────────────────────────────────────
  say: {
    needsScreen: false,
    userBubble: 'What should I say?',
    small: false,
    resumeMode: 'say',
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are cue, producing a precise rescue card during a live interview. ' +
        BASE_RULES +
        '"Them" is the interviewer; "You" is the candidate. Focus on the exact current question, not the general topic of the interview.\n\n' +
        RESCUE_CARD_RULES,
        contextBlock
      ), aiRules, 'say');
    },
    build(ctx) {
      const t = formatTranscript(ctx.transcript, 8);
      return 'CURRENT QUESTION FRAME:\n' + formatQuestionFrame(ctx.questionFrame) +
        '\n\nVERIFIED LIVE MEMORY (live statements override saved profile):\n' + formatInterviewMemory(ctx.interviewMemory) +
        '\n\nOnly use these recent turns as supporting evidence:\n' + (t || '(none)') +
        '\n\nReturn the rescue card for the exact question above.';
    }
  },

  // ── Follow-up questions ────────────────────────────────────────────────────
  followup: {
    needsScreen: false,
    userBubble: 'Follow-up questions',
    small: true,
    resumeMode: 'followup',
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are cue. Suggest 2–4 sharp follow-up questions the candidate could ask the interviewer.\n' +
        'Base them on what was discussed and the candidate\'s background/target role.\n' +
        'Good follow-ups: show genuine curiosity, demonstrate research, highlight the candidate\'s strengths, or uncover role details.\n' +
        'Return as a bullet list only. No preamble.',
        contextBlock
      ), aiRules, 'followup');
    },
    build(ctx) {
      const t = formatTranscript(ctx.transcript, 20);
      return 'Conversation so far:\n' + (t || '(none)') + '\n\nSuggest follow-up questions for the interviewer.';
    }
  },

  // ── Recap ──────────────────────────────────────────────────────────────────
  recap: {
    needsScreen: false,
    userBubble: 'Recap',
    small: true,
    resumeMode: 'recap',
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are cue. Summarize the interview so far:\n' +
        '• Topics covered\n• Questions asked\n• Key answers given\n• Any red flags or areas to strengthen\n' +
        'Use short bullets under bold headers. Be concise.',
        contextBlock
      ), aiRules, 'recap');
    },
    build(ctx) {
      const t = formatTranscript(ctx.transcript, 0);
      return 'Full interview transcript:\n' + (t || '(nothing captured yet)') + '\n\nRecap this interview.';
    }
  },

  // ── Ask: free-form question ────────────────────────────────────────────────
  ask: {
    needsScreen: true,
    userBubble: null,
    small: false,
    resumeMode: 'ask',
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are cue, a real-time copilot with access to the candidate\'s screen and live interview. ' +
        BASE_RULES +
        'Answer the question directly and thoroughly, matching depth to complexity. ' +
        'When the question is about the candidate\'s background, use their actual experience. ' +
        'When the question is conceptual, explain clearly with examples and relevant trade-offs. For substantive questions, provide enough detail for a complete answer rather than a brief summary. No preamble.',
        contextBlock
      ), aiRules, 'ask');
    },
    build(ctx) {
      const t = formatTranscript(ctx.transcript, 12);
      return (t ? 'Recent conversation:\n' + t + '\n\n' : '') + 'Question: ' + ctx.userText;
    }
  },

  // ── Answer This: answer one specific transcript question ─────────────────
  answerThis: {
    needsScreen: false,
    userBubble: null,   // bubble set dynamically from the question text
    small: false,
    resumeMode: 'say',  // same context budget as 'say'
    buildSystem(contextBlock, aiRules) {
      return applyRules(buildSystem(
        'You are cue, producing a rescue card for ONE confirmed interview question. ' +
        BASE_RULES +
        'Focus ONLY on the confirmed question in the QuestionFrame. Use the prior answer only to correct or extend it on a follow-up.\n\n' +
        RESCUE_CARD_RULES,
        contextBlock
      ), aiRules, 'answerThis');
    },
    build(ctx) {
      return 'CONFIRMED QUESTION FRAME:\n' + formatQuestionFrame(ctx.questionFrame) +
        '\n\nVERIFIED LIVE MEMORY:\n' + formatInterviewMemory(ctx.interviewMemory) +
        '\n\nReturn the rescue card for this question only.';
    }
  },

  // ── LeetCode: pure coding solver — no personal context, no AI rules ─────
  leetcode: {
    needsScreen: true,
    userBubble: 'Solve what\'s on screen',
    small: false,
    resumeMode: 'leetcode',
    buildSystem(_contextBlock, _aiRules) {
      // Context block AND aiRules intentionally ignored — code answers must
      // stay strict regardless of personal style or context.
      return 'You are an expert competitive programmer. The screenshot contains a coding problem. ' +
        'Respond with: (1) a one-line restatement, (2) a short approach, (3) a clean, correct, idiomatic solution in a fenced code block ' +
        '(use the language shown on screen, else Python), (4) time and space complexity. Keep prose tight.';
    },
    build() { return 'Solve the coding problem shown in the screenshot.'; }
  }
};

module.exports = { MODES, formatTranscript, formatQuestionFrame };
