const { createQuestionFrame } = require('./question-frame');
const { detectCategory } = require('./interview-context');
const { buildInterviewMemory, inferIntent } = require('./interview-intelligence');

function replayInterview(events, { responseLatencyMs = 2500 } = {}) {
  const transcript = [];
  const requests = [];
  let active = null;

  for (const event of [...(events || [])].sort((a, b) => a.at - b.at)) {
    if (event.type === 'turn') {
      transcript.push({ channel: event.channel, text: event.text, ts: event.at });
      continue;
    }
    if (event.type !== 'request') continue;

    if (active && event.at < active.completesAt) active.supersededAt = event.at;
    const frame = createQuestionFrame({
      transcript,
      explicitQuestion: event.mode === 'answerThis' ? event.text || '' : '',
    });
    const category = detectCategory(frame);
    frame.intent = inferIntent(frame, category);
    const decision = frame.prohibitedAssistance
      ? 'paused'
      : !frame.requiresResponse ? 'listen'
        : frame.confidence === 'low' && event.mode !== 'answerThis' ? 'confirm'
          : 'answer';
    active = {
      id: event.id || `request-${requests.length + 1}`,
      at: event.at,
      completesAt: event.at + responseLatencyMs,
      supersededAt: null,
      frame,
      category,
      intent: frame.intent,
      decision,
      memory: buildInterviewMemory(transcript),
    };
    requests.push(active);
  }

  return {
    transcript,
    requests,
    answered: requests.filter((request) => request.decision === 'answer').length,
    avoided: requests.filter((request) => request.decision !== 'answer').length,
    superseded: requests.filter((request) => request.supersededAt != null).length,
  };
}

module.exports = { replayInterview };
