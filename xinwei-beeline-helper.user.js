// ==UserScript==
// @name         芯位刷课
// @name:zh-CN   芯位刷课（芯位蜜线）
// @namespace    https://github.com/Selffox/beeline-ai-helper
// @version      0.10.0
// @description  芯位蜜线/芯位教育（www.beeline-ai.com）自动刷课：播完才跳、完成度判定、平台倍速、三级重试、题库+AI 答题
// @author       Selffox(重构) · Zerox(原版) · lxjuyn(新域名适配)
// 来源说明：基于 lxjuyn/xinwei-beeline-auto（GPL-3.0）二次开发，原作者 Zerox / lxjuyn
// @license      GPL-3.0
// @homepageURL  https://github.com/Selffox/beeline-ai-helper
// @supportURL   https://github.com/Selffox/beeline-ai-helper/issues
// @updateURL    https://raw.githubusercontent.com/Selffox/beeline-ai-helper/main/xinwei-beeline-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Selffox/beeline-ai-helper/main/xinwei-beeline-helper.user.js
// @match        *://*.beeline-ai.com/*
// @match        *://*.xinwei-ai.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      tk.enncy.cn
// @connect      *
// @run-at       document-end
// ==/UserScript==

/*
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.  See LICENSE-GPL-3.0.txt.
 *
 * 本文件是基于 lxjuyn/xinwei-beeline-auto（GPL-3.0）的二次开发版本，
 * 重写了刷课判定、增加接口确认 / 平台倍速 / 三级重试 / AI 答题。
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ 配置 */
  const DEFAULTS = {
    enabled: true,
    mute: true,
    keepPlaying: true,
    autoNext: true,
    skipDone: true,
    useMenuSpeed: true,
    speed: 2,
    nonMediaWait: 10000,
    endedDelay: 900,
    stallSec: 60,
    maxReload: 2,
    showLog: true,
    ai: {
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'THUDM/GLM-4-9B-0414',
      apiKey: '',
      temperature: 0.2
    },
    bank: {
      base: 'https://tk.enncy.cn',
      token: ''
    }
  };

  const store = {
    get(k, d) { try { const v = GM_getValue(k); return v === undefined ? d : v; } catch (e) { return d; } },
    set(k, v) { try { GM_setValue(k, v); } catch (e) {} }
  };

  const CFG = Object.assign({}, DEFAULTS, store.get('xw_cfg', {}));
  CFG.ai = Object.assign({}, DEFAULTS.ai, CFG.ai || {});
  CFG.bank = Object.assign({}, DEFAULTS.bank, CFG.bank || {});
  const saveCfg = () => store.set('xw_cfg', CFG);

  /* ------------------------------------------------------------------ 工具 */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const now = () => Date.now();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const clip = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n || 80);
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return 'q' + (h >>> 0).toString(36); };

  /* ------------------------------------------------------------------ 日志 */
  const state = {
    running: false,
    timer: null,
    lecture: '',
    lastT: -1,
    lastTAt: 0,
    tries: 0,
    endedAt: 0,
    lastNextAt: 0,
    nonMediaAt: 0,
    speedTried: '',
    speedBlocked: false,
    reloads: {},
    logs: []
  };

  function log(msg, level) {
    const t = new Date().toLocaleTimeString();
    state.logs.unshift({ t, msg: String(msg), level: level || 'info' });
    if (state.logs.length > 120) state.logs.length = 120;
    renderLog();
  }

  /* -------------------------------------------------------------- 接口 hook */
  (function hookNet() {
    if (window.__xwNet) return;
    const st = window.__xwNet = { single: {}, examine: null, at: 0 };
    const kind = (u) => {
      if (/\/studentLearning\/getSingleChapterData\//.test(u)) return 'single';
      if (/\/studentLearning\/getExamineData/.test(u)) return 'examine';
      return null;
    };
    const handle = (u, text) => {
      const k = kind(u); if (!k) return;
      let j = null; try { j = JSON.parse(text); } catch (e) { return; }
      if (!j || j.code !== 200) return;
      if (k === 'examine') st.examine = j.data;
      else {
        const id = (u.split('getSingleChapterData/')[1] || '').split('?')[0];
        if (id) st.single[id] = j.data;
      }
      st.at = now();
    };
    const of = window.fetch;
    window.fetch = function () {
      const p = of.apply(this, arguments);
      try {
        const a = arguments;
        const u = String((a[0] && (a[0].url || a[0])) || '');
        if (kind(u)) p.then(r => r.clone().text().then(t => handle(u, t)).catch(() => {})).catch(() => {});
      } catch (e) {}
      return p;
    };
    const oo = XMLHttpRequest.prototype.open;
    const os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function () { this.__xwUrl = arguments[1]; return oo.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      const u = String(this.__xwUrl || ''), self = this;
      if (kind(u)) this.addEventListener('load', () => { try { handle(u, self.responseText); } catch (e) {} });
      return os.apply(this, arguments);
    };
  })();

  /* -------------------------------------------------------------- 小节/目录 */
  const lectureId = () => {
    const m = (location.hash || '').match(/\/video\/([0-9a-z]+)/i);
    return m ? m[1] : '';
  };

  const menuRoot = () => $('.el-menu-component') || document;
  const menuItems = () => $$('.el-menu-item', menuRoot()).filter(el => el.querySelector('[class*="-icon"]') || el.querySelector('[class*="icon-"]'));
  const itemTitle = (el) => el ? clip((el.innerText || '').split('\n')[0], 40) : '';
  const activeItem = () => menuItems().find(el => el.classList.contains('is-active')) || null;
  const isDoneItem = (el) => {
    const i = el && el.querySelector('.lecture-status i');
    return !!(i && i.classList.contains('done-icon'));
  };
  const unfinished = () => menuItems().filter(el => !isDoneItem(el));
  const nextUnfinished = () => {
    const list = menuItems();
    const act = activeItem();
    const un = unfinished();
    if (!un.length) return null;
    if (!act) return un[0];
    const i = list.indexOf(act);
    for (let k = i + 1; k < list.length; k++) if (un.includes(list[k])) return list[k];
    return un[0];
  };

  /* ---------------------------------------------------------------- 视频状态 */
  const vid = () => {
    const vs = $$('video').filter(v => v.isConnected);
    let best = null, bs = -1;
    for (const v of vs) { const d = Number(v.duration) || 0; if (d > bs) { bs = d; best = v; } }
    return best;
  };
  const isEnded = (v) => {
    if (!v) return false;
    if (v.ended) return true;
    const d = Number(v.duration);
    return Number.isFinite(d) && d > 0 && v.currentTime >= d - 1.5;
  };
  const progressText = () => {
    const el = $('.video-duration');
    return el ? clip(el.innerText, 120) : '';
  };
  const platformPct = () => {
    const m = progressText().match(/已观看\s*(\d+)\s*%/);
    if (m) return Number(m[1]);
    const v = vid();
    if (!v) return null;
    const d = Number(v.duration);
    return Number.isFinite(d) && d > 0 ? Math.floor(v.currentTime / d * 100) : null;
  };
  const apiInfo = () => {
    const id = lectureId(), n = window.__xwNet;
    if (!id || !n || !n.single[id]) return null;
    const d = n.single[id], lp = d.learnProcessInfo || {};
    const len = Number(d.videoLength || (d.mediaInfo && d.mediaInfo.videoLength) || 0);
    const sec = Number(lp.alreadyViewSeconds || lp.studyTime || 0);
    return { complete: String(lp.completeStatus) === '1', len, sec, pct: len > 0 ? sec / len : null };
  };

  /* ------------------------------------------------------------ 下一节 / 点击 */
  const NEXT_SELECTORS = [
    '#videoLayer .button-box .right > div',
    '.video-layer .button-box .right',
    '.watch-next-chapter .right',
    '.watch-next-chapter > div > .right'
  ];
  function nextButton() {
    for (const s of NEXT_SELECTORS) {
      const el = $(s);
      if (el && vis(el)) return el;
    }
    return null;
  }
  function clickNext() {
    if (now() - state.lastNextAt < 3000) return false;
    const b = nextButton();
    if (!b) return false;
    state.lastNextAt = now();
    try { b.click(); } catch (e) { return false; }
    log('点「观看下一章节」→ ' + clip(b.textContent, 20), 'ok');
    return true;
  }
  function clickNextItem() {
    if (now() - state.lastNextAt < 3000) return false;
    const nx = nextUnfinished();
    if (!nx) return false;
    state.lastNextAt = now();
    try { nx.click(); } catch (e) { return false; }
    log('切到下一未完成：' + itemTitle(nx), 'ok');
    return true;
  }

  /* ---------------------------------------------------------------- 倍速菜单 */
  function ensureSpeed(v) {
    if (!v) return;
    const key = location.hash || '';
    if (state.speedTried === key) return;
    state.speedTried = key;
    if (!CFG.useMenuSpeed) {
      try { v.playbackRate = CFG.speed; } catch (e) {}
      log('倍速设为 ' + CFG.speed + 'x（直接设置）');
      return;
    }
    const msg = $$('.el-message-box__container p, .el-message-box__message').map(x => x.textContent || '').join(' ');
    if (/不允许倍速/.test(msg)) {
      state.speedBlocked = true;
      try { v.playbackRate = 1; } catch (e) {}
      log('平台提示「不允许倍速播放」，保持 1x', 'warn');
      return;
    }
    const btn = $('.vjs-playback-rate');
    if (!btn) { log('平台未提供倍速入口，保持 1x'); return; }
    try { btn.click(); } catch (e) { return; }
    setTimeout(() => {
      const items = $$('.vjs-menu-item');
      const cands = items.map(el => {
        const m = (el.textContent || '').trim().match(/^([\d.]+)\s*x/i);
        return m ? { el, r: Number(m[1]) } : null;
      }).filter(Boolean);
      if (!cands.length) { log('平台未提供倍速档位（本课 showPlaybackRate=0），保持 1x'); return; }
      const best = cands.reduce((a, b) => (b.r > a.r ? b : a));
      if (best.r <= 1.01) { log('平台最高档为 1x'); return; }
      try { best.el.click(); } catch (e) {}
      setTimeout(() => {
        const vv = vid();
        if (vv && vv.playbackRate > 1.01) log('倍速已切到 ' + vv.playbackRate + 'x（平台菜单）', 'ok');
        else { state.speedBlocked = true; try { vv.playbackRate = 1; } catch (e) {} log('平台拒绝倍速，保持 1x', 'warn'); }
      }, 1200);
    }, 350);
  }

  /* ---------------------------------------------------------------- 三级重试 */
  function stallWatch(v) {
    if (!v) return;
    if (Math.abs(v.currentTime - state.lastT) > 0.4) {
      state.lastT = v.currentTime;
      state.lastTAt = now();
      state.tries = 0;
      return;
    }
    if (!state.lastTAt) state.lastTAt = now();
    if (now() - state.lastTAt < CFG.stallSec * 1000) return;
    if (state.tries < 1) {
      state.tries = 1;
      state.lastTAt = now();
      log('播放停滞 ' + CFG.stallSec + ' 秒，尝试恢复播放', 'warn');
      try { v.muted = true; v.play().catch(() => {}); } catch (e) {}
      return;
    }
    const key = lectureId() || 'x';
    const n = (state.reloads[key] || 0);
    if (n < CFG.maxReload) {
      state.reloads[key] = n + 1;
      log('恢复失败，刷新页面（第 ' + (n + 1) + '/' + CFG.maxReload + ' 次）', 'warn');
      setRunning(false);
      setTimeout(() => location.reload(), 1200);
      return;
    }
    log('多次重试仍卡住，已停止', 'err');
    setRunning(false);
  }

  /* ---------------------------------------------------------------- 主循环 */
  function tick() {
    try {
      if (!CFG.enabled) return;
      const v = vid();
      const id = lectureId();
      if (id !== state.lecture) {
        state.lecture = id;
        state.lastT = -1;
        state.lastTAt = now();
        state.tries = 0;
        state.endedAt = 0;
        state.nonMediaAt = 0;
        if (id) log('进入小节：' + (itemTitle(activeItem()) || id));
      }
      if (CFG.mute) $$('video').forEach(x => { try { x.muted = true; } catch (e) {} });
      if (v && CFG.keepPlaying && v.paused && !v.ended) { try { v.play().catch(() => {}); } catch (e) {} }
      ensureSpeed(v);

      if (!v) { handleNonMedia(); return; }
      if (CFG.skipDone && shouldSkipDone()) { skipDone(); return; }
      if (isEnded(v)) { handleEnded(); return; }
      stallWatch(v);
      updateStatus();
    } catch (e) {
      log('主循环异常：' + e.message, 'err');
    }
  }

  function shouldSkipDone() {
    const api = apiInfo();
    if (api && api.complete && api.pct !== null && api.pct >= 0.995 && !nextButton()) return true;
    if (api && api.complete && api.len > 0 && api.sec >= api.len - 1 && !nextButton()) return true;
    return false;
  }

  function skipDone() {
    if (now() - state.lastNextAt < 6000) return;
    const api = apiInfo();
    log('接口确认本节已看完（' + api.sec + '/' + api.len + ' 秒），跳过', 'ok');
    if (!clickNext()) clickNextItem();
  }

  function handleEnded() {
    if (!state.endedAt) state.endedAt = now();
    if (now() - state.endedAt < CFG.endedDelay) return;
    if (!CFG.autoNext) { updateStatus('已播完（自动下一节关闭）'); return; }
    if (clickNext()) { state.endedAt = 0; return; }
    if (now() - state.endedAt > 6000) {
      if (clickNextItem()) state.endedAt = 0;
      else {
        const all = menuItems();
        if (all.length && all.every(isDoneItem)) { log('本课程全部小节已完成，停止', 'ok'); setRunning(false); }
      }
    }
  }

  function handleNonMedia() {
    if (!CFG.autoNext) return;
    if (!state.nonMediaAt) state.nonMediaAt = now();
    const left = Math.max(0, Math.ceil((CFG.nonMediaWait - (now() - state.nonMediaAt)) / 1000));
    updateStatus('非视频内容，' + left + 's 后切换下一节');
    if (now() - state.nonMediaAt >= CFG.nonMediaWait) {
      if (!clickNext() && !clickNextItem()) log('非视频页无可切换项');
      state.nonMediaAt = 0;
    }
  }

  function setRunning(on) {
    state.running = !!on;
    CFG.enabled = !!on;
    saveCfg();
    if (on) {
      if (!state.timer) state.timer = setInterval(tick, 2000);
      log('已启动', 'ok');
      tick();
    } else {
      if (state.timer) { clearInterval(state.timer); state.timer = null; }
      log('已停止', 'warn');
    }
    syncUI();
  }

  /* ---------------------------------------------------------------- AI 答题 */
  const BANK_KEY = 'xw_bank';
  const bank = () => store.get(BANK_KEY, {});

  function pageKind() {
    const h = (location.hash || '') + location.search;
    if (/homeworkpaperid/i.test(h)) return 'homework';
    if (/\/(exam|paper|test)/i.test(h) && $('.question-box, .question')) return 'exam';
    if ($('.question-box, .question')) return 'question';
    return '';
  }

  function parseQuestion() {
    const box = $('.question-box') || $('.question') || document.body;
    const titleEl = box.querySelector('.topic-title') || box.querySelector('.question-title') || box.querySelector('h1,h2,h3,h4');
    const title = clip(titleEl ? titleEl.innerText : '', 300);
    const typeText = clip(box.innerText, 400);
    let type = 'unknown';
    if (/多选|多项选择/.test(typeText)) type = 'multiple';
    else if (/单选|单项选择/.test(typeText)) type = 'single';
    else if (/判断/.test(typeText)) type = 'judgement';
    else if (/填空/.test(typeText)) type = 'completion';
    else if (/主观|简答|论述|问答/.test(typeText)) type = 'subjective';
    const opts = $$('.el-radio, .el-checkbox', box).map(el => clip((el.querySelector('.label') || el).innerText, 120)).filter(Boolean);
    return { title, type, opts };
  }

  /* ------------------------------------------------------------ 跨域请求 */
  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      const done = (txt) => { try { resolve(JSON.parse(txt)); } catch (e) { reject(new Error('响应不是 JSON')); } };
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: opts.method || 'GET',
          url: opts.url,
          headers: opts.headers || {},
          data: opts.data,
          timeout: 20000,
          onload: (r) => done(r.responseText),
          onerror: () => reject(new Error('网络错误')),
          ontimeout: () => reject(new Error('请求超时'))
        });
        return;
      }
      fetch(opts.url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.data, credentials: 'omit' })
        .then(r => r.text()).then(done).catch((e) => reject(new Error('fetch 失败（可能是 CORS，需 GM_xmlhttpRequest）: ' + e.message)));
    });
  }

  async function callAI(payload) {
    const ai = CFG.ai;
    if (!ai.apiKey) throw new Error('未配置 AI apiKey（面板设置里填）');
    const url = ai.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const body = {
      model: ai.model,
      temperature: Number(ai.temperature) || 0.2,
      stream: false,
      messages: [
        { role: 'system', content: '你是答题助手。只输出一个 JSON 对象，不要任何解释或代码块标记。' },
        { role: 'user', content: payload }
      ]
    };
    const j = await gmRequest({ url, method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.apiKey }, data: JSON.stringify(body) });
    if (j.error) throw new Error('AI 接口错误：' + (j.error.message || JSON.stringify(j.error)));
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  }

  function extractJson(text) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI 未返回 JSON：' + clip(text, 60));
    return JSON.parse(m[0]);
  }

  function applyAnswer(q, ans) {
    const box = $('.question-box') || $('.question') || document.body;
    if (q.type === 'single' || q.type === 'judgement') {
      const labels = $$('.el-radio-group label', box);
      let idx = -1;
      if (q.type === 'judgement') {
        idx = /正确|对|是|true/i.test(ans) ? 0 : 1;
      } else {
        const L = String(ans).trim().toUpperCase().replace(/[^A-Z]/g, '');
        idx = L ? L.charCodeAt(0) - 65 : -1;
      }
      if (idx < 0 || idx >= labels.length) return false;
      labels[idx].click();
      return true;
    }
    if (q.type === 'multiple') {
      const letters = String(ans).toUpperCase().replace(/[^A-Z]/g, '').split('');
      const labels = $$('.el-checkbox-group label', box);
      let ok = false;
      letters.forEach(ch => {
        const i = ch.charCodeAt(0) - 65;
        if (labels[i]) { labels[i].click(); ok = true; }
      });
      return ok;
    }
    if (q.type === 'completion') {
      const inputs = $$('input[type=text], input:not([type]), textarea', box).filter(el => !el.closest('.question-box ~ *'));
      const arr = Array.isArray(ans) ? ans : String(ans).split(/[；;|]/);
      let ok = false;
      inputs.forEach((el, i) => {
        if (arr[i] == null) return;
        const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value');
        if (setter) setter.set.call(el, String(arr[i]).trim());
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        ok = true;
      });
      return ok;
    }
    if (q.type === 'subjective') {
      const ed = $('[id^="w-e-textarea-"]') || $('.w-e-textarea') || $('[contenteditable="true"]') || $('textarea', box);
      if (!ed) return false;
      ed.focus();
      if (ed.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(ed.__proto__, 'value');
        if (setter) setter.set.call(ed, String(ans));
        ed.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        try { document.execCommand('selectAll', false, null); document.execCommand('insertText', false, String(ans)); }
        catch (e) { ed.innerText = String(ans); ed.dispatchEvent(new InputEvent('input', { bubbles: true })); }
      }
      return true;
    }
    return false;
  }

  function normalizeChoiceAnswer(q, ans) {
    const s = String(ans);
    if (q.type === 'single' || q.type === 'multiple') {
      const letters = (s.match(/[A-H]/g) || []).filter((v, i, a) => a.indexOf(v) === i);
      if (letters.length) return q.type === 'multiple' ? letters.slice().sort().join('') : letters[0];
    }
    if (q.opts && q.opts.length) {
      const idx = q.opts.findIndex(o => o && s.includes(o.slice(0, Math.min(10, o.length))));
      if (idx >= 0) return String.fromCharCode(65 + idx);
    }
    return s.trim();
  }

  function normText(s) {
    return String(s || '').replace(/[\s？?。.，,、；;：:（）()【】\[\]"'“”‘’]/g, '');
  }
  function bigrams(s) {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const k = s.slice(i, i + 2);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }
  function strSim(a, b) {
    a = normText(a); b = normText(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const A = bigrams(a), B = bigrams(b);
    let inter = 0, total = 0;
    A.forEach((v, k) => { total += v; if (B.has(k)) inter += Math.min(v, B.get(k)); });
    B.forEach(v => { total += v; });
    return total ? (2 * inter) / total : 0;
  }
  function negationDiff(a, b) {
    const neg = (s) => /[不非除]|错误|不正确|不属于|不包括|除外/.test(String(s || ''));
    return neg(a) !== neg(b);
  }

  async function queryBank(q) {
    const b = CFG.bank || {};
    if (!b.token) return null;
    const base = (b.base || 'https://tk.enncy.cn').replace(/\/$/, '');
    const body = {
      token: b.token,
      title: q.title,
      options: (q.opts || []).join('\n'),
      type: q.type === 'unknown' ? 'unknown' : q.type,
      images: [],
      v: '2',
      suggestion_title: '',
      suggestion_options: ''
    };
    const j = await gmRequest({
      url: base + '/query',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(body)
    });
    const d = j.data || {};
    const tip = String(d.answer || '');
    if (j.code !== 1 && /凭证|无效|过期|配置已经|找不到/.test(tip)) {
      log('题库凭证无效/已过期，请登录言溪题库个人中心重新复制 token', 'err');
      return null;
    }
    if (j.code !== 1 || !d.answer) {
      if (d.times != null) log('题库剩余次数：' + d.times, 'warn');
      return null;
    }
    const sim = strSim(q.title, String(d.question || ''));
    if (negationDiff(q.title, String(d.question || ''))) {
      log('题库返回的题目否定词不同（「' + clip(d.question, 30) + '」），判定不是同一题，未采用', 'warn');
      return null;
    }
    if (sim < 0.5) {
      log('题库返回题目相似度仅 ' + Math.round(sim * 100) + '%（「' + clip(d.question, 24) + '」），未采用', 'warn');
      return null;
    }
    if (d.times != null) log('题库剩余次数：' + d.times + (d.ai ? '（题库 AI 生成）' : ''));
    log('题库命中（相似度 ' + Math.round(sim * 100) + '%）：' + clip(d.answer, 40), 'ok');
    return String(d.answer).trim();
  }

  async function bankInfo() {
    const b = CFG.bank || {};
    if (!b.token) return null;
    const base = (b.base || 'https://tk.enncy.cn').replace(/\/$/, '');
    try {
      const j = await gmRequest({ url: base + '/info?token=' + encodeURIComponent(b.token) });
      if (j.code !== 1 || !j.data) { log('题库信息：' + (j.message || '获取失败'), 'warn'); return null; }
      log('题库余量 ' + j.data.times + ' 次（已用 ' + j.data.user_times + ' 次，成功 ' + j.data.success_times + ' 次）', 'ok');
      return j.data;
    } catch (e) { log('题库信息获取失败：' + e.message, 'warn'); return null; }
  }

  async function answerCurrent() {
    const q = parseQuestion();
    if (!q.title) { log('没解析到题目', 'warn'); return; }
    log('题目[' + q.type + ']：' + clip(q.title, 40));
    const key = hash(q.type + '|' + q.title + '|' + q.opts.join('|'));
    const cached = bank()[key];
    if (cached) {
      const ok = applyAnswer(q, normalizeChoiceAnswer(q, cached.answer));
      log('命中本地缓存（' + (cached.src || '缓存') + '）：' + clip(String(cached.answer), 40) + (ok ? '（已填入）' : '（填充失败）'), ok ? 'ok' : 'warn');
      return;
    }
    let ans = null, src = '';
    try {
      const b = await queryBank(q);
      if (b) { ans = b; src = '题库'; }
      else log('题库未命中' + (CFG.bank && CFG.bank.token ? '' : '（未配置题库 token）'), 'warn');
    } catch (e) { log('题库查询失败：' + e.message, 'warn'); }
    if (!ans && CFG.ai && CFG.ai.apiKey) {
      const prompt = '题型：' + q.type + '\n题目：' + q.title + '\n选项：' + (q.opts.length ? q.opts.map((o, i) => String.fromCharCode(65 + i) + '.' + o).join(' / ') : '无') +
        '\n请返回 JSON：{"type":"' + q.type + '","answer":"单选/判断填字母(A/B)；多选填字母串(如AC)；填空按顺序用;分隔；主观题写一段答案"}';
      try {
        const raw = await callAI(prompt);
        const obj = extractJson(raw);
        ans = obj.answer != null ? obj.answer : obj.result;
        src = 'AI';
      } catch (e) { log('AI 答题失败：' + e.message, 'err'); return; }
    }
    if (!ans) { log('题库没查到，也没配 AI key（设置里可填，可选）', 'warn'); return; }
    const norm = normalizeChoiceAnswer(q, ans);
    const ok = applyAnswer(q, norm);
    const bb = bank(); bb[key] = { q: clip(q.title, 120), answer: norm, src, at: now() };
    store.set(BANK_KEY, bb);
    log(src + ' 答案：' + clip(String(norm), 60) + (ok ? '（已填入，未提交）' : '（填充失败）'), ok ? 'ok' : 'warn');
  }

  /* -------------------------------------------------------------------- UI */
  const META = {
    version: '0.10.0',
    maintainer: 'Selffox',
    github: 'https://github.com/Selffox',
    email: '',
    origin: 'lxjuyn/xinwei-beeline-auto',
    originUrl: 'https://github.com/lxjuyn/xinwei-beeline-auto',
    readme: 'https://github.com/Selffox/beeline-ai-helper/blob/main/README.md',
    originAuthors: 'Zerox · lxjuyn'
  };

  const CSS = `
  #xw-bar{position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;
    border-radius:20px;background:#fff;border:1px solid #e5e7eb;box-shadow:0 8px 20px rgba(15,23,42,.12);cursor:pointer;
    font:12.5px/1 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#334155;user-select:none}
  #xw-bar.hide{display:none}
  #xw-bar .dot{width:9px;height:9px;border-radius:50%;background:#94a3b8;flex:0 0 auto}
  #xw-bar.g .dot{background:#10b981}
  #xw-bar.y .dot{background:#f59e0b}
  #xw-bar.r .dot{background:#ef4444}
  #xw-bar .txt{white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}
  #xw-bar .gear{font-size:13px;color:#94a3b8;padding-left:2px}
  #xw-bar .gear:hover{color:#4f46e5}

  #xw-panel{position:fixed;left:16px;bottom:16px;width:320px;z-index:2147483001;background:#fff;border:1px solid #e5e7eb;
    border-radius:14px;box-shadow:0 14px 34px rgba(15,23,42,.18);overflow:hidden;display:none;
    font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#334155}
  #xw-panel.show{display:block}
  #xw-hd{background:#4f46e5;color:#fff;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;
    font-weight:600;font-size:12.5px;cursor:move;user-select:none}
  #xw-hd .ops{display:flex;gap:6px}
  #xw-hd button{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:7px;padding:1px 7px;font-size:12px;cursor:pointer}
  .xw-bd{padding:10px 12px;display:flex;flex-direction:column;gap:9px}
  .xw-bd[hidden]{display:none}
  .xw-big{display:flex;align-items:center;justify-content:space-between}
  .xw-big span{font-size:13.5px;color:#0f172a;font-weight:600}
  .sw{width:42px;height:24px;border-radius:24px;background:#e2e8f0;position:relative;cursor:pointer;flex:0 0 auto;transition:background .18s}
  .sw:after{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:#fff;
    box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .18s}
  .sw.on{background:#4f46e5}
  .sw.on:after{left:21px}
  #xw-status{background:#f4f6fa;border:1px solid #eef2f7;border-radius:9px;padding:7px 10px;font-size:12px;color:#475569;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #xw-toggle{width:100%;padding:9px 0;border-radius:10px;border:1px solid #4f46e5;background:#4f46e5;color:#fff;
    font-size:13px;cursor:pointer}
  #xw-toggle.stop{background:#fff;color:#dc2626;border-color:#fecaca}
  .xw-tabs{display:flex;gap:14px;padding:0 2px 6px;border-bottom:1px solid #eef2f7;font-size:12.5px;color:#64748b}
  .xw-tabs b,.xw-tabs span{position:relative;cursor:pointer;font-weight:400;color:#64748b}
  .xw-tabs b{color:#4f46e5;font-weight:600}
  .xw-tabs b:after{content:"";position:absolute;left:0;right:0;bottom:-7px;height:2px;background:#4f46e5;border-radius:2px}
  .xw-pane{display:flex;flex-direction:column;gap:8px;max-height:300px;overflow:auto}
  .xw-pane[hidden]{display:none}
  .xw-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .xw-row>span{font-size:12.5px;color:#475569;flex:0 0 84px}
  .xw-row input{flex:1;min-width:0;border:1px solid #e5e7eb;border-radius:8px;padding:5px 7px;font-size:12px;color:#334155}
  .xw-row input:focus{outline:none;border-color:#4f46e5}
  .xw-row .unit{font-size:12px;color:#94a3b8;flex:0 0 auto}
  .xw-links{display:flex;gap:14px;font-size:12px;flex-wrap:wrap}
  .xw-links a{color:#4f46e5;text-decoration:none}
  .xw-links a:hover{text-decoration:underline}
  #xw-save{width:100%;padding:8px 0;border-radius:9px;border:1px solid #4f46e5;background:#4f46e5;color:#fff;font-size:12.5px;cursor:pointer}
  #xw-log{max-height:300px;overflow:auto;font-size:11.5px}
  #xw-log .it{display:flex;gap:6px;margin-bottom:2px}
  #xw-log .tm{color:#94a3b8;flex:0 0 52px}
  #xw-log .ms{flex:1;word-break:break-all}
  #xw-log .ok .ms{color:#059669}
  #xw-log .warn .ms{color:#d97706}
  #xw-log .err .ms{color:#dc2626}
  .xw-about{font-size:12px;color:#64748b;line-height:1.9}
  .xw-about b{color:#0f172a}
  .xw-about a{color:#4f46e5;text-decoration:none}
  .xw-about a:hover{text-decoration:underline}
  .xw-about .muted{color:#94a3b8;font-size:11.5px}
  #xw-reset{width:100%;padding:8px 0;border-radius:9px;border:1px solid #fecaca;background:#fff;color:#dc2626;font-size:12.5px;cursor:pointer}
  #xw-reset:hover{background:#fef2f2}
  `;

  function injectCSS() {
    const s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const UI = { folded: true, page: 'main', tab: 'play' };

  function buildUI() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="xw-bar"><span class="dot"></span><span class="txt">已停止</span><span class="gear">⚙</span></div>
      <div id="xw-panel">
        <div id="xw-hd"><span>芯位刷课</span><span class="ops"><button id="xw-gear" title="设置">⚙</button><button id="xw-min" title="收起">－</button></span></div>

        <div class="xw-bd" id="xw-main">
          <div class="xw-big"><span>自动刷课</span><div class="sw" id="xw-enabled"></div></div>
          <div id="xw-status">已停止</div>
          <button id="xw-toggle">开始</button>
        </div>

        <div class="xw-bd" id="xw-settings" hidden>
          <div class="xw-tabs">
            <b data-tab="play">播放</b><span data-tab="answer">答题</span><span data-tab="log">日志</span><span data-tab="about">关于</span>
          </div>

          <div class="xw-pane" id="xw-tab-play">
            <div class="xw-row"><span>自动静音</span><div class="sw" id="xw-mute"></div></div>
            <div class="xw-row"><span>播完下一节</span><div class="sw" id="xw-autonext"></div></div>
            <div class="xw-row"><span>跳过已完成</span><div class="sw" id="xw-skipdone"></div></div>
            <div class="xw-row"><span>平台倍速</span><div class="sw" id="xw-menuspeed"></div></div>
            <div class="xw-row"><span>非视频停留</span><span style="display:flex;flex:1;align-items:center;gap:6px"><input id="xw-nonmedia" type="number" min="1" max="120"><span class="unit">秒</span></span></div>
          </div>

          <div class="xw-pane" id="xw-tab-answer" hidden>
            <div class="xw-row"><span>题库 token</span><input id="xw-bank-token" type="password" placeholder="必填"></div>
            <div class="xw-links"><a href="https://docs.ocsjs.com/docs/work" target="_blank" rel="noopener">📖 配置教程</a><a href="https://tk.enncy.cn/" target="_blank" rel="noopener">🔑 取 token</a></div>
            <div class="xw-row"><span>AI Key</span><input id="xw-ai-key" type="password" placeholder="可选"></div>
            <div class="xw-row"><span>AI 服务</span><input id="xw-ai-base" type="text" placeholder="可选"></div>
            <div class="xw-row"><span>AI 模型</span><input id="xw-ai-model" type="text" placeholder="可选"></div>
          </div>

          <div class="xw-pane" id="xw-tab-log" hidden><div id="xw-log"></div></div>

          <div class="xw-pane" id="xw-tab-about" hidden>
            <div class="xw-about">
              <b>芯位刷课 ${META.version}</b> · GPL-3.0<br>
              维护者：<b>${META.maintainer}</b><br>
              <span id="xw-meta-links"></span>
            </div>
            <button id="xw-reset">重置所有设置</button>
          </div>

          <button id="xw-save">保存配置</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const $b = (id) => document.getElementById(id);

    function fillMeta() {
      const box = $b('xw-meta-links');
      if (!box) return;
      const parts = [];
      if (META.github) parts.push('<a href="' + META.github + '" target="_blank" rel="noopener">GitHub ↗</a>');
      parts.push('<a href="' + META.readme + '" target="_blank" rel="noopener">使用说明 ↗</a>');
      box.innerHTML = parts.join(' · ') + '<br>';
    }

    function showPanel(page) {
      UI.folded = false;
      $b('xw-panel').classList.add('show');
      $b('xw-bar').classList.add('hide');
      UI.page = page || UI.page;
      $b('xw-main').hidden = UI.page !== 'main';
      $b('xw-settings').hidden = UI.page !== 'settings';
      if (UI.page === 'settings') { fillSettings(); showTab(UI.tab); fillMeta(); }
    }
    function foldPanel() {
      UI.folded = true;
      $b('xw-panel').classList.remove('show');
      $b('xw-bar').classList.remove('hide');
    }
    function showTab(tab) {
      UI.tab = tab || 'play';
      ['play', 'answer', 'log', 'about'].forEach(t => {
        const pane = $b('xw-tab-' + t);
        if (pane) pane.hidden = t !== UI.tab;
      });
      $b('xw-settings').querySelectorAll('.xw-tabs > *').forEach(el => {
        const isB = el.dataset.tab === UI.tab;
        const tag = isB ? 'b' : 'span';
        if (el.tagName.toLowerCase() !== tag) {
          const repl = document.createElement(tag);
          repl.dataset.tab = el.dataset.tab;
          repl.textContent = el.textContent;
          el.replaceWith(repl);
        }
      });
      bindTabs();
      $b('xw-save').style.display = (UI.tab === 'log' || UI.tab === 'about') ? 'none' : 'block';
      if (UI.tab === 'log') renderLog();
    }
    function bindTabs() {
      $b('xw-settings').querySelectorAll('.xw-tabs > *').forEach(el => {
        el.onclick = () => showTab(el.dataset.tab);
      });
    }

    $b('xw-bar').addEventListener('click', (e) => {
      const isGear = e.target && e.target.classList && e.target.classList.contains('gear');
      showPanel(isGear ? 'settings' : 'main');
    });
    $b('xw-min').addEventListener('click', foldPanel);
    $b('xw-gear').addEventListener('click', () => showPanel('settings'));

    function bindSw(id, key, cb) {
      const el = $b(id);
      el.classList.toggle('on', !!CFG[key]);
      el.addEventListener('click', () => {
        CFG[key] = !CFG[key];
        el.classList.toggle('on', CFG[key]);
        saveCfg();
        if (cb) cb();
      });
    }
    bindSw('xw-enabled', 'enabled', () => setRunning(CFG.enabled));
    bindSw('xw-mute', 'mute');
    bindSw('xw-autonext', 'autoNext');
    bindSw('xw-skipdone', 'skipDone');
    bindSw('xw-menuspeed', 'useMenuSpeed', () => { state.speedTried = ''; state.speedBlocked = false; });

    $b('xw-toggle').addEventListener('click', () => setRunning(!state.running));

    function fillSettings() {
      $b('xw-nonmedia').value = Math.round(Number(CFG.nonMediaWait) / 1000) || 10;
      $b('xw-bank-token').value = CFG.bank.token || '';
      $b('xw-ai-key').value = CFG.ai.apiKey || '';
      $b('xw-ai-base').value = CFG.ai.baseUrl || '';
      $b('xw-ai-model').value = CFG.ai.model || '';
    }

    $b('xw-save').addEventListener('click', () => {
      const sec = Number($b('xw-nonmedia').value);
      CFG.nonMediaWait = Math.max(1000, (Number.isFinite(sec) && sec > 0 ? sec : 10) * 1000);
      CFG.bank.token = $b('xw-bank-token').value.trim();
      CFG.ai.apiKey = $b('xw-ai-key').value.trim();
      CFG.ai.baseUrl = $b('xw-ai-base').value.trim() || DEFAULTS.ai.baseUrl;
      CFG.ai.model = $b('xw-ai-model').value.trim() || DEFAULTS.ai.model;
      saveCfg();
      log('配置已保存' + (CFG.bank.token ? '（题库已启用）' : '（未配置题库 token）'), 'ok');
      if (CFG.bank.token) bankInfo();
      showPanel('main');
    });

    $b('xw-reset').addEventListener('click', () => {
      if (!confirm('确定重置所有设置？题库 token 和 AI Key 也会被清空。')) return;
      Object.keys(DEFAULTS).forEach(k => {
        if (k === 'ai' || k === 'bank') return;
        CFG[k] = DEFAULTS[k];
      });
      CFG.ai = Object.assign({}, DEFAULTS.ai);
      CFG.bank = { base: DEFAULTS.bank.base, token: '' };
      saveCfg();
      ['xw-enabled:enabled', 'xw-mute:mute', 'xw-autonext:autoNext', 'xw-skipdone:skipDone', 'xw-menuspeed:useMenuSpeed'].forEach(pair => {
        const [id, key] = pair.split(':');
        $b(id).classList.toggle('on', !!CFG[key]);
      });
      fillSettings();
      log('已重置所有设置', 'warn');
    });

    /* 拖动 */
    const hd = $b('xw-hd');
    const panel = $b('xw-panel');
    let drag = null;
    hd.addEventListener('mousedown', (e) => {
      drag = { x: e.clientX, y: e.clientY, l: panel.offsetLeft, t: panel.offsetTop };
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      panel.style.left = Math.max(4, drag.l + e.clientX - drag.x) + 'px';
      panel.style.top = Math.max(4, drag.t + e.clientY - drag.y) + 'px';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { drag = null; });

    bindTabs();
    fillMeta();
    showPanel('main');
    foldPanel();
    syncUI();
    renderLog();
  }

  function syncUI() {
    const sw = document.getElementById('xw-enabled');
    if (sw) sw.classList.toggle('on', !!state.running);
    const btn = document.getElementById('xw-toggle');
    if (btn) {
      btn.textContent = state.running ? '停止' : '开始';
      btn.classList.toggle('stop', !!state.running);
    }
    updateStatus();
  }

  function renderLog() {
    const box = document.getElementById('xw-log');
    if (!box) return;
    box.innerHTML = state.logs.slice(0, 80).map(x =>
      '<div class="it ' + x.level + '"><span class="tm">' + x.t + '</span><span class="ms">' + escapeHtml(x.msg) + '</span></div>'
    ).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function setBar(kind, text) {
    const bar = document.getElementById('xw-bar');
    if (!bar) return;
    bar.classList.remove('g', 'y', 'r');
    if (kind) bar.classList.add(kind);
    const t = bar.querySelector('.txt');
    if (t) t.textContent = text;
  }

  function updateStatus(text) {
    const el = document.getElementById('xw-status');
    const v = vid();
    const pct = platformPct();
    const act = activeItem();
    let line, kind;
    if (!state.running) {
      line = '已停止';
      kind = '';
    } else if (text) {
      line = text;
      kind = 'y';
    } else if (!v) {
      line = '非视频页 · ' + (itemTitle(act) || '等待');
      kind = 'y';
    } else if (isEnded(v)) {
      line = '本节播完 · 切换中…';
      kind = 'y';
    } else {
      line = '刷课中 · ' + (pct === null ? '?' : pct) + '%' + (v.playbackRate > 1 ? ' · ' + v.playbackRate + 'x' : '');
      kind = 'g';
    }
    if (el) el.textContent = line;
    setBar(kind, line);
  }

  /* ------------------------------------------------------------------ 启动 */
  function boot() {
    if ($('#xw-panel')) return;
    injectCSS();
    buildUI();
    log('脚本已加载（GPL-3.0 · 基于 lxjuyn/xinwei-beeline-auto）');
    if (CFG.enabled) setRunning(true);
    // 页面路由变化时刷新状态
    window.addEventListener('hashchange', () => { state.lecture = ''; setTimeout(updateStatus, 800); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
