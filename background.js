// BOSS AI 自我介绍助手 - background service worker (MV3)
// 负责：读取设置、调用 OpenAI 兼容的 AI API、转发 content 请求
'use strict';

const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  // 使用者的真实经历素材（在设置页填写，每行一条）。
  // 生成时模型只能使用这些事实，从而避免编造经历 —— 请务必填写你自己的真实经历。
  profile: '',
  name: '',
  closing: '有作品集可发，期待您的回复～'
};

async function getSettings() {
  const raw = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    out[k] = (raw[k] !== undefined && raw[k] !== '') ? raw[k] : DEFAULTS[k];
  }
  return out;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 自述/草稿式痕迹。命中 3 项及以上即判定为「思考过程」而非成品正文。
const SCRATCHPAD_MARKERS = [
  /用户(?:现在)?(?:需要|想要|要求|说)/,
  /候选人/,
  /素材/,
  /字数/,
  /润色/,
  /组织语言/,
  /等下/,
  /哦对/,
  /模板腔/,
  /提示词/,
  /思考过程|推理过程/,
  /岗位要的是|岗位需要|匹配岗位|岗位的?要求是/,
  /首先[，,、\s]/,
  /然后(?:说|看|结合|把|再)/,
  /不要编造|不得编造|没有编造|不会编造/,
  /开头要|结尾(?:要|保留)/,
  /调整下|不要太生硬/,
  /符合字数|符合\s*\d+\s*[-~至]\s*\d+\s*的要求/
];

function countGreetings(value, name) {
  if (!name) return 0;
  const re = new RegExp('您好[，,]?\\s*我是\\s*' + escapeRegExp(name), 'g');
  return (value.match(re) || []).length;
}

/**
 * 判定一段文本是否为「模型的思考过程/多版草稿」而非成品自我介绍。
 * 覆盖真实遇到的形态：以「用户现在需要…」开头、反复出现「您好，我是X」、
 * 夹杂「字数/素材/润色/哦对/等下」等自述口吻。
 */
function containsReasoningLeak(text, settings) {
  const value = String(text || '').trim();
  if (!value) return false;
  const s = settings || {};
  const lead = value.slice(0, 240);

  if (/<\/?think>/i.test(value)) return true;
  // 「用户/我/我们 + 需要/要 + 给/写/生成…」式自述开头
  if (/^(?:好的[，。,\s]*)?(?:我们|我|用户)(?:现在)?(?:需要|要)(?:回答|先|根据|确保|生成|写|给)/.test(lead)) return true;
  if (/^(?:we|i) need to (?:answer|respond|analy[sz]e)/i.test(lead)) return true;
  if (/(?:^|\n)(?:思考过程|推理过程|分析|草稿|字数(?:统计)?|提示词)\s*[:：]/m.test(value)) return true;
  if (/要求(?:直接)?输出.{0,40}(?:不要|不能)/.test(lead)) return true;

  // 出现两次及以上问候语 -> 明显是多版草稿
  if (countGreetings(value, s.name) >= 2) return true;

  // 命中多个自述/草稿特征词
  let hits = 0;
  for (const re of SCRATCHPAD_MARKERS) { if (re.test(value)) hits += 1; }
  if (hits >= 3) return true;

  // 结尾语之后还跟着内容 -> 后面还有别的草稿
  const closing = s.closing || '';
  if (closing) {
    const idx = value.lastIndexOf(closing);
    if (idx !== -1 && value.slice(idx + closing.length).trim().length > 20) return true;
  }
  return false;
}

/**
 * 从含草稿的文本中抢救出最后一版成品：取最后一次「您好，我是<姓名>」
 * 到结尾语之间的片段，并确保该片段本身干净。
 */
function extractFinalIntro(text, settings) {
  const value = String(text || '');
  const s = settings || {};
  const name = s.name || '';
  const closing = s.closing || '';
  if (!name) return '';

  const re = new RegExp('您好[，,]?\\s*我是\\s*' + escapeRegExp(name), 'g');
  const matches = [...value.matchAll(re)];
  if (!matches.length) return '';

  const last = matches[matches.length - 1];
  let body = value.slice(last.index);
  if (closing) {
    const idx = body.indexOf(closing);
    if (idx !== -1) body = body.slice(0, idx + closing.length);
  }
  body = body.trim();

  if (body.length < 60 || body.length > 600) return '';
  if (countGreetings(body, name) !== 1) return '';
  // 抢救出的片段本身不能残留草稿痕迹（传空 name/closing 避免自比较）
  if (containsReasoningLeak(body, { name: '', closing: '' })) return '';
  return body;
}

