import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function backgroundAlpha(frame) {
  const output = execFileSync('ffmpeg', [
    '-v', 'error',
    '-i', new URL(`../assets/frames/idle/${frame}`, import.meta.url).pathname,
    '-vf', 'format=rgba,alphaextract,crop=40:40:280:0,signalstats,metadata=print:file=-',
    '-frames:v', '1',
    '-f', 'null',
    '-'
  ], { encoding: 'utf8' });
  const match = output.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  assert.ok(match, `missing alpha measurement for ${frame}`);
  return Number(match[1]);
}

test('idle frames keep the empty background transparent', () => {
  const baseline = backgroundAlpha('f_068.png');
  const suspect = backgroundAlpha('f_069.png');

  assert.ok(
    suspect <= baseline + 1,
    `f_069.png background alpha ${suspect} exceeds baseline ${baseline}`
  );
});

test('hand frames come from the raised-hand completion motion', () => {
  const hash = (frame) => createHash('sha1')
    .update(readFileSync(new URL(`../assets/frames/hand/${frame}`, import.meta.url)))
    .digest('hex');

  assert.equal(hash('f_000.png'), 'b473772748f35cdc4838b1832db1812b41ccd66e');
  assert.equal(hash('f_011.png'), 'e28a14f4be5c65d34f78cb86c2235560992d83bb');
});
