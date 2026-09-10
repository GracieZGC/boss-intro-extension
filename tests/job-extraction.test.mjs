import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const contentSource = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const start = contentSource.indexOf('function extractJobData');
const end = contentSource.indexOf('function findDescByHeading');
const context = {};
if (start !== -1 && end !== -1) {
  vm.runInNewContext(contentSource.slice(start, end) + '\n;globalThis.extractJobData = extractJobData;', context);
}
const extractJobData = context.extractJobData || (() => ({ desc: '', company: '' }));

const pageText = `微信扫码分享\n举报\n职位描述\nB端产品\nFDE 工程师（医疗、教育、企业方向）\n岗位描述：\n1、深入客户业务流程，识别适合智能体落地的场景。\n任职资格：\n1、本科及以上学历。\n唐女士\n刚刚活跃\n360集团\n·\nHR\n竞争力分析\n公司介绍\n360公司致力于成为中国领先的互联网和安全服务提供商。\n工商信息\n公司名称\n北京三六零数智科技有限公司\n工作地址\n北京朝阳区360大厦四层\n点击查看地图\n更多职位\nAI产品经理`;

test('limits captured job text from job description through the work address', () => {
  const result = extractJobData(pageText);

  assert.match(result.desc, /^职位描述/);
  assert.match(result.desc, /公司介绍\n360公司致力于成为中国领先的互联网和安全服务提供商/);
  assert.match(result.desc, /工商信息\n公司名称\n北京三六零数智科技有限公司/);
  assert.match(result.desc, /工作地址\n北京朝阳区360大厦四层$/);
  assert.doesNotMatch(result.desc, /唐女士|刚刚活跃|竞争力分析|更多职位|AI产品经理/);
});

test('extracts the company name for the introduction prompt', () => {
  const result = extractJobData(pageText);

  assert.equal(result.company, '360集团');
});

test('recognizes spaced headings from the rendered BOSS page', () => {
  const result = extractJobData(pageText.replace('职位描述', '职位描 述'));

  assert.match(result.desc, /^职位描 述/);
  assert.match(result.desc, /公司介绍/);
  assert.match(result.desc, /工商信息/);
});

test('excludes recruiter details when BOSS combines them onto single lines', () => {
  const combinedRecruiterText = pageText
    .replace('唐女士\n刚刚活跃', '唐女士 刚刚活跃')
    .replace('360集团\n·\nHR', '360集团 · HR');
  const result = extractJobData(combinedRecruiterText);

  assert.doesNotMatch(result.desc, /唐女士|刚刚活跃|360集团\n·\nHR/);
  assert.match(result.desc, /公司介绍/);
  assert.equal(result.company, '360集团');
});

test('passes the extracted company name to generation', () => {
  assert.match(contentSource, /const company = document\.getElementById\(ASSET_ID \+ '-desc'\)\.dataset\.company \|\| ''/);
  const backgroundSource = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  assert.match(backgroundSource, /const \{ title, desc, company \} = args \|\| \{\};/);
  assert.match(backgroundSource, /公司名称：/);
});
