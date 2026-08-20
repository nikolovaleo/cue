const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { guardWritableStream, guardProcessPipes } = require('../src/console-pipe-guard');

test('a closed stdout pipe cannot crash the app with EPIPE', () => {
  const stdout = new EventEmitter();
  assert.equal(guardWritableStream(stdout), true);
  assert.doesNotThrow(() => stdout.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' })));
});

test('console stream guards are idempotent', () => {
  const stream = new EventEmitter();
  guardWritableStream(stream);
  assert.equal(guardWritableStream(stream), false);
  assert.equal(stream.listenerCount('error'), 1);
});

test('both process output streams are guarded', () => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  guardProcessPipes(stdout, stderr);
  assert.equal(stdout.listenerCount('error'), 1);
  assert.equal(stderr.listenerCount('error'), 1);
});
