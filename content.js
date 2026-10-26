// 内容脚本：把网页段落翻成双语对照。按需注入，重复注入时只保留第一份。
(() => {
  if (window.__xtToggle) return;

  // 要翻译的块级元素；只取最内层的块，避免同一段文字翻两遍
  const BLOCK_SEL = 'p,li,h1,h2,h3,h4,h5,h6,td,th,dt,dd,blockquote,figcaption,summary,caption';
  const SKIP_SEL = 'pre,code,script,style,noscript,textarea,select,svg,math,[contenteditable="true"],.xt-trans,#xt-banner';
  const MAX_CHARS = 5000;

  const langName = (code) => {
    try { return new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(code); } catch { return code; }
  };

  let state = null;                 // 当前这次翻译：{ target, shown, pageLang, observer }
  const translators = new Map();    // "源>目标" -> Promise<Translator|null>
  let queue = Promise.resolve();    // 段落逐个翻译

  injectStyle();

  window.__xtToggle = async () => {
    const { target = 'zh' } = await chrome.storage.sync.get('target');
    if (state && state.target === target) {
      // 已经翻过：在“显示译文”和“只看原文”之间切换
      state.shown = !state.shown;
      document.documentElement.classList.toggle('xt-hide', !state.shown);
      return;
    }
    clear();
    await start(target);
  };

  async function start(target) {
    if (!('Translator' in self)) {
      banner('当前浏览器不支持内置翻译，需要电脑版 Chrome 138 或更新版本。', { ms: 8000 });
      return;
    }
    const st = state = { target, shown: true, pageLang: null, observer: null };
    st.pageLang = (await detect(document.body.innerText.slice(0, 3000)))
      || normLang(document.documentElement.lang);

    // 只翻译滚动到附近的段落，长页面也不会卡
    st.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        st.observer.unobserve(e.target);
        queue = queue
          .then(() => translateBlock(e.target, st))
          .catch((err) => console.warn('[网页双语翻译]', err));
      }
    }, { rootMargin: '400px 0px' });

    collectBlocks().forEach((el) => st.observer.observe(el));
  }

  // 换了目标语言再翻时，先清掉旧译文
  function clear() {
    state?.observer?.disconnect();
    state = null;
    document.querySelectorAll('.xt-trans').forEach((n) => n.remove());
    document.documentElement.classList.remove('xt-hide');
  }

  function collectBlocks() {
    const hasLetters = (el) => /\p{L}/u.test(el.textContent);
    const blocks = [...document.body.querySelectorAll(BLOCK_SEL)]
      .filter((el) => !el.closest(SKIP_SEL) && !el.querySelector(BLOCK_SEL) && hasLetters(el));
    // 很多网站直接把文字写在 div 里：只取不再包含 div 和块元素的最内层 div；
    // 已在块元素里面的 div 由外层块一起翻译
    const divs = [...document.body.querySelectorAll('div')].filter((el) =>
      !el.closest(SKIP_SEL + ',' + BLOCK_SEL) && !el.querySelector('div,' + BLOCK_SEL)
      && [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && /\p{L}/u.test(n.textContent)));
    return blocks.concat(divs);
  }

  async function translateBlock(el, st) {
    if (st !== state) return;   // 用户已切换语言，丢弃旧任务
    const text = el.innerText.trim().slice(0, MAX_CHARS);
    if (text.length < 2) return;

    const src = (await detect(text)) || st.pageLang;
    if (!src || src === st.target) return;

    const translator = await getTranslator(src, st.target);
    if (!translator || st !== state) return;

    const out = (await translator.translate(text)).trim();
    if (!out || out === text || st !== state) return;

    const node = document.createElement('span');
    node.className = 'xt-trans';
    node.textContent = out;
    el.appendChild(node);
  }

  // 语言检测用 Chrome 自带的 i18n.detectLanguage，不需要下载模型
  async function detect(text) {
    if (!text.trim()) return null;
    const r = await chrome.i18n.detectLanguage(text.slice(0, 1000));
    return r.isReliable ? normLang(r.languages[0]?.language) : null;
  }

  // 统一成 Translator API 用的代码：zh / zh-Hant / en / ja …
  function normLang(code) {
    if (!code || code === 'und') return null;
    const c = code.toLowerCase();
    if (c.startsWith('zh')) return /hant|tw|hk|mo/.test(c) ? 'zh-Hant' : 'zh';
    return c.split('-')[0];
  }

  function getTranslator(src, tgt) {
    const key = src + '>' + tgt;
    if (!translators.has(key)) {
      translators.set(key, createTranslator(src, tgt).catch((err) => {
        translators.delete(key);   // 失败的下次还能重试
        banner(`翻译器创建失败：${err.message}`, { ms: 6000 });
        return null;
      }));
    }
    return translators.get(key);
  }

  async function createTranslator(src, tgt) {
    const opts = { sourceLanguage: src, targetLanguage: tgt };
    const pair = `${langName(src)} → ${langName(tgt)}`;
    const availability = await Translator.availability(opts);
    if (availability === 'unavailable') {
      banner(`内置翻译暂不支持 ${pair}`, { ms: 5000 });
      return null;
    }
    // 下载语言包必须由用户在页面上点击触发；快捷键和右键菜单不算，所以给个按钮
    if (availability !== 'available' && !navigator.userActivation.isActive) {
      await waitForClick(`第一次使用 ${pair}，需要下载语言包`);
    }
    const translator = await Translator.create({
      ...opts,
      monitor(m) {
        // 语言包已就绪时 Chrome 也会报一次进度，这时不显示
        if (availability === 'available') return;
        m.addEventListener('downloadprogress', (e) => {
          banner(`正在下载 ${pair} 语言包 ${Math.round(e.loaded * 100)}%`, { ms: 0 });
        });
      },
    });
    if (availability !== 'available') banner(`${pair} 语言包已就绪`, { ms: 2500 });
    return translator;
  }

  // ---- 页面右上角的提示条 ----
  let bannerEl = null;
  let bannerTimer = 0;

  function banner(msg, { ms = 4000, button = null } = {}) {
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'xt-banner';
      document.documentElement.appendChild(bannerEl);
    }
    bannerEl.textContent = msg;
    if (button) {
      const b = document.createElement('button');
      b.textContent = button.text;
      b.addEventListener('click', button.onClick, { once: true });
      bannerEl.append(b);
    }
    bannerEl.hidden = false;
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(() => { bannerEl.hidden = true; }, ms);
  }

  function waitForClick(msg) {
    return new Promise((resolve) => banner(msg, { ms: 0, button: { text: '下载并翻译', onClick: resolve } }));
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = `
      .xt-trans { display: block; margin: .3em 0 .1em; padding-left: .6em;
        border-left: 2px solid #4c8bf5; opacity: .8; font-weight: normal;
        white-space: normal; line-height: 1.6; }
      .xt-hide .xt-trans { display: none !important; }
      #xt-banner { position: fixed; top: 16px; right: 16px; z-index: 2147483647;
        max-width: 320px; padding: 10px 14px; border-radius: 8px;
        background: #1f2937; color: #f9fafb; font: 14px/1.5 system-ui, sans-serif;
        box-shadow: 0 4px 16px rgba(0,0,0,.25); }
      #xt-banner[hidden] { display: none; }
      #xt-banner button { display: block; margin-top: 8px; padding: 4px 12px;
        border: 0; border-radius: 6px; background: #4c8bf5; color: #fff;
        font: inherit; cursor: pointer; }
    `;
    document.documentElement.appendChild(style);
  }
})();
