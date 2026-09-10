// popup.js
'use strict';

document.getElementById('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.runtime.sendMessage({ type: 'getStatus' }, (res) => {
  const el = document.getElementById('status');
  if (!res) {
    el.innerHTML = '⚠ 无法连接扩展后台。';
    return;
  }
  if (res.configured) {
    el.innerHTML =
      '<span class="ok">✓ 已配置</span> · ' +
      '<b>' + escapeHtml(res.model) + '</b><br>' +
      '<span style="color:#8a8f99">' + escapeHtml(res.baseUrl) + '</span>';
  } else {
    el.innerHTML = '<span class="warn">⚠ 尚未配置 API Key</span>，请点击下方按钮前往设置。';
  }
});

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}