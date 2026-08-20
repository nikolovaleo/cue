const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const builder = require('../electron-builder.cjs');
const pkg = require('../package.json');

test('defines an explicit Windows x64 package target', () => {
  assert.equal(pkg.scripts['pack:win'], 'electron-builder --win --dir');
  assert.equal(pkg.scripts['dist:win'], 'electron-builder --win');
  assert.deepEqual(builder.win.target, [{ target: 'nsis', arch: ['x64'] }]);
});

test('ships every runtime directory in packaged builds', () => {
  assert.ok(builder.files.includes('main.js'));
  assert.ok(builder.files.includes('preload.js'));
  assert.ok(builder.files.includes('src/**/*'));
  assert.ok(builder.files.includes('renderer/**/*'));
});

test('Windows display capture grants Electron loopback audio by name', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /streams\.audio\s*=\s*['"]loopback['"]/);
  assert.doesNotMatch(main, /\.audio\s*=\s*true/);
});

test('mic and system AudioWorklets stay connected to muted graph sinks', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  assert.match(renderer, /micWorklet\.connect\(micSink\)/);
  assert.match(renderer, /micSink\.gain\.value\s*=\s*0/);
  assert.match(renderer, /sysWorklet\.connect\(sysSink\)/);
  assert.match(renderer, /sysSink\.gain\.value\s*=\s*0/);
});

test('frameless window exposes persistent resize support', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(main, /resizable:\s*true/);
  assert.match(main, /minWidth:\s*MIN_W/);
  assert.match(main, /ipcMain\.on\(['"]window:resize['"]/);
  assert.match(main, /Math\.min\(Math\.round\(width\),\s*workArea\.width\)/);
  assert.match(main, /win\.setBounds\(\{\s*x:\s*nextX/);
  assert.match(preload, /resizeWindow/);
  assert.match(html, /id="resize-grip"/);
  assert.match(html, /class="resize-handle resize-edge resize-edge-right"/);
  assert.match(html, /class="resize-handle resize-edge resize-edge-bottom"/);
  assert.match(html, /<span>Adjust<\/span>/);
});

test('responsive layout wraps actions and constrains settings to the viewport', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  assert.match(css, /#panel-wrap\s*\{[^}]*width:\s*100%/s);
  assert.doesNotMatch(css, /#panel-wrap\s*\{[^}]*width:\s*min\(624px,\s*100%\)/s);
  assert.match(css, /\.resize-edge-right\s*\{[^}]*cursor:\s*ew-resize/s);
  assert.match(css, /\.resize-edge-bottom\s*\{[^}]*cursor:\s*ns-resize/s);
  assert.match(css, /#resize-grip\s*\{[^}]*min-width:\s*92px/s);
  assert.match(css, /#action-row\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(css, /#settings\s*\{[^}]*height:\s*min\(720px,\s*100%\)/s);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(css, /\.transcript-sidebar\s*\{[^}]*width:\s*min\(360px,\s*calc\(100vw\s*-\s*24px\)\)/s);
});

test('toolbar close button forwards quit from renderer to the main process', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.match(html, /id=["']quit-btn["']/);
  assert.match(renderer, /\$\(['"]#quit-btn['"]\)\.addEventListener\(['"]click['"],\s*\(\)\s*=>\s*cue\.quit\(\)\)/);
  assert.match(preload, /quit:\s*\(\)\s*=>\s*ipcRenderer\.send\(['"]app:quit['"]\)/);
  assert.match(main, /ipcMain\.on\(['"]app:quit['"],\s*\(\)\s*=>\s*app\.quit\(\)\)/);
});

test('toolbar Drag region cannot fall through to the window behind it', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');

  assert.match(main, /ipcMain\.on\(['"]mouse:regions['"]/);
  assert.match(main, /screen\.getCursorScreenPoint\(\)/);
  assert.match(main, /setInterval\(syncWindowMouseIgnoreState,\s*16\)/);
  assert.match(main, /mouseIgnoreRequested\s*&&\s*!cursorIsInProtectedMouseRegion\(\)/);
  assert.match(preload, /setProtectedMouseRegions/);
  assert.match(renderer, /toolbar\.getBoundingClientRect\(\)/);
  assert.match(renderer, /setIgnore\(false\);\s*\/\/ start interactive/);
  assert.match(css, /\.drag-pill\s*\{[^}]*min-height:\s*34px[^}]*padding:\s*7px 14px/s);
});
