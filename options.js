// options.js - 设置页逻辑
'use strict';

const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  // 留空：由使用者填写自己的真实信息（生成时只会使用这些事实，不会编造）
  name: '',
  closing: '有作品集可发，期待您的回复～',
  profile: ''
};

function $(id) { return document.getElementById(id); }

async function load() {
  const raw = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  for (const k of Object.keys(DEFAULTS)) {
    const v = (raw[k] !== undefined && raw[k] !== '') ? raw[k] : DEFAULTS[k];
    $(k).value = v;
  }
}

function readFormSettings() {
  return {
    apiKey: $('apiKey').value.trim(),
    baseUrl: $('baseUrl').value.trim() || DEFAULTS.baseUrl,
    model: $('model').value.trim() || DEFAULTS.model,
    name: $('name').value.trim() || DEFAULTS.name,
    closing: $('closing').value.trim() || DEFAULTS.closing,
    profile: $('profile').value
  };
}

async function ensureApiPermission(baseUrl) {
  try {
    const url = new URL(baseUrl);
    const origin = url.origin + '/*';
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (has) return { granted: true, origin: url.origin };
    const granted = await chrome.permissions.request({ origins: [origin] });
    return { granted, origin: url.origin };
  } catch (e) {
    return { granted: false, error: 'API 地址格式不正确。' };
  }
}

async function save() {
  const data = readFormSettings();
  const access = await ensureApiPermission(data.baseUrl);
  if (!access.granted) {
    flash(access.error || ('浏览器未授权访问该 API 域名：' + access.origin), '#d9333a');
    return;
  }

  await chrome.storage.sync.set(data);
  flash('✓ 已保存');
}

function flash(msg, color) {
  const el = $('save-status');
  el.textContent = msg;
  el.style.color = color || '#00a99d';
  setTimeout(() => { el.textContent = ''; }, 5000);
}

async function test() {
  const status = $('save-status');
  const btn = $('test');
  btn.disabled = true;
  status.textContent = '测试中…';
  status.style.color = '#4e5969';

  const data = readFormSettings();
  if (!data.apiKey) {
    status.textContent = '请先填写 API Key';
    status.style.color = '#d9333a';
    btn.disabled = false;
    return;
  }

  const access = await ensureApiPermission(data.baseUrl);
  if (!access.granted) {
    status.textContent = access.error || ('浏览器未授权访问该 API 域名：' + access.origin);
    status.style.color = '#d9333a';
    btn.disabled = false;
    return;
  }

  const result = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'testConnection', settings: data }, (response) => {
      const err = chrome.runtime.lastError;
      resolve(err ? { error: err.message } : (response || { error: '后台没有返回结果。' }));
    });
  });

  if (result.error) {
    status.textContent = '✗ ' + result.error;
    status.style.color = '#d9333a';
  } else {
    await chrome.storage.sync.set(data);
    status.textContent = '✓ 连接成功，设置已保存，模型回复：' + (result.reply || '(空)');
    status.style.color = '#00a99d';
  }
  btn.disabled = false;
}

document.getElementById('save').addEventListener('click', save);
document.getElementById('test').addEventListener('click', test);

document.querySelectorAll('.preset').forEach((p) => {
  p.addEventListener('click', () => {
    $('baseUrl').value = p.dataset.url;
    $('model').value = p.dataset.model;
  });
});

load();
