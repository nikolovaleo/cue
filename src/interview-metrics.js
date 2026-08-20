const fs = require('node:fs');
const path = require('node:path');

function createInterviewMetrics(filePath) {
  const target = String(filePath || '');

  function append(record) {
    if (!target) return false;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.appendFileSync(target, `${JSON.stringify({ ...record, recordedAt: Date.now() })}\n`, 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }

  return {
    filePath: target,
    recordResponse(metric) {
      return append({ type: 'response', ...metric });
    },
    recordFeedback(responseId, useful) {
      if (!responseId || typeof useful !== 'boolean') return false;
      return append({ type: 'feedback', responseId: String(responseId), useful });
    },
  };
}

module.exports = { createInterviewMetrics };
