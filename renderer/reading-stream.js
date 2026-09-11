(function (root) {
  // Commit only complete paragraphs outside fenced code. A committed block
  // never gets rebuilt when later tokens arrive.
  function splitBlocks(text, done = false) {
    const blocks = [];
    let start = 0, fenced = false;
    const lines = text.match(/.*(?:\n|$)/g) || [];
    let offset = 0;
    for (const line of lines) {
      if (/^\s*```/.test(line)) fenced = !fenced;
      offset += line.length;
      if (!fenced && /^\s*\n$/.test(line)) {
        const block = text.slice(start, offset).trimEnd();
        if (block) blocks.push(block);
        start = offset;
      }
    }
    const pending = text.slice(start);
    if (done && pending) blocks.push(pending);
    return { blocks, pending: done ? '' : pending };
  }
  const api = { splitBlocks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReadingStream = api;
})(typeof window !== 'undefined' ? window : globalThis);
