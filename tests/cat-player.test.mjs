import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadCatPlayer(devicePixelRatio = 1) {
  const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  const start = source.indexOf("const MOTIONS = ['idle'");
  const end = source.indexOf('// ---------- 猫猫 UI ----------');
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  let imageIndex = 0;
  const images = [];
  class FakeImage {
    constructor() {
      this.complete = imageIndex === 0;
      this.naturalWidth = this.complete ? 320 : 0;
      this.naturalHeight = this.complete ? 426 : 0;
      this.listeners = {};
      images.push(this);
      imageIndex += 1;
    }

    addEventListener(type, listener) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(listener);
    }

    emit(type) {
      for (const listener of this.listeners[type] || []) listener();
    }
  }

  const drawing = {
    clears: 0,
    draws: 0,
    transform: null,
    clearRect() { this.clears += 1; },
    drawImage() { this.draws += 1; },
    setTransform(...args) { this.transform = args; }
  };
  const canvas = {
    className: '',
    style: {},
    setAttribute() {},
    getContext() { return drawing; }
  };
  const context = {
    Image: FakeImage,
    chrome: { runtime: { getURL: (path) => path } },
    document: { createElement: () => canvas },
    window: { devicePixelRatio },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {}
  };

  const playerSource = source.slice(start, end)
    + '\n;globalThis.__catPlayer = { createCatPlayer };';
  vm.runInNewContext(playerSource, context);
  return { createCatPlayer: context.__catPlayer.createCatPlayer, canvas, drawing, images };
}

test('uses a high-resolution canvas backing store on Retina displays', () => {
  const { createCatPlayer, canvas, drawing } = loadCatPlayer(2);
  createCatPlayer('idle', 80);

  assert.equal(canvas.style.width, '80px');
  assert.equal(canvas.style.height, '107px');
  assert.equal(canvas.width, 160);
  assert.equal(canvas.height, 214);
  assert.deepEqual(drawing.transform, [2, 0, 0, 2, 0, 0]);
});

test('uses the 136px player as the single persistent state cat', () => {
  const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  assert.match(source, /fabCat = createCatPlayer\('idle', 136\)/);
  assert.doesNotMatch(source, /panelCat = createCatPlayer/);
  assert.match(source, /stateDock/);
  assert.match(source, /stateCatWrap/);
});

test('uses a strict grayscale card palette without blue or yellow UI colors', () => {
  const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  const ui = source.slice(source.indexOf('const css ='));
  assert.match(ui, /#F7F7F7/i);
  assert.match(ui, /#1D1D1B/i);
  assert.doesNotMatch(ui, /#1f4f8f|#2b6cb0|#cfe0f5|#23314a|#5a6b85|#eef3f9/i);
  assert.doesNotMatch(ui, /#f6ad2b|#e3d6b5|#fff8e8|#fff6de|rgba\(246,173,43/i);
  assert.match(ui, /border-bottom: 1px solid #ECECEC/i);
});

test('removes decorative emoji while preserving existing wording', () => {
  const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  const ui = source.slice(source.indexOf('const css ='));
  assert.doesNotMatch(ui, /[⚙✕↻🔧🎉📦✨✓⚠⏳❌🐾]/u);
  assert.match(ui, /一键生成自我介绍/);
  assert.match(ui, /重新抓取页面内容/);
  assert.match(ui, /猫猫已抓取岗位描述/);
  assert.match(ui, /给咪师父点赞并复制/);
});

test('keeps the speech bubble above the floating cat', () => {
  const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  const ui = source.slice(source.indexOf('const css ='));
  assert.match(ui, /#\$\{ASSET_ID\}-fab \{[\s\S]*?flex-direction: column; align-items: center;/);
  assert.match(ui, /#\$\{ASSET_ID\}-bubble \{[\s\S]*?border: 2px solid #1D1D1B;/);
  assert.match(ui, /\.bih-bubble-tail \{/);
  assert.match(ui, /\.bih-bubble-tail::after \{/);
  assert.match(source, /bih-bubble-text/);
});

test('keeps the last frame visible while the next motion is still loading', () => {
  const { createCatPlayer, canvas, drawing } = loadCatPlayer();
  createCatPlayer('idle', 80);
  assert.equal(drawing.draws, 1, 'the ready idle frame should be visible');

  drawing.clears = 0;
  drawing.draws = 0;
  canvas.__setMotion('drill');

  assert.equal(drawing.clears, 0, 'an unloaded frame must not clear the canvas');
  assert.equal(drawing.draws, 0);
});

test('redraws the selected motion when its first frame finishes loading', () => {
  const { createCatPlayer, drawing, images } = loadCatPlayer();
  const canvas = createCatPlayer('idle', 80);
  drawing.draws = 0;

  canvas.__setMotion('drill');
  assert.equal(drawing.draws, 0);

  const drillFirstFrame = images[73];
  drillFirstFrame.complete = true;
  drillFirstFrame.naturalWidth = 320;
  drillFirstFrame.naturalHeight = 426;
  drillFirstFrame.emit('load');

  assert.equal(drawing.draws, 1, 'the loaded first frame should replace the old motion');
});

test('plays delivery once and returns to the completed hand state', () => {
  const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  assert.match(source, /canvas\.__playOnce = \(m, done\) =>/);
  assert.match(source, /fabCat\.__playOnce\('delivery', \(\) => \{/);
  assert.match(source, /setPanelMotion\('hand', '好耶，打磨完成~'\)/);
  assert.match(source, /animStatus\.textContent = '复制成功啦~客官下次再来！'/);
  assert.match(source, /copyBtn\.textContent = '给咪师父点赞并复制'/);
});

function loadSettingsOpener(openOptionsPage) {
  const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function openSettingsPage()');
  const end = source.indexOf('function setPanelMotion', start);
  assert.notEqual(start, -1, 'content script should define a direct settings opener');
  assert.notEqual(end, -1);

  const status = { textContent: '' };
  const context = {
    chrome: { runtime: { openOptionsPage } },
    document: { getElementById: () => status }
  };
  vm.runInNewContext(
    "const ASSET_ID = 'boss-intro-helper';\n" + source.slice(start, end)
      + '\n;globalThis.__openSettingsPage = openSettingsPage;',
    context
  );
  return { openSettingsPage: context.__openSettingsPage, status };
}

test('opens the options page directly without depending on a background message', async () => {
  let calls = 0;
  const { openSettingsPage } = loadSettingsOpener(async () => { calls += 1; });

  await openSettingsPage();

  assert.equal(calls, 1);
});

test('shows a refresh hint when the extension context is stale', async () => {
  const { openSettingsPage, status } = loadSettingsOpener(async () => {
    throw new Error('Extension context invalidated.');
  });

  await openSettingsPage();

  assert.match(status.textContent, /刷新页面/);
});
