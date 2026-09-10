import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../background.js', import.meta.url), 'utf8');

function loadBackground(contents, fetchImpl) {
  let calls = 0;
  const context = {
    chrome: {
      storage: {
        sync: {
          get: async () => ({
            apiKey: 'test-key',
            baseUrl: 'https://example.test/v1',
            model: 'deepseek-chat',
            name: NAME,
            closing: CLOSING,
            profile: '示例经历：X 年产品经验；负责过 Y 项目，把 Z 指标从 A 提升到 B'
          })
        }
      },
      runtime: {
        onMessage: { addListener() {} },
        openOptionsPage() {}
      }
    },
    fetch: fetchImpl || (async () => {
      const content = contents[Math.min(calls, contents.length - 1)];
      calls += 1;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: typeof content === 'string' ? { content } : content }]
        })
      };
    })
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, getCalls: () => calls };
}

// 测试用的通用占位身份（不涉及任何真实个人信息）
const NAME = '张三';
const CLOSING = '有作品集可发，期待您的回复～';

const finalIntro = '您好，我是张三，对您这个岗位方向很感兴趣。我有 X 年互联网产品经验，其中 Y 年专注 AI 与 Agent 产品，擅长把 AI 想法推进为真正上线、能够交付的生产系统。曾在某医疗互联网公司参与 AI 导购从 0 到 1 落地，将推荐准确率从 67% 提升到 95%；在某 To B Agent 平台负责优化迭代，并行交付 2 个客户定制项目。相关项目覆盖 To C 与 To B 场景，有作品集可发，期待您的回复～';

test('retries when model content contains reasoning and returns only the final introduction', async () => {
  const leaked = '我们需要回答用户。要求直接输出自我介绍正文，不要解释标题符号。需要根据素材，先写一个草稿。';
  const { context, getCalls } = loadBackground([leaked, finalIntro]);

  const result = await context.generateIntroLogic({ title: 'AI产品经理', desc: '负责Agent产品落地' });

  assert.equal(getCalls(), 2);
  assert.equal(result.intro, finalIntro);
});

test('blocks the response when reasoning is still exposed after retrying', async () => {
  const leaked = '我们需要回答用户。先分析岗位要求，然后输出草稿：您好，我是张三。字数还需要确认。';
  const { context, getCalls } = loadBackground([leaked]);

  const result = await context.generateIntroLogic({ title: 'AI产品经理', desc: '负责Agent产品落地' });

  assert.equal(getCalls(), 2);
  assert.equal(result.intro, undefined);
  assert.match(result.error, /思考过程/);
});

test('ignores a separate reasoning_content field when final content is clean', async () => {
  const { context, getCalls } = loadBackground([{
    reasoning_content: '这里是内部分析，不应展示。',
    content: finalIntro
  }]);

  const result = await context.generateIntroLogic({ title: 'AI产品经理', desc: '负责Agent产品落地' });

  assert.equal(getCalls(), 1);
  assert.equal(result.intro, finalIntro);
});

test('falls back to a broadly compatible request when the full request is reset', async () => {
  const calls = [];
  const { context } = loadBackground([], async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.messages[0].role === 'system') {
      throw new TypeError('Failed to fetch');
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: finalIntro } }] })
    };
  });

  const result = await context.generateIntroLogic({ title: 'AI产品经理', desc: '负责Agent产品落地' });

  assert.equal(result.intro, finalIntro);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages[0].role, 'user');
  assert.equal(calls[1].temperature, undefined);
});

test('retries without the system role when the model rejects it with HTTP 400', async () => {
  const calls = [];
  const { context } = loadBackground([], async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.messages[0].role === 'system') {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: { message: 'system role is not supported' } })
      };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: finalIntro } }] })
    };
  });

  const result = await context.generateIntroLogic({ title: 'AI产品经理', desc: '负责Agent产品落地' });

  assert.equal(result.intro, finalIntro);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages[0].role, 'user');
  assert.equal(calls[1].temperature, undefined);
});

test('surfaces the provider message when the compatible retry also fails', async () => {
  const calls = [];
  const { context } = loadBackground([], async (url, options) => {
    calls.push(JSON.parse(options.body));
    return {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: { message: 'model not found' } })
    };
  });

  const result = await context.generateIntroLogic({ title: 'AI产品经理', desc: '负责Agent产品落地' });

  assert.equal(result.intro, undefined);
  assert.match(result.error, /model not found/);
  assert.equal(calls.length, 2);
});

// 用户真实遇到过的泄漏形态：模型以「用户现在需要…」开头自述，
// 中间反复出现「您好，我是张三」并夹杂字数/素材/润色等口吻。
const scratchpadWithDrafts = [
  '用户现在需要给张三写产品经理的自我介绍，首先开头要保留那个意思，然后结合岗位是具身智能、物理AI云、B端巡检相关的。',
  '然后看候选人的素材：近6年互联网产品，2年AI/Agent经验。等下要控制字数150-220，要自然，不要模板，还要贴合岗位的需求。',
  '哦对，公司未知所以不用提公司。然后组织语言：',
  '您好，我是张三，对您这个具身智能巡检、物理AI云方向的B端产品岗位很感兴趣。我近6年做互联网产品，其中2年深耕AI/Agent领域，有完整的ToC医疗导购、ToB Agent平台从0到1落地经验。曾在某医疗互联网公司负责AI医疗导购项目，把推荐准确率从67%提升到95%；在某To B Agent平台主导功能迭代，还并行交付过2个B端客户的AI Agent定制化项目，擅长把AI产品想法落地成可交付的生产系统，能快速适配创新AI业务的迭代节奏，有作品集可发，期待您的回复～',
  '等下数下字数，大概多少？哦差不多，调整下更自然，不要太生硬。对，还要注意不要有模板腔。'
].join('\n');

test('salvages the final draft instead of failing when the model leaks its scratchpad', async () => {
  const { context, getCalls } = loadBackground([scratchpadWithDrafts]);

  const result = await context.generateIntroLogic({ title: 'AI产品经理', desc: '具身智能巡检、物理AI云方向的B端产品' });

  assert.equal(getCalls(), 1, 'a salvageable draft should not need a retry');
  assert.equal(result.cleaned, true, 'the result should be flagged as cleaned');
  assert.match(result.intro, /^您好，我是张三/);
  assert.match(result.intro, /有作品集可发，期待您的回复～$/);
  // 抢救出的正文必须不含任何草稿痕迹
  assert.doesNotMatch(result.intro, /字数|素材|候选人|润色|哦对|等下/);
  // 且只有一个开口
  assert.equal((result.intro.match(/您好，我是张三/g) || []).length, 1);
});

test('still blocks the output when the scratchpad contains no usable final draft', async () => {
  const noDraft = '用户现在需要写自我介绍。先看候选人的素材，字数要控制在150-220。然后组织语言，但还没想好开头。';
  const { context, getCalls } = loadBackground([noDraft]);

  const result = await context.generateIntroLogic({ title: 'AI产品经理', desc: '负责Agent产品落地' });

  assert.equal(getCalls(), 2);
  assert.equal(result.intro, undefined);
  assert.match(result.error, /思考过程/);
});
