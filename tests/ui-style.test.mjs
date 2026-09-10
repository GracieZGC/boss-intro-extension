import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');

test('uses a strict grayscale palette without yellow accents', () => {
  assert.doesNotMatch(source, /#(?:1f4f8f|2b6cb0|cfe0f5|23314a|5a6b85|cfd9e6|eef3f9|d8e2ee|f8fafc|fffaf2|ffd9a8)/i);
  assert.doesNotMatch(source, /linear-gradient\(/i);
  assert.match(source, /background: #1D1D1B/i);
  assert.doesNotMatch(source, /#(?:f6ad2b|e3d6b5|fff8e8|fff6de)/i);
  assert.doesNotMatch(source, /rgba\(246,173,43/i);
  assert.match(source, /border-bottom: 1px solid #ECECEC/i);
});

test('keeps interface copy free of emoji glyphs', () => {
  assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u);
});

test('uses text labels for utility controls and a concise primary action', () => {
  assert.match(source, />设置<\/button>/);
  assert.match(source, />关闭<\/button>/);
  assert.match(source, />重新抓取页面内容<\/button>/);
  assert.match(source, />一键生成自我介绍<\/button>/);
  assert.match(source, /岗位描述 \/ 任职要求\/公司信息/);
});

test('places the speech bubble above the cat with a comic tail', () => {
  assert.match(source, /display: flex; flex-direction: column; align-items: center;/);
  assert.match(source, /border: 2px solid #1D1D1B/);
  assert.match(source, /border-radius: 36px/);
  assert.match(source, /\.bih-bubble-tail \{/);
  assert.match(source, /width: 10px; height: 10px;[\s\S]*?border: 2px solid #1D1D1B; border-radius: 50%/);
  assert.match(source, /\.bih-bubble-tail::after \{/);
  assert.match(source, /background: #fff; border: 2px solid #1D1D1B; border-radius: 50%/);
  assert.match(source, /left: 68px; bottom: -15px/);
  assert.doesNotMatch(source, /box-shadow: 17px 17px 0 -2px #1D1D1B/);
  assert.doesNotMatch(source, /rotate\(45deg\)/);
});

test('places the single state cat outside the panel with its label above', () => {
  assert.match(source, /#\$\{ASSET_ID\}-state-dock \{/);
  assert.match(source, /position: fixed;/);
  assert.match(source, /pointer-events: none;/);
  assert.match(source, /\.bih-state-label \{/);
  assert.match(source, /stateDock\.style\.display = 'flex'/);
  assert.match(source, /stateDock\.style\.display = 'none'/);
  assert.match(source, /stateCatWrap\.appendChild\(fabCat\)/);
  assert.match(source, /document\.getElementById\(ASSET_ID \+ '-catwrap'\)\.appendChild\(fabCat\)/);
});

test('aligns the state cat with the job description card and keeps a tight left-edge gap', () => {
  assert.match(source, /const dockWidth = 136;/);
  assert.match(source, /const gap = 0;/);
  assert.match(source, /const visualRightInset = 68;/);
  assert.match(source, /const horizontalOffset = -16;/);
  assert.match(source, /const verticalOffset = 20;/);
  assert.match(source, /const descRect = document\.getElementById\(ASSET_ID \+ '-desc'\)\.getBoundingClientRect\(\)/);
  assert.match(source, /const left = Math\.max\(8, rect\.left - dockWidth - gap \+ visualRightInset \+ horizontalOffset\)/);
  assert.match(source, /const top = Math\.max\(8, descRect\.top \+ verticalOffset\)/);
});

test('shows a tilde in every cat state label', () => {
  assert.match(source, /'喵师傅已就位~'/);
  assert.match(source, /'钻钻钻，打磨中~'/);
  assert.match(source, /'好耶，打磨完成~'/);
  assert.match(source, /复制成功啦~客官下次再来！/);
});