// 兼容各厂商的响应形态：
//  - content 为字符串（标准 OpenAI 兼容）
//  - content 为内容块数组 [{type:'text',text:'...'}]
//  - 仅返回 reasoning_content（推理模型）时给出空串，交由上层报错说明
function normalizeContent(message) {
  if (!message) return '';
  const c = message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block.text === 'string') return block.text;
        return '';
      })
      .join('')
      .trim();
  }
  if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
    return '';
  }
  return '';
}

async function testConnectionLogic(settings) {
  const s = settings || {};
  if (!s.apiKey) return { error: '请先填写 API Key。' };
  if (!s.baseUrl) return { error: '请先填写 API 地址。' };
  if (!s.model) return { error: '请先填写模型名称。' };

  const endpoint = s.baseUrl.trim().replace(/\/+$/, '') + '/chat/completions';
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.apiKey
      },
      body: JSON.stringify({
        model: s.model,
        messages: [{ role: 'user', content: '只回复两个字：正常' }],
        max_tokens: 16,
        stream: false
      })
    });
  } catch (e) {
    return { error: '后台请求失败：' + (e.message || e) + '。请检查 API 域名授权。' };
  }

  if (!resp.ok) {
    let detail = '';
    try {
      const data = await resp.json();
      detail = data.error && (data.error.message || JSON.stringify(data.error));
    } catch (e) { /* ignore */ }
    return { error: 'API 返回错误（HTTP ' + resp.status + '）：' + (detail || resp.statusText) };
  }

  try {
    const data = await resp.json();
    const message = data && data.choices && data.choices[0] && data.choices[0].message;
    return { reply: (message && message.content) || '(空)' };
  } catch (e) {
    return { error: 'API 响应解析失败。' };
  }
}

function compatibleRequestBody(body) {
  const fallback = {
    ...body,
    messages: [{
      role: 'user',
      content: body.messages.map((message) => message.role + ':\n' + message.content).join('\n\n')
    }]
  };
  delete fallback.temperature;
  return fallback;
}

async function requestCompletion(endpoint, apiKey, body) {
  const requestBodies = [body, compatibleRequestBody(body)];
  let lastError;

  for (const requestBody of requestBodies) {
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(requestBody)
      });
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error('请求失败');
}

