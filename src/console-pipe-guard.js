// Electron GUI apps can outlive the terminal or launcher that supplied their
// stdout/stderr handles. On Windows, a later console.log() then emits EPIPE on
// the underlying socket; without an error listener Node treats that as an
// uncaught exception and terminates the app.

const guardedStreams = new WeakSet();

function guardWritableStream(stream) {
  if (!stream || typeof stream.on !== 'function' || guardedStreams.has(stream)) return false;
  // Diagnostic output is best-effort. A logging destination failure must never
  // bring down the overlay, regardless of the specific stream error code.
  stream.on('error', () => {});
  guardedStreams.add(stream);
  return true;
}

function guardProcessPipes(stdout = process.stdout, stderr = process.stderr) {
  guardWritableStream(stdout);
  guardWritableStream(stderr);
}

module.exports = { guardWritableStream, guardProcessPipes };
