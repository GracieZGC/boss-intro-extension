import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('tests custom API settings through the background and saves them after success', async () => {
  const source = readFileSync(new URL('../options.js', import.meta.url), 'utf8');
  const listeners = {};
  const elements = {};
  const values = {
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    model: 'test-model',
    name: '张三',
    closing: '有作品集可发，期待您的回复～',
    profile: '真实经历'
  };
  for (const id of [...Object.keys(values), 'save', 'test', 'save-status']) {
    elements[id] = {
      value: values[id] || '',
      disabled: false,
      textContent: '',
      style: {},
      addEventListener(type, handler) { listeners[id + ':' + type] = handler; }
    };
  }

  let requestedOrigin = '';
  let sentMessage;
  let savedSettings;
  const context = {
    URL,
    setTimeout() { return 1; },
    document: {
      getElementById(id) { return elements[id]; },
      querySelectorAll() { return []; }
    },
    chrome: {
      storage: {
        sync: {
          get: async () => values,
          set: async (data) => { savedSettings = data; }
        }
      },
      permissions: {
        contains: async () => false,
        request: async ({ origins }) => {
          requestedOrigin = origins[0];
          return true;
        }
      },
      runtime: {
        sendMessage(message, callback) {
          sentMessage = message;
          callback({ reply: '正常' });
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  await Promise.resolve();
  await listeners['test:click']();

  assert.equal(requestedOrigin, 'https://api.example.com/*');
  assert.equal(sentMessage.type, 'testConnection');
  assert.equal(sentMessage.settings.baseUrl, values.baseUrl);
  assert.equal(savedSettings.baseUrl, values.baseUrl);
  assert.match(elements['save-status'].textContent, /连接成功/);
});

test('handles connection tests in the same background context used for generation', async () => {
  const source = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
  let messageListener;
  let requestedUrl = '';
  const context = {
    chrome: {
      storage: { sync: { get: async () => ({}) } },
      runtime: {
        onMessage: { addListener(handler) { messageListener = handler; } },
        openOptionsPage() {}
      }
    },
    fetch: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '正常' } }] })
      };
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  let response;
  const keepsChannelOpen = messageListener({
    type: 'testConnection',
    settings: {
      apiKey: 'test-key',
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model'
    }
  }, {}, (value) => { response = value; });

  assert.equal(keepsChannelOpen, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requestedUrl, 'https://api.example.com/v1/chat/completions');
  assert.equal(response.reply, '正常');
});
