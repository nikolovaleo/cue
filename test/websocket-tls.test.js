const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWebSocketTlsOptions } = require('../src/websocket-tls');

test('Windows trust augments bundled roots and retains certificate verification', () => {
  let reads = 0;
  const options = createWebSocketTlsOptions({ platform: 'win32', extraCaFile: '',
    defaultRoots: () => ['bundled'], readRoots: () => { reads++; return 'windows-root'; } });
  assert.deepEqual(options(), { ca: ['bundled', 'windows-root'], rejectUnauthorized: true });
  options().ca.push('untrusted');
  assert.deepEqual(options().ca, ['bundled', 'windows-root']);
  assert.equal(reads, 1);
});

test('a failed trust store read fails closed and may be retried', () => {
  let reads = 0;
  const options = createWebSocketTlsOptions({ platform: 'win32', extraCaFile: '',
    defaultRoots: () => [], readRoots: () => {
      if (++reads === 1) throw new Error('store unavailable');
      return 'trusted';
    } });
  assert.throws(options, /store unavailable/);
  assert.equal(options().rejectUnauthorized, true);
});

test('other platforms retain their existing TLS defaults', () => {
  const options = createWebSocketTlsOptions({ platform: 'darwin',
    readRoots: () => { throw new Error('must not run'); } });
  assert.deepEqual(options(), {});
});
