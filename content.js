// BOSS AI 自我介绍助手 - content script（小猫修理工 · 帧动画版）
// 负责：读取岗位页面 DOM、注入猫猫浮动按钮和面板、帧序列动画、与 background 通信
(() => {
  'use strict';

  // 不再使用全局 window 守卫：扩展重新加载后旧页面仍会重新注入脚本，
  // 全局守卫会导致 ensureFab / buildPanel 完全不执行，猫咪消失。
  // ensureFab 内的 document.body.contains(fab) 已足够防重复创建。

  // ---------- 岗位信息抓取 ----------

  const TITLE_SELECTORS = [
    '.job-title',
    '.job-primary .name',
    '[class*="job-title"]',
    '[class*="JobTitle"]',
    '.boss-position-name',
    '.position-name',
    'h1',
    '[class*="position-title"]',
    '[class*="jobName"]'
  ];

  const DESC_SELECTORS = [
    '#job-detail',
    '.job-detail',
    '[class*="job-detail"]',
    '[class*="jobDescription"]',
    '[class*="job-description"]',
    '.job-sec-text',
    '.job-sec',
    '[class*="job-intro"]',
    '[class*="jobIntro"]',
    '.text',
    '.job-desc',
    '[class*="position-description"]',
    '[class*="detail-basicinfo"]'
  ];

  function cleanText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '')
      .replace(/\u200b/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join('\n')
      .trim();
  }

  function cleanTitle(s) {
    return (s || '')
      .replace(/^\d+[Kk]-\d+[Kk]·\d+薪\s*/g, '')
      .replace(/^\d+[Kk]-\d+[Kk]\s*/g, '')
      .trim();
  }

  function extractJobData(rawText) {
    const lines = String(rawText || '')
      .replace(/\u200b/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/^查看全部$/.test(line) && !/^\[查看全部\]/.test(line));
    const heading = (line) => line.replace(/\s+/g, '');
    const start = lines.findIndex((line) => /^职位描述(?:[：:]|$)/.test(heading(line)));
    if (start === -1) return { desc: '', company: '' };

    const addressIndex = lines.findIndex((line, index) => index >= start && /^工作地址(?:[：:]|$)/.test(heading(line)));
    const competitionIndex = lines.findIndex((line, index) => index > start && heading(line) === '竞争力分析');
    const hrIndex = lines.findIndex((line, index) => index > start && /(?:^|·\s*)HR$/.test(line));
    const recruiterIndex = hrIndex === -1 ? -1 : (lines[hrIndex - 1] === '·' ? hrIndex - 2 : hrIndex - 1);
    const activeIndex = lines.findIndex((line, index) => index > start && /刚刚活跃|在线/.test(line));
    const recruiterStart = activeIndex > start
      ? (lines[activeIndex] === '刚刚活跃' || lines[activeIndex] === '在线' ? activeIndex - 1 : activeIndex)
      : recruiterIndex;
    const companyIndex = lines.findIndex((line, index) => index > start && heading(line) === '公司介绍');
    const businessIndex = lines.findIndex((line, index) => index > start && heading(line) === '工商信息');
    const boundaries = [competitionIndex, recruiterStart, companyIndex, businessIndex, addressIndex].filter((index) => index !== -1);
    const jobEnd = boundaries.length ? Math.min(...boundaries) : lines.length;
    const jobLines = lines.slice(start, jobEnd);
    if (companyIndex !== -1 && (addressIndex === -1 || companyIndex < addressIndex)) {
      const companyEnd = businessIndex !== -1 && businessIndex > companyIndex ? businessIndex : addressIndex;
      jobLines.push(...lines.slice(companyIndex, companyEnd === -1 ? lines.length : companyEnd));
    }
    if (businessIndex !== -1 && (addressIndex === -1 || businessIndex < addressIndex)) {
      jobLines.push(...lines.slice(businessIndex, addressIndex === -1 ? lines.length : addressIndex));
    }
    if (addressIndex !== -1) {
      jobLines.push(lines[addressIndex]);
      if (!/[：:]/.test(lines[addressIndex]) && lines[addressIndex + 1]) jobLines.push(lines[addressIndex + 1]);
    }

    let company = '';
    if (hrIndex !== -1) {
      const inlineCompany = lines[hrIndex].match(/^(.+?)\s*·\s*HR$/);
      if (inlineCompany) company = inlineCompany[1].trim();
      for (let i = hrIndex - 1; i >= 0; i--) {
        if (!company && lines[i] !== '·') { company = lines[i]; break; }
      }
    }
    return { desc: jobLines.join('\n'), company };
  }

  function findDescByHeading() {
    const keywords = ['职位描述', '岗位职责', '任职要求', '岗位要求', '岗位介绍', '职责描述'];
    const nodes = document.querySelectorAll('h1,h2,h3,h4,span,div,p,[class*="title"]');
    for (const n of nodes) {
      const t = (n.textContent || '').trim();
      if (t.length > 2 && t.length < 30 && keywords.some((k) => t.includes(k))) {
        let cur = n.parentElement;
        for (let i = 0; i < 5 && cur; i++) {
          const txt = cleanText(cur);
          if (txt.length > 60) return cur;
          cur = cur.parentElement;
        }
      }
    }
    return null;
  }

  function grabJob() {
    let title = '';
    for (const sel of TITLE_SELECTORS) {
      const el = document.querySelector(sel);
      const t = cleanTitle(cleanText(el).split('\n')[0]);
      if (t && t.length >= 2 && t.length <= 40) { title = t; break; }
    }

    let desc = '';
    for (const sel of DESC_SELECTORS) {
      const el = document.querySelector(sel);
      const t = cleanText(el);
      if (t && t.length >= 40) { desc = t; break; }
    }

    const scoped = extractJobData(cleanText(document.body));
    if (scoped.desc) desc = scoped.desc;

    if (!desc) {
      const head = findDescByHeading();
      if (head) desc = cleanText(head);
    }

    if (!desc) {
      let best = '';
      const all = document.querySelectorAll('div,section,article,li,p');
      for (const el of all) {
        const t = cleanText(el);
        if (t.length > best.length && t.length >= 40 && t.length < 6000) best = t;
      }
      desc = best;
    }

    const lines = desc.split('\n');
    const dedup = [];
    for (const l of lines) if (!dedup.includes(l)) dedup.push(l);
    desc = dedup.join('\n');

    return { title, desc, company: scoped.company };
  }

  // ---------- 帧动画播放器 ----------
  const MOTIONS = ['idle', 'drill', 'hand', 'delivery'];
  // idle 用 20fps 完整动作（73帧），其余 12fps（12帧）
  const FRAME_COUNT = { idle: 73, drill: 12, hand: 12, delivery: 12 };
  const FRAME_MS = { idle: 50, drill: 85, hand: 85, delivery: 85 };

  function frameUrl(motion, i) {
    const n = String(i).padStart(3, '0');
    return chrome.runtime.getURL('assets/frames/' + motion + '/f_' + n + '.png');
  }

  // 预加载全部动作的帧到 Image 缓存，避免播放时解码闪帧
  const frameCache = {};
  function preloadMotion(motion) {
    if (frameCache[motion]) return frameCache[motion];
    const arr = [];
    for (let i = 0; i < FRAME_COUNT[motion]; i++) {
      const im = new Image();
      im.src = frameUrl(motion, i);
      arr.push(im);
    }
    frameCache[motion] = arr;
    return arr;
  }

  // 用 <canvas> 播放帧动画：连续绘制不出现中间空白透底（解决"背景闪过"）
  function createCatPlayer(motion, sizePx) {
    let frames = preloadMotion(motion);
    // 取帧的自然尺寸（第一帧加载后可知），作为 canvas 逻辑尺寸
    const canvas = document.createElement('canvas');
    canvas.className = 'bih-cat-img';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '小猫修理工');
    let nw = sizePx;
    let nh = Math.round(sizePx * (426 / 320));
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(nw * pixelRatio);
    canvas.height = Math.round(nh * pixelRatio);
    canvas.style.width = nw + 'px';
    canvas.style.height = nh + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    let idx = 0;
    let dir = 1;  // 1=正向, -1=倒向 -> ping-pong
    let raf = null;
    let alive = true;
    let lastTime = 0;
    let acc = 0;
    let playMode = 'loop';
    let onComplete = null;

    const draw = (i) => {
      const im = frames[i];
      if (!im.complete || im.naturalWidth <= 0) return;
      const iw = im.naturalWidth || 320;
      const ih = im.naturalHeight || 426;
      // 按 canvas 尺寸等比绘制
      ctx.clearRect(0, 0, nw, nh);
      const scale = Math.min(nw / iw, nh / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (nw - dw) / 2;
      const dy = (nh - dh) / 2;
      ctx.drawImage(im, dx, dy, dw, dh);
    };
    const boundFrames = new WeakSet();
    const bindFrameLoad = (im) => {
      if (!im || boundFrames.has(im) || typeof im.addEventListener !== 'function') return;
      boundFrames.add(im);
      im.addEventListener('load', () => {
        if (alive && frames[idx] === im) draw(idx);
      });
    };
    frames.forEach(bindFrameLoad);
    draw(0);

    const tick = (ts) => {
      if (!alive) return;
      if (lastTime === 0) lastTime = ts;
      const dt = ts - lastTime;
      lastTime = ts;
      acc += dt;
      const ms = FRAME_MS[motion];
      // 按累积时间推进（支持变速）
      if (acc >= ms) {
        acc = acc % ms;
        const fs = frames;
        const lastIdx = fs.length - 1;
        if (playMode === 'once') {
          if (idx < lastIdx) {
            idx += 1;
            draw(idx);
          } else {
            playMode = 'hold';
            const done = onComplete;
            onComplete = null;
            if (done) done();
          }
        } else if (playMode === 'loop') {
          idx += dir;
          if (idx >= lastIdx) { idx = lastIdx; dir = -1; }
          else if (idx <= 0) { idx = 0; dir = 1; }
          draw(idx);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    canvas.__setMotion = (m) => {
      motion = m;
      preloadMotion(m);
      frames = frameCache[m];
      frames.forEach(bindFrameLoad);
      idx = 0;
      dir = 1;
      acc = 0;
      playMode = 'loop';
      onComplete = null;
      draw(0);
    };
    canvas.__playOnce = (m, done) => {
      motion = m;
      preloadMotion(m);
      frames = frameCache[m];
      frames.forEach(bindFrameLoad);
      idx = 0;
      dir = 1;
      acc = 0;
      playMode = 'once';
      onComplete = typeof done === 'function' ? done : null;
      draw(0);
    };
    canvas.__stop = () => { alive = false; if (raf) cancelAnimationFrame(raf); };
    return canvas;
  }

  // ---------- 猫猫 UI ----------
  const ASSET_ID = 'boss-intro-helper';
  let panel = null;
  let fab = null;
  let fabCat = null;
  let stateDock = null;
  let stateCatWrap = null;

  const css = `
    #${ASSET_ID}-fab {
      position: fixed; right: 20px; bottom: 90px; z-index: 2147483646;
      display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer;
      font-family: system-ui, -apple-system, sans-serif; user-select: none;
    }
    #${ASSET_ID}-bubble {
      background: #fff; border: 2px solid #1D1D1B;
      border-radius: 36px;
      padding: 11px 18px; font-size: 13px; color: #1D1D1B; font-weight: 600;
      box-shadow: 0 8px 24px rgba(29,29,27,.12); white-space: nowrap;
      position: relative; max-width: 260px; text-align: center; z-index: 1;
      transition: opacity .3s, transform .3s;
    }
    #${ASSET_ID}-bubble::before {
      content: ''; position: absolute; inset: 0 14px; pointer-events: none;
      background:
        radial-gradient(circle at 12px 0, #fff 0 10px, transparent 10.5px) 0 0 / 32px 18px repeat-x,
        radial-gradient(circle at 12px 18px, #fff 0 10px, transparent 10.5px) 0 100% / 32px 18px repeat-x;
      border-radius: 36px; z-index: 0;
    }
    #${ASSET_ID} .bih-bubble-text { position: relative; z-index: 1; }
    .bih-bubble-tail {
      position: absolute; left: 68px; bottom: -15px; width: 10px; height: 10px;
      background: #fff; border: 2px solid #1D1D1B; border-radius: 50%;
      pointer-events: none;
    }
    .bih-bubble-tail::after {
      content: ''; position: absolute; left: -2px; top: 17px; width: 6px; height: 6px;
      background: #fff; border: 2px solid #1D1D1B; border-radius: 50%;
    }
    #${ASSET_ID}-catwrap {
      flex-shrink: 0; display: block; position: relative; line-height: 0;
      transition: transform .2s;
    }
    #${ASSET_ID}-catwrap .bih-cat-img {
      width: 136px; height: auto; display: block; margin: 0;
      filter: drop-shadow(0 4px 10px rgba(0,0,0,.18));
    }
    #${ASSET_ID}-fab:hover #${ASSET_ID}-catwrap { transform: scale(1.08); }
    #${ASSET_ID}-fab:active #${ASSET_ID}-catwrap { transform: scale(.96); }

    #${ASSET_ID}-state-dock {
      position: fixed; z-index: 2147483647; width: 136px;
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      pointer-events: none; font-family: system-ui, -apple-system, sans-serif;
    }
    #${ASSET_ID}-state-dock .bih-state-label {
      color: #1D1D1B; background: #fff; border: 1px solid #D6D6D6;
      border-radius: 14px; padding: 4px 10px; font-size: 12px; line-height: 1.2;
      white-space: nowrap; box-shadow: 0 4px 12px rgba(29,29,27,.1);
    }
    #${ASSET_ID}-state-dock .bih-state-catwrap { line-height: 0; }
    #${ASSET_ID}-state-dock .bih-cat-img { width: 136px; height: auto; display: block; }

    #${ASSET_ID} {
      position: fixed; right: 20px; bottom: 190px; z-index: 2147483647;
      width: 500px; max-width: calc(100vw - 40px); max-height: calc(100vh - 210px);
      background: #F7F7F7; color: #1D1D1B; border-radius: 12px;
      box-shadow: 0 18px 50px rgba(29,29,27,.18);
      font-family: system-ui, -apple-system, sans-serif;
      display: flex; flex-direction: column; overflow: hidden;
      border: 1px solid #E1E1E1;
    }
    #${ASSET_ID} .bih-head {
      background: #fff;
      display: flex; align-items: center; gap: 14px; padding: 15px 18px;
      border-bottom: 1px solid #ECECEC;
    }
    #${ASSET_ID} .bih-headcat {
      flex-shrink: 0; position: relative; line-height: 0;
      display: block;
    }
    #${ASSET_ID} .bih-headcat .bih-cat-img { width: 44px; height: auto; display: block; }
    #${ASSET_ID} .bih-titlebox { line-height: 1.4; color: #1D1D1B; }
    #${ASSET_ID} .bih-head b { font-size: 16px; letter-spacing: 0; }
    #${ASSET_ID} .bih-head .bih-sub { font-size: 12px; color: #707070; }
    #${ASSET_ID} .bih-right { margin-left: auto; display: flex; gap: 8px; align-items: center; }
    #${ASSET_ID} .bih-close, #${ASSET_ID} .bih-settings {
      border: 1px solid #D6D6D6; background: #fff; font-size: 12px; cursor: pointer;
      color: #1D1D1B; min-height: 32px; padding: 5px 10px; border-radius: 8px;
    }
    #${ASSET_ID} .bih-close:hover, #${ASSET_ID} .bih-settings:hover { background: #F1F1F1; border-color: #BDBDBD; }
    #${ASSET_ID} .bih-body { padding: 14px 18px 16px; overflow-y: auto; }
    #${ASSET_ID} label { display: block; font-size: 12px; color: #575757; margin: 14px 0 9px; font-weight: 650; }
    #${ASSET_ID} input, #${ASSET_ID} textarea {
      width: 100%; box-sizing: border-box; border: 1px solid #D6D6D6; border-radius: 8px;
      padding: 9px 11px; font-size: 13px; color: #1D1D1B; font-family: inherit; background: #fff;
    }
    #${ASSET_ID} input:focus, #${ASSET_ID} textarea:focus {
      outline: none; border-color: #1D1D1B; box-shadow: 0 0 0 3px rgba(29,29,27,.14);
    }
    #${ASSET_ID} textarea { resize: vertical; line-height: 1.6; }
    #${ASSET_ID} .bih-rescan {
      margin-top: 7px; border: 1px solid #D6D6D6; background: #fff; color: #1D1D1B;
      border-radius: 8px; padding: 7px 11px; font-size: 12px; cursor: pointer;
    }
    #${ASSET_ID} .bih-rescan:hover { background: #F1F1F1; border-color: #BDBDBD; }
    #${ASSET_ID} .bih-row { display: flex; gap: 8px; margin: 16px 0 12px; }
    #${ASSET_ID} .bih-primary {
      flex: 1; border: none; border-radius: 10px; padding: 11px 0;
      font-size: 14px; cursor: pointer; font-weight: 700; color: #fff;
      background: #1D1D1B;
      box-shadow: 0 6px 14px rgba(29,29,27,.16);
    }
    #${ASSET_ID} .bih-primary:hover { background: #343430; }
    #${ASSET_ID} .bih-primary:focus-visible { outline: 3px solid rgba(29,29,27,.18); outline-offset: 2px; }
    #${ASSET_ID} .bih-primary:disabled { background: #A7A39B; box-shadow: none; cursor: not-allowed; }
    #${ASSET_ID} .bih-ghost {
      border: 1px solid #D6D6D6; background: #fff; color: #575757;
      border-radius: 10px; padding: 0 14px; cursor: pointer; font-size: 13px;
    }
    #${ASSET_ID} .bih-status { font-size: 12px; color: #707070; margin-top: 4px; min-height: 18px; }
    /* 结果文本框不单独定义样式：完全继承上面的 input/textarea 规则，
       这样它与「岗位描述」框的宽度、边框、内边距、字号、行高逐项一致。 */
    #${ASSET_ID} .bih-copy {
      margin: 8px 0 2px; border: 1px solid #1D1D1B; background: #fff; color: #1D1D1B;
      border-radius: 10px; padding: 7px 18px; font-size: 13px; cursor: pointer; font-weight: 600;
    }
    #${ASSET_ID} .bih-copy:hover { background: #1D1D1B; color: #fff; }
    #${ASSET_ID} .bih-copied { background: #F0F0F0; border-color: #1D1D1B; color: #1D1D1B; }
    #${ASSET_ID} .bih-animstatus { display: inline-block; font-size: 12px; color: #666; margin: 4px 0 2px; }
  `;

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = css;
    document.documentElement.appendChild(style);
  }

  const GREETINGS = [
    '喵~ 需要打磨自我介绍吗？',
    '电钻已就位，随时开工～',
    '把 JD 给我，帮你钻出好offer！',
    '你好呀，小猫修理工在这~'
  ];

  const FAB_POS_KEY = 'bossIntroFabPos';

  function saveFabPos(left, top) {
    try {
      chrome.storage.local.set({ [FAB_POS_KEY]: { left: left, top: top } });
    } catch (e) { /* ignore */ }
  }

  function assignFabPos(left, top) {
    fab.style.left = left + 'px';
    fab.style.top = top + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  }

  function loadFabPos() {
    chrome.storage.local.get([FAB_POS_KEY], (res) => {
      const p = res && res[FAB_POS_KEY];
      if (p && typeof p.left === 'number' && typeof p.top === 'number') {
        // 限制在视口内
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const left = Math.max(0, Math.min(p.left, vw - 60));
        const top = Math.max(0, Math.min(p.top, vh - 60));
        assignFabPos(left, top);
      }
    });
  }

  function enableFabDrag() {
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0;
    let originLeft = 0, originTop = 0;

    fab.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      // 当前以 right/bottom 定位，先换算成 left/top 以便拖动
      const rect = fab.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
      fab.style.left = originLeft + 'px';
      fab.style.top = originTop + 'px';
      fab.setPointerCapture && fab.setPointerCapture(e.pointerId);
    });

    fab.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
      if (moved) {
        const nLeft = Math.max(0, Math.min(originLeft + dx, window.innerWidth - 60));
        const nTop = Math.max(0, Math.min(originTop + dy, window.innerHeight - 60));
        fab.style.left = nLeft + 'px';
        fab.style.top = nTop + 'px';
      }
    });

    const onPointerUp = (e) => {
      dragging = false;
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        const rect = fab.getBoundingClientRect();
        saveFabPos(rect.left, rect.top);
        fab.__draggedOnce = true;
      }
    };
    fab.addEventListener('pointerup', onPointerUp);
    fab.addEventListener('pointercancel', onPointerUp);
  }

  function ensureFab() {
    if (fab && document.body.contains(fab)) return;
    fab = document.createElement('div');
    fab.id = ASSET_ID + '-fab';
    fab.setAttribute('role', 'button');
    fab.setAttribute('tabindex', '0');
    fab.innerHTML =
      '<span class="bih-bubble" id="' + ASSET_ID + '-bubble">' +
      '<span class="bih-bubble-text">喵~ 需要打磨自我介绍吗？</span>' +
      '<span class="bih-bubble-tail" aria-hidden="true"></span>' +
      '</span>' +
      '<span class="bih-catwrap" id="' + ASSET_ID + '-catwrap"></span>';
    document.body.appendChild(fab);

    fabCat = createCatPlayer('idle', 136);
    document.getElementById(ASSET_ID + '-catwrap').appendChild(fabCat);

    // 点击（未拖动）时打开面板
    fab.onclick = (e) => {
      // 拖动后的 click 事件会抑制；这里仅在未拖动时响应
      if (fab.__draggedOnce) { fab.__draggedOnce = false; return; }
      togglePanel(true);
    };
    fab.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(true); } };

    enableFabDrag();
    loadFabPos();

    let gi = 0;
    setInterval(() => {
      const b = document.getElementById(ASSET_ID + '-bubble');
      if (b && (!panel || panel.style.display === 'none')) {
        gi = (gi + 1) % GREETINGS.length;
        const text = b.querySelector('.bih-bubble-text');
        if (text) text.textContent = GREETINGS[gi];
      }
    }, 4000);
  }

  function togglePanel(show) {
    if (!panel) return;
    panel.style.display = show ? 'flex' : 'none';
    if (fabCat && stateDock && stateCatWrap) {
      if (show) {
        stateCatWrap.appendChild(fabCat);
        fab.style.display = 'none';
        stateDock.style.display = 'flex';
        positionStateDock();
      } else {
        document.getElementById(ASSET_ID + '-catwrap').appendChild(fabCat);
        stateDock.style.display = 'none';
        fab.style.display = 'flex';
      }
      setPanelMotion('idle', '喵师傅已就位~');
    }
    if (show) {
      refreshJob();
      // 公司介绍和工商信息可能在职位主体之后异步渲染，打开面板后再补抓一次。
      setTimeout(() => {
        if (panel && panel.style.display !== 'none') refreshJob();
      }, 1000);
    }
  }

  function positionStateDock() {
    if (!panel || !stateDock) return;
    const rect = panel.getBoundingClientRect();
    const dockWidth = 136;
    const gap = 0;
    // 猫咪 PNG 右侧有透明留白，向面板方向补偿后让可见轮廓贴边。
    const visualRightInset = 68;
    const horizontalOffset = -16;
    const verticalOffset = 20;
    const descRect = document.getElementById(ASSET_ID + '-desc').getBoundingClientRect();
    const left = Math.max(8, rect.left - dockWidth - gap + visualRightInset + horizontalOffset);
    const top = Math.max(8, descRect.top + verticalOffset);
    stateDock.style.left = left + 'px';
    stateDock.style.top = top + 'px';
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = ASSET_ID;
    panel.style.display = 'none';
    panel.innerHTML = [
      '<div class="bih-head">',
      '<div class="bih-titlebox">',
      '<b>小猫修理工 · 打磨自我介绍</b>',
      '<div class="bih-sub">喵~通过分析不同的JD，打磨出适配JD的自我介绍~</div>',
      '</div>',
      '<div class="bih-right">',
      '<button class="bih-settings" id="' + ASSET_ID + '-settings" title="设置">设置</button>',
      '<button class="bih-close" id="' + ASSET_ID + '-close" title="关闭">关闭</button>',
      '</div>',
      '</div>',
      '<div class="bih-body">',
      '<label>岗位标题</label>',
      '<input id="' + ASSET_ID + '-title" placeholder="已自动识别，可修改" />',
      '<button class="bih-rescan" id="' + ASSET_ID + '-rescan">重新抓取页面内容</button>',
      '<label>岗位描述 / 任职要求/公司信息</label>',
      '<textarea id="' + ASSET_ID + '-desc" rows="9" placeholder="已自动抓取。若抓取不完整，可在此手动补充…"></textarea>',
      '<div class="bih-row">',
      '<button class="bih-primary" id="' + ASSET_ID + '-gen">一键生成自我介绍</button>',
      '</div>',
      '<div class="bih-status" id="' + ASSET_ID + '-status"></div>',
      '</div>'
    ].join('');
    document.body.appendChild(panel);

    stateDock = document.createElement('div');
    stateDock.id = ASSET_ID + '-state-dock';
    stateDock.style.display = 'none';
    stateDock.innerHTML = '<div class="bih-state-label" id="' + ASSET_ID + '-animstatus">喵师傅已就位~</div>'
      + '<div class="bih-state-catwrap"></div>';
    document.body.appendChild(stateDock);
    stateCatWrap = stateDock.querySelector('.bih-state-catwrap');
    window.addEventListener('resize', positionStateDock);
    document.getElementById(ASSET_ID + '-close').onclick = () => togglePanel(false);
    document.getElementById(ASSET_ID + '-rescan').onclick = () => refreshJob(true);
    document.getElementById(ASSET_ID + '-gen').onclick = () => generate();
    document.getElementById(ASSET_ID + '-settings').onclick = () => openSettingsPage();
  }

  async function openSettingsPage() {
    const status = document.getElementById(ASSET_ID + '-status');

    // 1) 优先直接调用：部分 Chrome 环境下 content script 可直接打开设置页
    try {
      if (chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function') {
        await chrome.runtime.openOptionsPage();
        return;
      }
    } catch (e) {
      const m = String((e && e.message) || e);
      if (/context invalidated/i.test(m)) {
        if (status) status.textContent = '扩展已更新，当前页面还是旧版本。请刷新页面（F5 / Cmd+R）后重试。';
        return;
      }
      // 其他错误继续走兜底
    }

    // 2) 兜底：交给 background service worker 打开（content script 一定能发消息）
    try {
      chrome.runtime.sendMessage({ type: 'openOptions' }, (res) => {
        const err = chrome.runtime.lastError;
        if (err || !res || res.ok !== true) tryOpenOptionsUrl(status);
      });
      return;
    } catch (e) {
      // 继续下一步兜底
    }

    // 3) 最后兜底：直接打开 options.html
    tryOpenOptionsUrl(status);
  }

  function tryOpenOptionsUrl(status) {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        throw new Error('Extension context invalidated.');
      }
      const url = chrome.runtime.getURL('options.html');
      const win = window.open(url, '_blank');
      if (!win && status) {
        status.textContent = '浏览器拦截了弹窗。请右键扩展图标 →「选项」打开设置，或复制此地址到新标签页：' + url;
      }
    } catch (e) {
      if (status) {
        status.textContent = '扩展已更新，当前页面仍是旧版本。请刷新页面（F5 / Cmd+R）后再点「设置」。';
      }
    }
  }

  function setPanelMotion(motion, label) {
    if (fabCat) fabCat.__setMotion(motion);
    const el = document.getElementById(ASSET_ID + '-animstatus');
    if (el) el.textContent = label || '喵师傅已就位~';
  }

  function refreshJob(overwrite = false) {
    const { title, desc, company } = grabJob();
    const tInput = document.getElementById(ASSET_ID + '-title');
    const dInput = document.getElementById(ASSET_ID + '-desc');
    if (overwrite || !tInput.value) tInput.value = title;
    if (overwrite || !dInput.value || dInput.dataset.filled !== 'user') {
      dInput.value = desc || dInput.value;
      dInput.dataset.filled = desc ? 'auto' : '';
    }
    dInput.dataset.company = company || '';
    const status = document.getElementById(ASSET_ID + '-status');
    status.textContent = desc
      ? '猫猫已抓取岗位描述（' + desc.length + ' 字）'
      : '猫猫没抓到岗位描述，请手动粘贴（若能选中页面文字，选中后复制到此处）。';
  }

  function generate() {
    const title = document.getElementById(ASSET_ID + '-title').value.trim();
    const desc = document.getElementById(ASSET_ID + '-desc').value.trim();
    const company = document.getElementById(ASSET_ID + '-desc').dataset.company || '';
    const status = document.getElementById(ASSET_ID + '-status');
    const btn = document.getElementById(ASSET_ID + '-gen');

    if (!title && !desc) {
      status.textContent = '请先填写岗位标题或岗位描述哦~';
      return;
    }
    btn.disabled = true;
    status.textContent = '小猫正在用电钻打磨你的自我介绍，稍等 3-15 秒…';
    setPanelMotion('drill', '钻钻钻，打磨中~');

    // 扩展被重新加载/更新后，旧页面里的 content script 会失去上下文，
    // 此时任何与 background 的通信都会失败——提示用户刷新页面。
    const staleContext = () => {
      try { return !chrome.runtime || !chrome.runtime.id; } catch (e) { return true; }
    };
    if (staleContext()) {
      btn.disabled = false;
      status.textContent = '扩展已更新，当前页面还是旧版本。请刷新页面（F5 / Cmd+R）后重试。';
      setPanelMotion('idle', '喵师傅已就位~');
      return;
    }

    const onReply = (res) => {
      btn.disabled = false;
      const err = chrome.runtime.lastError;
      if (err) {
        const m = String(err.message || '');
        status.textContent = /context invalidated|Receiving end does not exist|message port closed/i.test(m)
          ? '扩展已更新，当前页面还是旧版本。请刷新页面（F5 / Cmd+R）后重试。'
          : '扩展通信失败：' + m;
        setPanelMotion('idle', '喵师傅已就位~');
        return;
      }
      if (res && res.error) {
        status.textContent = res.error;
        setPanelMotion('idle', '喵师傅已就位~');
        showResult(null, '');
        return;
      }
      if (res && res.intro) {
        const tag = res.mode === 'llm' ? '大模型润色版' : '规则版';
        const cleaned = res.cleaned ? '，已自动清理思考过程' : '';
        status.textContent = '打磨完成！（' + tag + cleaned + '），喵~';
        setPanelMotion('hand', '好耶，打磨完成~');
        showResult(res.mode, res.intro);
      }
    };

    try {
      chrome.runtime.sendMessage({ type: 'generateIntro', title, desc, company }, onReply);
    } catch (e) {
      btn.disabled = false;
      status.textContent = /context invalidated/i.test(String(e && e.message))
        ? '扩展已更新，当前页面还是旧版本。请刷新页面（F5 / Cmd+R）后重试。'
        : '扩展通信失败：' + ((e && e.message) || e);
      setPanelMotion('idle', '喵师傅已就位~');
    }
  }

  function showResult(mode, text) {
    const old = document.getElementById(ASSET_ID + '-out');
    if (old) old.remove();

    const out = document.createElement('div');
    out.id = ASSET_ID + '-out';
    // 不加横向内边距（.bih-body 已提供），否则结果框会比上面的输入框窄；
    // 顶部留出间距，避免状态文字与结果框紧挨着。
    out.style.cssText = 'padding:0 0 14px; margin-top:14px;';
    if (!text) {
      panel.querySelector('.bih-body').appendChild(out);
      return;
    }
    out.innerHTML = [
      '<textarea class="bih-result" rows="9" readonly>' + escapeHtml(text) + '</textarea>',
      '<button class="bih-copy" id="' + ASSET_ID + '-copy">给咪师父点赞并复制</button>'
    ].join('');
    panel.querySelector('.bih-body').appendChild(out);

    const copyBtn = document.getElementById(ASSET_ID + '-copy');
    copyBtn.onclick = async () => {
      const area = out.querySelector('textarea');
      area.focus();
      area.select();
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (e) {
        try {
          document.execCommand('copy');
          ok = true;
        } catch (e2) { ok = false; }
      }
      copyBtn.textContent = '给咪师父点赞并复制';
      copyBtn.classList.add('bih-copied');
      if (ok) {
        copyBtn.disabled = true;
        const animStatus = document.getElementById(ASSET_ID + '-animstatus');
        if (animStatus) animStatus.textContent = '复制成功啦~客官下次再来！';
        fabCat.__playOnce('delivery', () => {
          setPanelMotion('hand', '好耶，打磨完成~');
          copyBtn.classList.remove('bih-copied');
          copyBtn.disabled = false;
        });
      }
    };
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function watchUrl() {
    let last = location.href;
    let timer = null;
    setInterval(() => {
      if (location.href !== last) {
        console.log('[boss-intro] URL changed:', last, '->', location.href);
        last = location.href;
        clearTimeout(timer);
        // BOSS 是 SPA：切岗位时 URL 先变、DOM 后渲染，延迟再抓取。
        timer = setTimeout(() => {
          console.log('[boss-intro] refreshJob after delay, url:', location.href);
          refreshJob(true);
          const reqWrap = document.getElementById(ASSET_ID + '-req-wrap');
          if (reqWrap) reqWrap.style.display = 'none';
        }, 800);
      }
    }, 1500);
  }

  function init() {
    injectStyle();
    buildPanel();
    ensureFab();
    watchUrl();
    setTimeout(() => { if (panel && panel.style.display !== 'none') refreshJob(); }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