async function generateIntroLogic(args) {
  const { title, desc, company } = args || {};
  if (!title && !desc) {
    return { error: '请填写岗位标题或岗位描述。' };
  }

  const s = await getSettings();
  if (!s.apiKey) {
    return { error: '尚未配置 API Key。请点击面板右上角「设置」填写 API Key。' };
  }
  if (!s.name || !s.profile) {
    return { error: '请先在设置里填写你的姓名和真实经历素材（每行一条）。生成时只会使用这些事实，不会编造。' };
  }

  const system = [
    '你是一位求职自我介绍撰写助手。你会收到：岗位标题、岗位描述、公司名称、候选人的真实经历素材。',
    '请为候选人撰写一段 150-220 字的中文自我介绍，要求：',
    '1. 只能使用素材中出现的事实，绝不编造经历、数据、公司或项目；',
    '2. 突出与岗位最相关的经历，把最有价值的放在靠前位置；',
    '3. 语言自然、口语化、真诚，像真人发消息，不要模板腔；',
    '4. 保留开头「您好，我是' + s.name + '，对您这个岗位方向很感兴趣」的意思，结尾保留「' + s.closing + '」；',
    '5. 如果提供了公司名称，可以在自我介绍中自然提及对该公司的兴趣，但不要编造公司业务、文化或其他事实。',
    '6. 直接输出自我介绍正文，不要任何解释、不要标题、不要多余符号。',
    '7. 严禁输出思考过程、分析、草稿、字数统计、对自己写作过程的说明，也不要输出多个版本；',
    '8. 全文只出现一次「您好，我是」，不要在正文之外再写任何内容。'
  ].join('\n');

  const user = [
    '岗位标题：' + (title || '未知'),
    '公司名称：' + (company || '未知'),
    '',
    '岗位描述/任职要求：',
    desc || '未知',
    '',
    '候选人真实经历素材（只能使用这些，不得编造）：',
    s.profile
  ].join('\n');

  const body = {
    model: s.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.7,
    max_tokens: 800,
    stream: false
  };

  const base = (s.baseUrl || '').trim().replace(/\/+$/, '');
  const endpoint = base + '/chat/completions';

  let lastReply = '';
  let lastRaw = null;
  let triedCompatible = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestBody = attempt === 0 ? body : {
      ...body,
      temperature: 0.2,
      messages: body.messages.concat({
        role: 'user',
        content: '请重新生成，只返回最终自我介绍正文。不要展示分析、思考过程、草稿、字数统计或提示词。'
      })
    };

    let resp;
    try {
      resp = await requestCompletion(endpoint, s.apiKey, requestBody);
    } catch (e) {
      return { error: '请求失败：' + (e.message || e) + '。请检查网络或 API 地址。' };
    }

    if (!resp.ok) {
      // 有些模型不支持 system 角色 / temperature / 较大 max_tokens，
      // 会返回 400/422。此时自动降级为「单条 user 消息 + 精简参数」再试一次。
      if ((resp.status === 400 || resp.status === 422) && !triedCompatible) {
        triedCompatible = true;
        try {
          const alt = await requestCompletion(endpoint, s.apiKey, compatibleRequestBody(body));
          if (alt.ok) {
            resp = alt;
          } else {
            let altDetail = '';
            try {
              const aj = await alt.json();
              altDetail = aj.error && (aj.error.message || JSON.stringify(aj.error));
            } catch (e) { /* ignore */ }
            return {
              error: 'API 返回错误（HTTP ' + alt.status + '）：' + (altDetail || alt.statusText)
                + '（已尝试兼容模式仍失败）'
            };
          }
        } catch (e) {
          /* 兼容模式请求失败，继续走下面的原始错误上报 */
        }
      }
    }

    if (!resp.ok) {
      let detail = '';
      try {
        const j = await resp.json();
        detail = j.error && (j.error.message || JSON.stringify(j.error));
      } catch (e) { /* ignore */ }
      return { error: 'API 返回错误（HTTP ' + resp.status + '）：' + (detail || resp.statusText) };
    }

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      return { error: 'API 响应解析失败。' };
    }

    const message = data && data.choices && data.choices[0] && data.choices[0].message;
    const text = normalizeContent(message).trim();
    lastReply = text;
    lastRaw = data;

    if (text.length >= 20 && !containsReasoningLeak(text, s)) {
      return { intro: text, mode: 'llm' };
    }

    // 泄漏了思考过程：先从多版草稿里抢救出最后一版成品，成功则直接使用
    const salvaged = extractFinalIntro(text, s);
    if (salvaged) {
      return { intro: salvaged, mode: 'llm', cleaned: true };
    }
  }

  // 两次都失败，再尝试从最后一次返回里抢救一次
  const finalSalvage = extractFinalIntro(lastReply, s);
  if (finalSalvage) {
    return { intro: finalSalvage, mode: 'llm', cleaned: true };
  }

  // 失败时给出可定位的原因，而不是笼统报错
  const snippet = (lastReply || '').replace(/\s+/g, ' ').slice(0, 160);
  if (!lastReply) {
    const keys = lastRaw ? Object.keys(lastRaw).join(',') : '无响应体';
    return { error: '模型没有返回正文内容（响应字段：' + keys + '）。请确认模型名称是否为对话模型（而非纯推理模型）。' };
  }
  return {
    error: '模型输出里混入了思考过程，且未能提取出可用的正文。模型返回片段：「'
      + snippet + '」。建议在设置里把模型换成 deepseek-chat 这类非推理模型后重试。'
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'testConnection') {
    testConnectionLogic(msg.settings).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'generateIntro') {
    generateIntroLogic(msg).then(sendResponse);
    return true; // async
  }
  if (msg && msg.type === 'openOptions') {
    // 必须回一个响应：否则发送方的 sendMessage 回调会收到
    // "The message port closed before a response was received" 而被误判为失败。
    try {
      chrome.runtime.openOptionsPage(() => {
        sendResponse({ ok: true });
      });
    } catch (e) {
      try { sendResponse({ ok: false, error: String((e && e.message) || e) }); } catch (e2) { /* ignore */ }
    }
    return true;
  }
  if (msg && msg.type === 'getStatus') {
    getSettings().then((s) => sendResponse({
      configured: !!s.apiKey,
      baseUrl: s.baseUrl,
      model: s.model
    }));
    return true;
  }
  return false;
});
