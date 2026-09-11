const test = require('node:test');
const assert = require('node:assert/strict');
const { splitBlocks } = require('../renderer/reading-stream');
const { MODES } = require('../src/prompts');

test('streamed paragraphs remain committed while the next section grows', () => {
  const first = '**Say now:** A clear answer.\n\n';
  for (const tail of ['*', '**How', '**How it works:** detail']) {
    assert.deepEqual(splitBlocks(first + tail), { blocks: ['**Say now:** A clear answer.'], pending: tail });
  }
});
test('blank lines inside code do not split code or lose indentation', () => {
  const code = '```python\nclass Solution:\n\n    def solve(self):\n        return 1\n```';
  assert.deepEqual(splitBlocks(code + '\n\nNext'), { blocks: [code], pending: 'Next' });
  assert.deepEqual(splitBlocks(code, true), { blocks: [code], pending: '' });
});
test('recovery requests use the selected answer, without capturing a new screen', () => {
  for (const mode of ['simplify', 'example']) {
    assert.equal(MODES[mode].needsScreen, false);
    assert.match(MODES[mode].build({ userText: 'Original answer', transcript: [] }), /Original answer/);
    assert.match(MODES[mode].buildSystem(), /not instructions/);
  }
});
